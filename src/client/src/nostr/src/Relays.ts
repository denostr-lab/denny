import { shuffle, throttle } from "lodash-es";
// import { TypedEventEmitter } from "../../models/typed-event-emitter";
// import { MatrixEvent } from "../../models/event";
import { MatrixClient } from "../../client";

import { Event, Filter, Relay, relayInit } from "nostr-tools";

import Events from "./Events";
import Key from "./Key";
import PubSub from "./PubSub";

type SavedRelays = {
    [key: string]: {
        enabled?: boolean;
        lastSeen?: number;
    };
};

let savedRelays: SavedRelays = {};

interface SubscriptionOption {
    filters: Filter[];
    id: string;
    once?: boolean;
    unsubscribeTimeout?: number;
    callback?: (event: Event) => any;
    sinceLastSeen?: boolean;
}
const DEFAULT_RELAYS = [
    // "wss://nostr.paiyaapp.com",
    "ws://localhost:8008",

    // 'wss://offchain.pub',
    // 'wss://node01.nostress.cc',
    // 'wss://nostr-pub.wellorder.net',
];

const SEARCH_RELAYS = [];

type PublicRelaySettings = {
    read?: boolean;
    write?: boolean;
    enabled?: boolean;
};

export interface NostrRelay extends Relay, PublicRelaySettings {}

class Relays {
    public relays: Map<string, NostrRelay> = new Map<string, NostrRelay>();

    public searchRelays: Map<string, NostrRelay> = new Map<string, NostrRelay>();

    constructor(private readonly client: MatrixClient) {}

    init(initRelays: string[] = []) {
        const relays = this.getLocalRelays();
        if (relays.length === 0) {
            relays.push(...this.getDefaultRelays(initRelays));
        }
        this.initRelays(relays);
        this.intervalRetry();
        this.saveToLocalStorage();
    }

    initRelays(relays: { url: string; enabled: boolean }[]) {
        this.relays = new Map<string, NostrRelay>(
            relays.map((relay) => [relay.url, this.relayInit(relay.url, true, { enabled: relay.enabled })]),
        );
        this.searchRelays = new Map<string, NostrRelay>(SEARCH_RELAYS.map((url) => [url, this.relayInit(url)]));
    }

    getLocalRelays() {
        const localRelays = localStorage.getItem("nostr.relays");
        let relays: { url: string; enabled: boolean; read: boolean; write: boolean }[] = [];
        if (localRelays) {
            relays = JSON.parse(localRelays);
        }
        return relays;
    }

    getDefaultRelays(initRelays?: string[]) {
        return [...new Set([...(initRelays || []), ...DEFAULT_RELAYS])].map((url) => ({
            url,
            enabled: true,
            read: true,
            write: true,
        }));
    }

    saveToLocalStorage() {
        const relays = [...this.relays.entries()].map(([url, relay]) => {
            const options = ["enabled", "read", "write"].map((optionKey) => {
                let optionValue = relay[optionKey] || false;
                if (typeof relay[optionKey] !== "boolean") {
                    optionValue = true;
                }
                return [optionKey, optionValue];
            });
            return { url, ...Object.fromEntries(options) };
        });
        localStorage.setItem("nostr.relays", JSON.stringify(relays));
    }

    getBufferEvent() {
        return Events.getBufferEvent();
    }

    getStatus(relay: Relay) {
        // workaround for nostr-tools bug
        try {
            return relay.status;
        } catch (e) {
            return 3;
        }
    }

    // get Map of relayUrl: {read:boolean, write:boolean}
    getUrlsFromFollowEvent(event: Event): Map<string, PublicRelaySettings> {
        const urls = new Map<string, PublicRelaySettings>();
        if (event.content) {
            try {
                const content = JSON.parse(event.content);
                for (const url in content) {
                    try {
                        const parsed = new URL(url).toString().replace(/\/$/, "");
                        urls.set(parsed, content[url]);
                    } catch (e) {
                        console.log("invalid relay url", url, event);
                    }
                }
            } catch (e) {
                console.log("failed to parse relay urls", event);
            }
        }
        return urls;
    }

