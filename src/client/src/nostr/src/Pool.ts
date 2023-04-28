import { Filter, Event } from "nostr-tools";
import Relays from "./Relays";
import { MetaInfo } from "./@types/index";
import * as utils from "../../utils";
import Events from "./Events";

class SimpleEvents {
    private readonly events = new Map<string, Event>();

    public addEvent(event: Event) {
        if (!this.events.has(event.id)) {
            this.events.set(event.id, event);
        }
    }

    private getAll() {
        return [...this.events.values()].map((event) => event.created_at).sort(utils.sortDesc);
    }

    get lastCreatedAt() {
        const all = this.getAll();
        if (all.length === 0) {
            return 0;
        }

        return this.getAll()[0];
    }

    get size() {
        return this.events.size;
    }
}

type SubscriptionComplete = (sub: Subscription) => Promise<void> | void;
type SubscriptionSuccess = (event: Event, sub: Subscription) => Promise<void> | void;

type Subscription = {
    id: string;
    filters: Filter[];
    priority: number;
    relay: Relays;
    failed?: number;
    retry?: number;
    wait?: number;
    success?: SubscriptionSuccess;
    complete?: SubscriptionComplete;
    events?: SimpleEvents;
    once?: boolean;
    disableEventHandle?: boolean;
    running?: boolean;
};

export class SubscriptionPool {
    private subscriptions: Subscription[] = [];

    private onceSubscriptions: Subscription[] = [];

    private subCount = 0;

    constructor(private maxPoolSize: number = 10, private REQ: number = 240) {
        this.setMaxPoolSize(maxPoolSize);

        this.processQueue();

        setInterval(() => {
            const metric = {
                REQ: this.REQ,
                maxPoolSize: this.maxPoolSize,
                subCount: this.subCount,
                subscriptions: this.subscriptions,
                onceSubscriptions: this.onceSubscriptions,
            };
            console.log("class SubscriptionPool metric=", metric);
        }, 3000);
    }

    public incMaxPoolSize(id: string) {
        this.setMaxPoolSize(this.maxPoolSize + 1, id);
    }

    public async decMaxPoolSize(id: string) {
        await this.ok();
        this.setMaxPoolSize(this.maxPoolSize - 1, id);
    }

    public setMaxPoolSize(maxPoolSize: number, id?: string) {
        if (maxPoolSize < 0) {
            throw new Error("Range of values that are not allowed");
        }
        this.maxPoolSize = maxPoolSize;
    }

    public setREQ(REQ: number) {
        if (REQ <= 0) {
            throw new Error("Range of values that are not allowed");
        }
        this.REQ = REQ;
    }

    public async push(sub: Subscription): Promise<string> {
        const { once = true, disableEventHandle = false } = sub;
        const subscription: Subscription = { ...sub, once, disableEventHandle };
        subscription.events = new SimpleEvents();

        if (subscription.priority < 0) {
            subscription.priority = 0;
        }
        if (typeof subscription.failed === "undefined" || subscription.failed <= 0) {
            subscription.failed = 0;
        }
        if (typeof subscription.retry === "undefined" || subscription.retry <= 0) {
            subscription.retry = 3;
        }
        if (typeof subscription.wait === "undefined" || subscription.wait <= 0) {
            subscription.wait = 5 * 1000;
        }

        await this.addSubscription(subscription.once ? this.onceSubscriptions : this.subscriptions, subscription);

        return subscription.id;
    }

    private subscriptionSet() {
        return new Set([...this.subscriptions.map((s) => s.id), ...this.onceSubscriptions.map((s) => s.id)]);
    }

    public existSubscription(id: string) {
        return this.subscriptionSet().has(id);
    }

    public async sleep() {
        await utils.sleep((60 / this.REQ) * (this.maxPoolSize || 1) * 1000);
    }

    private ok() {
        return new Promise(async (resolve, reject) => {
            const deadline = Date.now() + 5 * 1000;
            while (true) {
                if (Date.now() > deadline) {
                    reject();
                    break;
                }

                if (this.maxPoolSize > 0) {
                    resolve("ok");
                    break;
                }
                await utils.sleep(100);
            }
        });
    }

