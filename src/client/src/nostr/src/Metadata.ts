import { Filter, Event } from "nostr-tools";
import Relays from "./Relays";
import { MetaInfo } from "./@types/index";
import * as utils from "../../utils";

type QueueUser = {
    userId: string;
    count: number;
};
export class MetadataPool {
    private queueUsers: Map<string, number>;

    private queueRooms: Map<string, number>;

    private metadataUsers: Map<string, MetaInfo>;

    private metadataRooms: Map<string, any>;

    private relay: Relays;

    private maxPopUserNumber: number;

    private maxRetryCount: number;

    constructor(relay: Relays, maxPopUserNumber = 5, maxRetryCount = 3) {
        this.relay = relay;
        this.queueUsers = new Map();
        this.queueRooms = new Map();
        this.metadataUsers = new Map();
        this.metadataRooms = new Map();
        this.maxPopUserNumber = maxPopUserNumber;
        this.maxRetryCount = maxRetryCount;

        this.poolUser();
    }

    popUser(): QueueUser | null {
        if (this.queueUsers.size === 0) {
            return null;
        }

        const [userId, count] = [...this.queueUsers.entries()]
            .filter(([, retryCount]) => retryCount < this.maxRetryCount)
            .shift() as [string, number];
        this.queueUsers.delete(userId);
        return { userId, count };
    }

    poolUser() {
        Promise.resolve().then(async () => {
            const failedUsers: { userId: string; count: number }[] = [];

            while (true) {
                if (this.queueUsers.size === 0) {
                    await utils.sleep(50);
                    continue;
                }

                const readyUsers = [...Array(this.maxPopUserNumber).keys()]
                    .map(() => this.popUser())
                    .filter(Boolean) as QueueUser[];

                try {
                    await this.pull(readyUsers.map((user) => user.userId));
                } catch (err: any) {
                    const user = readyUsers.find((readyUser) => readyUser.userId === err.userId) as {
                        userId: string;
                        count: number;
                    };
                    failedUsers.push({
                        ...user,
                        count: user.count + 1,
                    });
                }

                failedUsers.forEach(({ userId, count }) => {
                    this.queueUsers.set(userId, count);
                });
            }
        });
    }

    pull(userIds: string[]) {
        return new Promise((resolve, reject) => {
            const res = {
                data: new Array(userIds.length).fill(null),
                count: 0,
            };

            const callback = (event: Event | null) => {
                if (event === null) {
                    resolve(res.data);
                    return;
                }

                if (userIds.includes(event.pubkey)) {
                    const index = userIds.findIndex((userId) => event.pubkey === userId);
                    res.data[index] = JSON.parse(event.content);
                    this.metadataUsers.set(event.pubkey, res.data[index]);
                    res.count += 1;
                }

                const count = this.queueUsers.has(event.pubkey) ? (this.queueUsers.get(event.pubkey) as number) : 0;
                this.queueUsers.set(event.pubkey, count + 1);

                if (res.count === userIds.length) {
                    resolve(res.data);
                }
            };

            const filters: Filter[] = [
                {
                    authors: [...userIds],
                    kinds: [0],
                },
            ];

            this.relay.subscribe({ filters, id: "fetchMetadataUsers", once: true, callback });
        });
    }

    fetchUser(userId: string): MetaInfo | Promise<MetaInfo | undefined> {
        if (this.metadataUsers.has(userId)) {
            return this.metadataUsers.get(userId) as MetaInfo;
        }

        const deadline = Date.now() + 1000 * 5;

        return new Promise(async (resolve, reject) => {
            if (!this.queueUsers.has(userId)) {
                this.queueUsers.set(userId, 0); // 默认计数0
            }

            if ((this.queueUsers.get(userId) as number) > this.maxRetryCount) {
                this.queueUsers.set(userId, 0); // 归零
            }

            let res: MetaInfo | undefined;
            while (true) {
                if (Date.now() >= deadline) {
                    break;
                }

                if (this.metadataUsers.has(userId)) {
                    res = this.metadataUsers.get(userId) as MetaInfo;
                    break;
                }

                await utils.sleep(50);
            }

            resolve(res);
        });
    }
}