    getPopularRelays() {
        console.log("getPopularRelays");
        const relays = new Map<string, number>();
        Events.db.find({ kind: 3 }).forEach((event) => {
            if (event.content) {
                try {
                    // content is an object of relayUrl: {read:boolean, write:boolean}
                    const content = JSON.parse(event.content);
                    for (const url in content) {
                        try {
                            const parsed = new URL(url).toString().replace(/\/$/, "");
                            const count = relays.get(parsed) || 0;
                            relays.set(parsed, count + 1);
                        } catch (e) {
                            console.log("invalid relay url", url, event);
                        }
                    }
                } catch (e) {
                    console.log("failed to parse relay urls", event);
                }
            }
        });
        const sorted = Array.from(relays.entries())
            .filter(([url]) => !this.relays.has(url))
            .sort((a, b) => b[1] - a[1]);
        return sorted.map((entry) => {
            return { url: entry[0], users: entry[1] };
        });
    }

    getConnectedRelayCount() {
        let count = 0;
        for (const relay of this.relays.values()) {
            if (this.getStatus(relay) === 1) {
                count++;
            }
        }
        return count;
    }

    getUserRelays(user: string): Array<[string, PublicRelaySettings]> {
        let relays = new Map<string, PublicRelaySettings>();
        if (typeof user !== "string") {
            console.log("getUserRelays: invalid user", user);
            return [];
        }
        // 这里直接把数据库中 kind 等于3的都拿出来`
        const followEvent = Events.db.findOne({ kind: 3, pubkey: user });
        if (followEvent) {
            relays = this.getUrlsFromFollowEvent(followEvent);
        }
        return Array.from(relays.entries());
    }

    publish(event: Event, cb?: any) {
        const relays = Array.from(this.relays.values()).filter(
            (relay: NostrRelay) => relay.enabled !== false,
        ) as NostrRelay[];
        for (const relay of relays) {
            const pub = relay.publish(event);
            if (cb) {
                pub.on("ok", () => cb("ok"));
                pub.on("failed", (reason) => cb(reason));
            }
        }
        let recipientRelays: string[] = [];
        const mentionedUsers = event.tags.filter((tag) => tag[0] === "p").map((tag) => tag[1]);
        if (mentionedUsers.length > 10) {
            return;
        }
        // for (const user of mentionedUsers) {
        //   if (user === Key.getPubKey()) {
        //     continue;
        //   }
        //   this.getUserRelays(user)
        //     .filter((entry) => entry[1].read)
        //     .forEach((entry) => recipientRelays.push(entry[0]));
        // }
        // 3 random read relays of the recipient
        recipientRelays = shuffle(recipientRelays).slice(0, 3);
        for (const relayUrl of recipientRelays) {
            if (!relays.find((relay) => relay.enabled && relay.url === relayUrl)) {
                console.log("publishing event to recipient relay", relayUrl, event.id, event.content || "");
                const relay = this.relayInit(relayUrl, false);
                relay.publish(event);
                setTimeout(() => {
                    relay.close();
                }, 5000);
            }
        }
    }

    publishAsPromise(event: Event) {
        return new Promise((resolve, reject) => {
            this.publish(event, (res: "ok" | string) => {
                if (res === "ok") {
                    resolve(res);
                } else {
                    reject(res);
                }
            });
        });
    }

    connect(relay: NostrRelay) {
        try {
            relay.connect();
        } catch (e) {
            console.log(e);
        }
    }

    intervalRetry() {
        const go = () => {
            for (const relay of this.relays.values()) {
                if (relay.enabled !== false && this.getStatus(relay) === 3) {
                    this.connect(relay);
                }
                // if disabled
                // if (relay.enabled === false && this.getStatus(relay) === 1) {
                //   relay.close();
                // }
            }
            for (const relay of this.searchRelays.values()) {
                if (this.getStatus(relay) === 3) {
                    this.connect(relay);
                }
            }
        };
        go();

        setInterval(go, 10000);
    }

    add(url: string) {
        if (this.relays.has(url)) return;
        const relay = this.relayInit(url);
        relay.on("connect", () => this.resubscribe(relay));
        this.relays.set(url, relay);
    }

    remove(url: string) {
        try {
            this.relays.get(url)?.close();
        } catch (e) {
            console.log("error closing relay", e);
        }
        this.relays.delete(url);
    }

    restoreDefaults() {
        [...this.relays.keys()].forEach((url) => this.remove(url));
        this.relays.clear();

        this.initRelays(this.getDefaultRelays());
        this.saveToLocalStorage();
    }

    unsubscribe(id: string) {
        const subs = PubSub.subscriptionsByName.get(id);
        if (subs) {
            subs.forEach((sub) => {
                sub.unsub();
            });
        }
        PubSub.subscriptionsByName.delete(id);
        PubSub.subscribedFiltersByName.delete(id);
    }