    private async addSubscription(subscriptions: Subscription[], subscription: Subscription) {
        if (this.existSubscription(subscription.id)) {
            let currentSubscription: Subscription;
            if (subscription.once) {
                currentSubscription = this.findOnceSubscription(subscription.id) as Subscription;
            } else {
                currentSubscription = this.findSubscription(subscription.id) as Subscription;
            }

            this.unsubscribe(subscription.id);

            ["authors", "ids", "#e", "#p"].forEach((field: any) => {
                currentSubscription.filters.forEach((currentFilter) => {
                    if (currentFilter?.[field]) {
                        subscription.filters.forEach((filter) => {
                            if (filter?.[field]) {
                                filter[field] = [...new Set([...currentFilter[field], ...filter[field]])];

                                // if (filter[field].length >= 200) {
                                //     newFilter = {
                                //         ...filter,
                                //         [field]: filter[field].slice(200, filter[field].length - 1),
                                //     };
                                //     filter[field] = filter[field].slice(0, 200);

                                //     newSubscriptions.push({
                                //         ...subscription,
                                //         id: `${subscription.id}/${Number(Math.random().toString().slice(2))
                                //             .toString(16)
                                //             .slice(3, 9)}`,
                                //         filters: [newFilter]
                                //     });
                                // }
                            }
                        });
                    }
                });
            });

            subscription.filters = currentSubscription.filters;
        }

        subscriptions.push(subscription);

        // const s = {
        //     disableEventHandle: subscription.disableEventHandle,
        //     id: subscription.id,
        //     filters: subscription.filters,
        //     once: subscription.once,
        //     priority: subscription.priority,
        //     running: subscription.running,
        //     failed: subscription.failed,
        //     wait: subscription.wait,
        //     retry: subscription.retry,
        // };
        // console.log(`pool ### ${subscription.id} ######### `, JSON.parse(JSON.stringify(s)));

        subscriptions.sort((a, b) => utils.sortDesc(b.priority, a.priority)); // Sort by priority descending
    }

    private handlerSubscription(sub: Subscription, done?: (value: void | PromiseLike<void>) => void) {
        sub.running = true;
        const callback = async (event: Event | null) => {
            if (event === null) {
                done?.();
                sub?.complete?.(sub);
                sub.running = false;
                return;
            }
            await sub?.success?.(event, sub);
            sub?.events?.addEvent(event);
        };

        sub.relay.subscribe({
            filters: sub.filters,
            id: sub.id,
            disableEventHandle: sub.disableEventHandle,
            ...(done ? { callback } : {}),
            once: sub.once,
        });

        this.subCount += 1;
        if (!done) {
            sub?.complete?.(sub);
            sub.running = false;
        }
    }

    private findSubscriptionIndex(id: string) {
        return this.subscriptions.findIndex((subscription) => subscription.id === id);
    }

    private findOnceSubscriptionIndex(id: string) {
        return this.onceSubscriptions.findIndex((subscription) => subscription.id === id);
    }

    private findSubscription(id: string) {
        const index = this.findSubscriptionIndex(id);
        if (index !== -1) {
            return this.subscriptions[index];
        }
        return undefined;
    }

    private findOnceSubscription(id: string) {
        const index = this.findOnceSubscriptionIndex(id);
        if (index !== -1) {
            return this.onceSubscriptions[index];
        }
        return undefined;
    }

    public unsubscribe(id: string): void {
        const index = this.findSubscriptionIndex(id);
        if (index !== -1) {
            this.subscriptions[index].relay.unsubscribe(id);
            this.subscriptions.splice(index, 1);
        } else {
            const onceIndex = this.findOnceSubscriptionIndex(id);
            if (onceIndex !== -1) {
                this.onceSubscriptions[onceIndex].relay.unsubscribe(id);
                this.onceSubscriptions.splice(onceIndex, 1);
            }
        }
    }

    private async processSubscription(sub: Subscription) {
        const p = new Promise<void>((resolve, reject) => {
            this.decMaxPoolSize(sub.id)
                .then(() => {
                    console.log("pool 池子拿出来 sub.id=", sub.id, sub.priority, this.maxPoolSize);
                    this.handlerSubscription(sub, resolve);
                })
                .catch(() => reject());
        });

        let failed = false;
        await p
            .then(() => {
                if (sub.once) {
                    console.log("pool 取消订阅 sub.id=", sub.id, sub.priority);
                    this.unsubscribe(sub.id);
                    console.log("pool 加回池子里面 sub.id=", sub.id, sub.priority);
                    this.incMaxPoolSize(sub.id);
                }
            })
            .catch(() => {
                console.log("pool 池子内容量不足 sub.id=", sub.id);
                failed = true;
            });

        if (failed) {
            sub.failed += 1;

            if (sub.failed > sub.retry) {
                sub.priority = 0;
            }

            if (sub.priority === 0) {
                sub.failed = 0;
                sub.priority = 0;
                setTimeout(() => this.processSubscription(sub), sub.wait);
            } else {
                this.processSubscription(sub);
            }
        }
    }

