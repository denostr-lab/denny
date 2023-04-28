import { shuffle, throttle } from "lodash-es";
import { Event, Filter, Relay, relayInit } from "nostr-tools";
// import { TypedEventEmitter } from "../../models/typed-event-emitter";
// import { MatrixEvent } from "../../models/event";
import { MatrixClient } from "../../client";

import Events from "./Events";
import PubSub from "./PubSub";

type SavedRelays = {
    [key: string]: {
        enabled?: boolean;
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
    disableEventHandle?: boolean;
}
const DEFAULT_RELAYS = [
    "wss://denostr.sixwings.snowinning.com",
    "wss://eden.nostr.land",
    "wss://relay.damus.io",
    "wss://relay.snort.social",
    "wss://offchain.pub",
    "wss://nos.lol",
    "wss://denostr.paiya.app",
    // "ws://192.168.0.99:8008",
    // "wss://nostr.paiyaapp.com",
    // "ws://localhost:8008",
    // "wss://denostr.chickenkiller.com",
    // "wss://qwqb4l.paiya.app",
    // 'wss://offchain.pub',
    // 'wss://node01.nostress.cc',
    // 'wss://nostr-pub.wellorder.net',
];

const SEARCH_RELAYS = [];

type PublicRelaySettings = {
    read?: boolean;
    write?: boolean;
    enabled?: boolean;
    lastSince?: number;
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
        // this.saveToLocalStorage();
    }

    initRelays(relays: NostrRelay[]) {
        this.relays = new Map<string, NostrRelay>(
            relays.map((relay) => [relay.url, this.relayInit(relay.url, true, { enabled: relay.enabled })]),
        );
        this.searchRelays = new Map<string, NostrRelay>(SEARCH_RELAYS.map((url) => [url, this.relayInit(url)]));
    }

    getLocalRelays() {
        const localRelays = localStorage.getItem("nostr.relays");
        let relays: NostrRelay[] = [];
        if (localRelays) {
            relays = JSON.parse(localRelays);
        }
        return relays;
    }

    getLastSinces() {
        const localSinces = localStorage.getItem("nostr.last_sinces");
        const sinces: Map<string, number> = new Map();
        if (localSinces) {
            (JSON.parse(localSinces) as [string, number][]).forEach(([id, since]) => {
                sinces.set(id, since);
            });
        }
        return sinces;
    }

    getLastSinceById(id: string) {
        const lastSinces = this.getLastSinces();
        if (!lastSinces.has(id)) {
            return 0;
        }
        return lastSinces.get(id) || 0;
    }

    setLastSince(id: string, since?: number) {
        const lastSinces = this.getLastSinces();
        if (!since) {
            since = Math.round(Date.now() / 1000);
        }
        lastSinces.set(id, since);
        localStorage.setItem("nostr.last_sinces", JSON.stringify([...lastSinces.entries()]));
    }

    removeLastSince(id: string) {
        const lastSinces = this.getLastSinces();
        lastSinces.delete(id);
        localStorage.setItem("nostr.last_sinces", JSON.stringify([...lastSinces.entries()]));
    }

    getDefaultRelays(initRelays?: string[]) {
        return [...new Set([...(initRelays || []), ...DEFAULT_RELAYS])].map(
            (url) =>
                ({
                    url,
                    enabled: true,
                    read: true,
                    write: true,
                    lastSince: 0,
                } as NostrRelay),
        );
    }

    saveToLocalStorage(toRelays?: NostrRelay[]) {
        let currentRelays = [...this.relays.values()];
        if (toRelays && Array.isArray(toRelays)) {
            currentRelays = [...toRelays];
        }
        const relays = currentRelays.map((relay: NostrRelay) => {
            const options = ["enabled", "read", "write", "lastSince"].map((optionKey) => {
                let optionValue = relay[optionKey] || false;
                if (typeof relay[optionKey] === "number") {
                    optionValue = Number(relay[optionKey]);
                } else if (typeof relay[optionKey] !== "boolean") {
                    optionValue = true;
                }
                return [optionKey, optionValue];
            });
            return { url: relay.url, ...Object.fromEntries(options) };
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
            if (
                !(
                    relay.url.includes("paiya") ||
                    relay.url.includes("snowinning") ||
                    relay.url.includes("localhost") ||
                    relay.url.includes("192.168.0")
                )
            ) {
                if ([140, 141, 142, 104].includes(event.kind)) {
                    continue;
                }
            }
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
                if (relay.enabled && this.getStatus(relay) === 3) {
                    this.connect(relay);
                }
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
        const relay = this.relayInit(url, true, { enabled: false });
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
        const { read = true, write = true, enabled = true, lastSince = 0 } = options || {};

        const relay = relayInit(url) as NostrRelay;
        relay.enabled = enabled;
        relay.read = read;
        relay.write = write;
        relay.lastSince = lastSince;
        subscribeAll &&
            relay.on("connect", () => {
                relay.enabled = true;
                this.resubscribe(relay);
            });
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
        const { filters, id, once = false, unsubscribeTimeout = 0, callback, disableEventHandle = false } = options;
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
            let oldFilter = [...filters];
            if (
                !(
                    relay.url.includes("paiya") ||
                    relay.url.includes("snowinning") ||
                    relay.url.includes("localhost") ||
                    relay.url.includes("192.168.0")
                )
            ) {
                if (id === "global") {
                    const oldFilterFirst = oldFilter[0];
                    oldFilter = [{ kinds: [0, 4], authors: oldFilterFirst.authors, since: oldFilterFirst.since }];
                } else {
                    continue;
                }
            }
            // if (sinceLastSeen && savedRelays[relay.url] && savedRelays[relay.url].lastSeen) {
            //     filters.forEach((filter) => {
            //         filter.since = savedRelays[relay.url].lastSeen;
            //     });
            // }
            const sub = relay.sub(oldFilter, { id: subId });
            sub.on("event", (event) => {
                // this.up
                callback?.(event);
                if (!disableEventHandle) {
                    Events.handle(this.client, event);
                }
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
        // if (sinceLastSeen && savedRelays[relay.url] && savedRelays[relay.url].lastSeen) {
        //     filters.forEach((filter) => {
        //         filter.since = savedRelays[relay.url].lastSeen;
        //     });
        // }
        const sub = relay.sub(filters, { id: subId });
        sub.on("event", (event) => {
            this.updateLastSeen(relay.url);
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
    getRelays = () => {
        return this.relays.values();
    };
}

export default Relays;