    resubscribe(relay: Relay) {
        console.log("subscribedFiltersByName.size", PubSub.subscribedFiltersByName.size);
        for (const [name, filters] of Array.from(PubSub.subscribedFiltersByName.entries())) {
            console.log("resubscribing to ", name, filters);
            this.subscribe(filters);
            // this.subscribeByRelayOnce(relay, filters.filters, name, false, 0, filters.callback, filters.sinceRelayLastSeen);
        }
    }

    relayInit(url: string, subscribeAll = true, options?: PublicRelaySettings) {
        const { read = true, write = true, enabled = true } = options || {};

        const relay = relayInit(url) as NostrRelay;
        relay.enabled = enabled;
        relay.read = read;
        relay.write = write;
        subscribeAll && relay.on("connect", () => this.resubscribe(relay));
        relay.on("notice", (notice) => {
            relay.enabled = true;
            console.log("notice from ", relay.url, notice);
        });
        if (enabled) {
            this.connect(relay);
        }
        return relay;
    }

    subscribe(options: SubscriptionOption) {
        const { filters, id, once = false, unsubscribeTimeout = 0, callback, sinceLastSeen = false } = options;
        if (id) {
            const subs = PubSub.subscriptionsByName.get(id);
            if (subs) {
                subs.forEach((sub) => {
                    sub.unsub();
                });
            }
            PubSub.subscriptionsByName.delete(id);
            PubSub.subscribedFiltersByName.delete(id);
        }

        PubSub.subscribedFiltersByName.set(id, options);
        const subId = PubSub.getSubscriptionIdForName(id);
        const relays = this.relays.values();
        for (const relay of relays) {
            if (sinceLastSeen && savedRelays[relay.url] && savedRelays[relay.url].lastSeen) {
                filters.forEach((filter) => {
                    filter.since = savedRelays[relay.url].lastSeen;
                });
            }
            const sub = relay.sub(filters, { id: subId });
            sub.on("event", (event) => {
                callback?.(event);
                Events.handle(this.client, event);
            });
            if (once) {
                sub.on("eose", () => {
                    callback?.(null);
                    sub.unsub();
                });
            }
            if (!PubSub.subscriptionsByName.has(id)) {
                PubSub.subscriptionsByName.set(id, new Set());
            }
            PubSub.subscriptionsByName.get(id)?.add(sub);
            if (unsubscribeTimeout) {
                setTimeout(() => {
                    sub.unsub();
                    PubSub.subscriptionsByName.delete(id);
                    PubSub.subscribedFiltersByName.delete(id);
                }, unsubscribeTimeout);
            }
        }
    }

    subscribeByRelayOnce(
        relay: Relay,
        filters: Filter[],
        id: string,
        once = false,
        unsubscribeTimeout = 0,
        callback?: (event: Event) => any,
        sinceLastSeen = false,
    ) {
        // if subs with same id already exists, remove them
        if (id) {
            const subs = PubSub.subscriptionsByName.get(id);
            if (subs) {
                subs.forEach((sub) => {
                    sub.unsub();
                });
            }
            PubSub.subscriptionsByName.delete(id);
            PubSub.subscribedFiltersByName.delete(id);
        }

        PubSub.subscribedFiltersByName.set(id, {
            filters,
            sinceRelayLastSeen: sinceLastSeen,
            callback,
        });
        const subId = PubSub.getSubscriptionIdForName(id);
        if (sinceLastSeen && savedRelays[relay.url] && savedRelays[relay.url].lastSeen) {
            filters.forEach((filter) => {
                filter.since = savedRelays[relay.url].lastSeen;
            });
        }
        const sub = relay.sub(filters, { id: subId });
        sub.on("event", (event) => {
            callback?.(event);
            Events.handle(this.client, event);
        });
        if (once) {
            sub.on("eose", () => sub.unsub());
        }
        if (!PubSub.subscriptionsByName.has(id)) {
            PubSub.subscriptionsByName.set(id, new Set());
        }
        PubSub.subscriptionsByName.get(id)?.add(sub);
        if (unsubscribeTimeout) {
            setTimeout(() => {
                sub.unsub();
                PubSub.subscriptionsByName.delete(id);
                PubSub.subscribedFiltersByName.delete(id);
            }, unsubscribeTimeout);
        }
    }
}

export default Relays;