    private async processQueue(): Promise<void> {
        return Promise.resolve().then(async () => {
            while (true) {
                await this.sleep();
                console.log("pool 千年等一回");

                if (this.subscriptions.length !== 0) {
                    // Do not care about
                    const subs = this.subscriptions.filter((sub) => !sub?.running);
                    subs.forEach((sub) => this.processSubscription(sub));
                }

                if (this.onceSubscriptions.length !== 0) {
                    // Fetch data from subscriptions with highest priority
                    const subs = this.onceSubscriptions.splice(0, this.maxPoolSize);
                    const promises = subs.map((sub) => this.processSubscription(sub));
                    await Promise.all(promises);
                }
            }
        });
    }
}

export const pool = new SubscriptionPool(10);

export class UserPool {
    private readonly metadata: Map<string, any>;

    public constructor(private readonly pool: SubscriptionPool, private readonly relay: Relays) {
        this.metadata = new Map();
    }

    async fetchMetadata(
        pubkey: string,
        opts?: { force?: boolean; disableEventHandle?: boolean },
    ): Promise<MetaInfo | undefined> {
        const { force = false, disableEventHandle = false } = opts || {};
        if (this.metadata.has(pubkey)) {
            if (force) {
                this.metadata.delete(pubkey);
            } else {
                return this.metadata.get(pubkey);
            }
        }

        const id = "user-metadata";
        const subscription: Subscription = {
            id,
            priority: 1,
            filters: [{ authors: [pubkey], kinds: [0] }],
            once: true,
            relay: this.relay,
            disableEventHandle,
            success: (event: Event) => {
                try {
                    const data = JSON.parse(event.content);
                    this.metadata.set(event.pubkey, data);
                } catch (err: any) {
                    console.error("user-metadata Error=", err);
                }
            },
        };
        await this.pool.push(subscription);

        const deadline = Date.now() + 1000 * 10;

        return new Promise(async (resolve) => {
            while (true) {
                if (Date.now() >= deadline) {
                    resolve(undefined);
                    break;
                }

                if (this.metadata.has(pubkey)) {
                    const res = this.metadata.get(pubkey) as MetaInfo;
                    resolve(res);
                    break;
                }

                await this.pool.sleep();
            }
        });
    }

    fetchMetadataMore(
        authors: string[],
        opts?: { force?: boolean; disableEventHandle?: boolean },
    ): Promise<(MetaInfo | undefined)[]> {
        return Promise.all(authors.map((pubkey) => this.fetchMetadata(pubkey, opts)));
    }
}

type SubscribePushPoolOpts = { since: number; until?: number; once?: boolean };

export class RoomPool {
    public constructor(private readonly pool: SubscriptionPool, private readonly relay: Relays) {}

    async fetchMetadataMore(ids: string[]) {
        await this.sliceSubscribe({
            id: "global-room-metadata",
            priority: 10,
            filters: [
                { kinds: [40, 140], ids },
                { "kinds": [41, 141], "#e": ids },
            ],
            once: false,
            // callback: async (event: Event) => {
            //     let { content } = event;
            //     if ([40, 41].includes(event.kind)) {
            //         content = JSON.parse(content);
            //     }
            // },
        });
    }

    async sliceSubscribe(opts: {
        filters: Filter[];
        id: string;
        once: boolean;
        callback?: SubscriptionSuccess;
        priority?: number;
    }) {
        const { filters, id, once = true, callback, priority = 1 } = opts;
        // console.log("pool 推入一个订阅", id, priority, once);

        await this.pool.push({
            id,
            priority,
            filters,
            relay: this.relay,
            once,
            success: callback,
            complete: (sub: Subscription) => {
                const events = sub?.events;
                if (events) {
                    let limit = 500;
                    filters.forEach((filter) => {
                        if (typeof filter.limit !== "undefined") {
                            limit = filter.limit;
                        }
                    });
                    console.log(`pool Complete id=${sub.id} count=`, events.size, ", limit=", limit);
                    if (events.size >= limit) {
                        const newFilters = filters.map((filter) => ({
                            ...filter,
                            since: events.lastCreatedAt,
                        }));
                        this.sliceSubscribe({
                            filters: newFilters,
                            id,
                            once,
                            callback,
                            priority,
                        });
                    }
                }
            },
        });
    }

    async fetchPublicRooms(days = 14) {
        const callback = (event: Event) => {
            let roomid = "";
            if (event.kind === 40) {
                roomid = event.id;
            } else {
                roomid = event.tags.find((tags: string[]) => tags[0] === "e")?.[1] as string;
            }
            try {
                const createdAt = event.created_at * 1000;
                const content = JSON.parse(event.content);
                Events.addRoom(roomid, { ...content, pubkey: event.pubkey, created_at: createdAt });
            } catch (e) {
                //
            }
        };

        const subscribes: SubscribePushPoolOpts[] = [...Array(days).keys()].map((i) => {
            const since = utils.now() - utils.timedelta(i, "days");
            const until = since + utils.timedelta(1, "days");
            return { since, until, once: true };
        });

        subscribes.forEach(({ since, until, once = true }, index) => {
            const filters = [
                {
                    kinds: [40, 41],
                    since,
                    ...(until ? { until } : {}),
                    limit: 1000,
                },
            ];
            this.sliceSubscribe({
                filters,
                id: `public-room-metadata/${index}`,
                once,
                callback,
            });
        });

        this.sliceSubscribe({
            filters: [{ kinds: [40, 41], since: utils.now() }],
            id: "public-room-metadata",
            once: false,
            callback,
        });
    }

    async fetchRoomMessages(roomIds: string[], days = 7) {
        const subscribes: SubscribePushPoolOpts[] = [...Array(days).keys()].reverse().map((i) => {
            const since = utils.now() - utils.timedelta(i, "days");
            const until = since + utils.timedelta(1, "days");
            return { since, until, once: true };
        });

        subscribes.forEach(({ since, until, once = true }, index) => {
            const filters = [
                {
                    "kinds": [7, 42, 142],
                    "#e": roomIds,
                    since,
                    "limit": 500,
                    ...(until ? { until } : {}),
                },
            ];
            this.sliceSubscribe({
                filters,
                id: `room/${index}/message`,
                once,
                priority: 5,
            });
        });

        this.sliceSubscribe({
            filters: [
                {
                    "kinds": [7, 42, 142],
                    "#e": roomIds,
                    "since": utils.now(),
                },
            ],
            id: "global-room",
            once: false,
            priority: 4,
        });
    }

    fetchRoomMessageByMe(pubkey: string, days = 7) {
        const subscribes: SubscribePushPoolOpts[] = [...Array(days).keys()].map((i) => {
            const since = utils.now() - utils.timedelta(i, "days");
            const until = since + utils.timedelta(1, "days");
            return { since, until, once: true };
        });

        subscribes.forEach(({ since, until, once = true }, index) => {
            const filters: Filter[] = [
                {
                    "kinds": [42],
                    "#p": [pubkey],
                    since,
                    "limit": 500,
                    ...(until ? { until } : {}),
                },
            ];
            this.sliceSubscribe({
                filters,
                id: `room/${index}/message-by-me`,
                once,
                priority: 10,
            });
        });
    }

    async fetchAllRoomInfoByMe(pubkey: string, days = 7) {
        const subscribes: SubscribePushPoolOpts[] = [...Array(days).keys()].reverse().map((i) => {
            const since = utils.now() - utils.timedelta(i, "days");
            const until = since + utils.timedelta(1, "days");
            return { since, until, once: true };
        });

        subscribes.forEach(({ since, until, once = true }, index) => {
            const filters: Filter[] = [
                {
                    kinds: [0, 40, 42, 4, 7],
                    authors: [pubkey],
                    since,
                    limit: 200,
                    ...(until ? { until } : {}),
                },
                {
                    "kinds": [4, 7, 104, 140, 141],
                    "#p": [pubkey],
                    since,
                    "limit": 200,
                    ...(until ? { until } : {}),
                },
            ];
            this.sliceSubscribe({
                filters,
                id: `room/${index}/all`,
                once,
                priority: 10,
            });
        });

        this.sliceSubscribe({
            filters: [
                { kinds: [0, 40, 42, 4, 7], authors: [pubkey], since: utils.now(), limit: 500 },
                { "kinds": [4, 7, 104, 140, 141], "#p": [pubkey], "since": utils.now(), "limit": 500 },
            ],
            id: "global",
            once: false,
            priority: 4,
        });
    }

    async fetchRoomDeletionMessage(ids: string[], days = 2) {
        const subscribes: SubscribePushPoolOpts[] = [...Array(days).keys()].reverse().map((i) => {
            const since = utils.now() - utils.timedelta(i, "days");
            const until = since + utils.timedelta(1, "days");
            return { since, until, once: true };
        });

        subscribes.forEach(({ since, until, once = true }, index) => {
            const filters: Filter[] = [
                {
                    kinds: [5],
                    authors: ids,
                    since,
                    limit: 500,
                    ...(until ? { until } : {}),
                },
            ];
            this.sliceSubscribe({
                filters,
                id: `room/${index}/deletion-message`,
                once,
                priority: 2,
            });
        });

        const id = "global-user-deletion";
        if (this.pool.existSubscription(id)) {
            this.pool.unsubscribe(id);
            this.pool.incMaxPoolSize(id);
        }

        this.sliceSubscribe({
            filters: [
                {
                    kinds: [5],
                    authors: ids,
                    since: utils.now(),
                },
            ],
            id,
            once: false,
            priority: 2,
        });
    }
}
