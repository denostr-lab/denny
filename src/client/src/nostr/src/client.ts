import { Filter, Event, getEventHash } from "nostr-tools";
import { MatrixClient } from "../../client";
import Relays from "./Relays";
import Events from "./Events";
import Key from "./Key";
import * as utils from "../../utils";
import { MetaInfo } from "./@types/index";
import { EventType } from "../../@types/event";
import { IJoinedRoom } from "../../sync-accumulator";
import { MatrixEvent } from "../../models/event";
import * as olmlib from "../../crypto/olmlib";

// export { Filter as NostrFilter };
let allRooms = [];
let allUsers = [];
interface RomMetaUpdateData {
    name: string;
    about: string;
    picture: string;
}
class NostrClient {
    public relay: Relays;

    private leaveRooms: Set<string>;

    public readySubscribeRooms: boolean;

    constructor(private readonly client: MatrixClient) {
        this.relay = new Relays(this.client);
        this.leaveRooms = new Set();
        this.readySubscribeRooms = false;
    }

    init() {
        this.relay.init();

        const leaveRooms = localStorage.getItem("leave_rooms");
        if (leaveRooms) {
            [...JSON.parse(leaveRooms)].forEach((roomId) => this.leaveRooms.add(roomId));
        }
        // 把当前所有的用户加载进来
        Events.initUsersAndRooms(this.client);
    }

    initGlobalSubscribe() {
        const since = utils.now() - utils.timedelta(30, "days");
        const roomIds = this.client.getRooms().map((room) => room.roomId) as string[];
        const userIds = this.client.getUsers().map((user) => user.userId) as string[];

        const pubkey = this.client.getUserId() as string;
        const onceFilters: Filter[] = [{ "kinds": [42], "#p": [pubkey], since }];
        const filters: Filter[] = [
            { kinds: [0, 40, 42, 4, 7], authors: [pubkey], since },
            { "kinds": [4, 7, 104], "#p": [pubkey], since },
        ];

        this.relay.subscribe({ filters: onceFilters, id: "global-once", once: true });

        this.relay.subscribe({ filters, id: "global" });

        if (roomIds?.length) {
            this.subscribeRooms(roomIds);
        }
        if (userIds?.length) {
            this.subscribeUsersDeletion(userIds);
        }
    }

    subscribePublicRooms() {
        this.readySubscribeRooms = true;
        const since = utils.now() - utils.timedelta(90, "days");
        const filters: Filter[] = [{ kinds: [40, 41], since }];
        this.relay.subscribe({ filters, id: "public-rooms" });
    }

    unsubscribePublicRooms() {
        this.relay.unsubscribe("public-rooms");
        this.readySubscribeRooms = false;
    }

    subscribeRooms(roomsIds: string[]) {
        const since = utils.now() - utils.timedelta(30, "days");
        const exitedRoomIds = this.client.getRooms().map((room) => room.roomId) as string[];
        const roomIds = [...new Set([...roomsIds, ...exitedRoomIds])].filter((i) => !Events.userProfileMap[i]);
        const publicGroupMessage = [41, 42];
        const privateGroupMessage = [141, 142]; // 拿到房间的
        // 这里要过滤掉用户

        if (roomIds.length) {
            const roomFilters = [
                { "kinds": [...publicGroupMessage, ...privateGroupMessage], "#e": roomIds as string[], since },
                { kinds: [40, 140], ids: roomIds, since },
                { kinds: [7], ids: roomIds, since },
            ] as Filter[];
            this.relay.subscribe({ filters: roomFilters, id: "global-room" });
        }
    }

    subscribeUsersDeletion(userIds: string[]) {
        const exitedIds = this.client.getRooms().map((room) => room.roomId) as string[];
        const ids = [...new Set([...userIds, ...exitedIds])];
        if (ids?.length) {
            const roomFilters = [{ kinds: [0, 5], authors: ids }];
            this.relay.subscribe({ filters: roomFilters, id: "global-user-deletion" });
        }
    }

    getBufferEvent() {
        const data = Events.getBufferEvent();
        try {
            let joinRoomIds = Object.keys(data?.rooms?.join || {}) as string[];
            let rooms = Object.values(data?.rooms?.join || {}) as IJoinedRoom[];
            const userIds = new Set();
            const roomIds = [];
            rooms.forEach((room, index) => {
                const roomId = joinRoomIds[index];
                if (!this.hasLeaveRoom(roomId)) {
                    roomIds.push(roomId);
                    room.state.events
                        .filter((i) => i.type === EventType.RoomMember)
                        .forEach((i) => userIds.add(i.sender));
                }
            });
            this.fetchUserMetadatas([...userIds] as string[]);

            if (roomIds?.length) {
                const prevAllids = allRooms;
                console.info(prevAllids, "asasas ");
                let currentAllIds = [...allRooms, ...roomIds];
                currentAllIds = [...new Set(currentAllIds)];
                const notSmae = currentAllIds.some((i) => !prevAllids.find((j) => i === j));
                if (notSmae || currentAllIds.length !== prevAllids.length) {
                    allRooms = currentAllIds;
                    console.info(allRooms, "allRoomsallRooms");
                    this.subscribeRooms(allRooms);
                }
            }
        } catch (e) {
            console.info(e, "错误");
        }
        try {
            const ids = (data?.presence?.events || []).map((i) => i.user_id).filter(Boolean);
            if (ids?.length) {
                const prevAllUsers = allUsers;
                console.info(prevAllUsers, "asasas ");

                let currentAllUsers = [...allUsers, ...ids];
                currentAllUsers = [...new Set(currentAllUsers)];
                const notSmae = currentAllUsers.some((i) => !prevAllUsers.find((j) => i === j));
                if (notSmae || currentAllUsers.length !== prevAllUsers.length) {
                    allUsers = currentAllUsers;
                    this.subscribeUsersDeletion(allUsers);
                }
            }
        } catch (e) {
            console.info(e, "错误");
        }
        return data;
    }

    getLeaveRooms() {
        return this.leaveRooms;
    }

    saveLeaveRooms() {
        localStorage.setItem("leave_rooms", JSON.stringify([...this.getLeaveRooms().values()]));
    }

    hasLeaveRoom(roomId: string) {
        return this.leaveRooms.has(roomId);
    }

    leaveRoom(roomId: string) {
        this.leaveRooms.add(roomId);
        this.saveLeaveRooms();
    }

    joinRoom(roomId: string) {
        this.leaveRooms.delete(roomId);
        this.saveLeaveRooms();
    }

    async handPublishEvent(event: Event) {
        if (!event.sig) {
            if (!event.tags) {
                event.tags = [];
            }
            event.content = event.content || "";
            event.created_at = event.created_at || Math.floor(Date.now() / 1000);
            event.pubkey = Key.getPubKey();
            event.id = getEventHash(event);
            event.sig = await Key.sign(event);
        }

        if (!(event.id && event.sig)) {
            throw new Error("Invalid event");
        }
    }

    async fetchRoomMetadatas(roomIds: string[]) {
        /* 
        批量获取房间的MetaData信息,
        如果出现中继提示连接过多的错误，则后续继续获取
    */
        if (!roomIds?.length) return;
        const filters: Filter[] = [
            {
                ids: roomIds,
                kinds: [40],
            },
            {
                "#e": roomIds,
                "kinds": [41],
            },
        ];

        this.relay.subscribe({ filters, id: `fetchRoomMetadatas${Math.random()}`, once: true });
    }

    getUserName(userId: string) {
        return this.client.getUser(userId).displayName ?? "";
    }

    fetchUserMetadatas(userIds: string[]) {
        /*
        批量获取房间的MetaData信息,
        如果出现中继提示连接过多的错误，则后续继续获取
    */
        if (!userIds?.length) return;
        const filters: Filter[] = [
            {
                authors: userIds,
                kinds: [0],
            },
        ];
        this.relay.subscribe({ filters, id: `fetchUserMetadatas${Math.random()}`, once: true });
    }

    async createRoom(metadata: RomMetaUpdateData) {
        console.log("createRoom() --------------- metadata=", metadata);
        if (metadata.isDM) {
            const event = {
                kind: 4,
                content: "nostr-create-room",
                tags: [["p", metadata.name, ""]],
            } as Event;
            await this.handPublishEvent(event);
            Events.handle(this.client, event);
            return { id: metadata.name };
        }

        if (metadata?.visibility === "private") {
            const sessionId = this.client.crypto.olmDevice.createOutboundGroupSession();
            const sessionKey = this.client.crypto.olmDevice.getOutboundGroupSessionKey(sessionId);

            const createEncryptedChannelEvent: Event = {
                kind: 140,
                content: JSON.stringify({
                    name: metadata.name || "Empty Room",
                    about: metadata.about || "",
                    ...{ picture: metadata.picture || "" },
                }),
                tags: [["p", Key.getPubKey()]],
            };
            createEncryptedChannelEvent.content =
                this.client.crypto.olmDevice.encryptGroupMessage(sessionId, createEncryptedChannelEvent.content) +
                `?sid=${sessionId}`;
            await this.handPublishEvent(createEncryptedChannelEvent);

            const communicateMegolmSessionEvent: Event = {
                kind: 104,
                content: JSON.stringify({
                    session_id: sessionId,
                    session_key: sessionKey,
                    room_id: createEncryptedChannelEvent.id,
                }),
                // created_at: Math.floor(Date.now() / 1000) + 1,
            };
            communicateMegolmSessionEvent.content = await Key.encrypt(communicateMegolmSessionEvent.content);
            await this.handPublishEvent(communicateMegolmSessionEvent);

            const events = [communicateMegolmSessionEvent, createEncryptedChannelEvent];
            console.log("events==========", events);
            const promises = events.map(async (event: Event) => {
                this.relay.publish(event);
                await utils.sleep(2000);
                return event;
            });
            await Promise.all(promises);

            return createEncryptedChannelEvent;
        }

        const event = {
            kind: 40,
            content: JSON.stringify({
                name: metadata.name || "Empty Room",
                about: metadata.about || "",
                ...{ picture: metadata.picture || "" },
            }),
        } as Event;
        await this.handPublishEvent(event);
        this.relay.publish(event);
        return event;
    }

    async updateRoomMetaData(roomId: string, metadata: RomMetaUpdateData) {
        const event = {
            kind: 41,
            content: JSON.stringify({
                ...metadata,
                ...{ picture: metadata.picture || "" },
            }),
            tags: [["e", roomId]],
        } as Event;
        await this.handPublishEvent(event);
        this.relay.publish(event);
        return event;
    }

    async sendMessage(rawEvent: MatrixEvent) {
        // 这里处理各种需要发送的消息

        const content = rawEvent.getWireContent();
        const roomId: string = rawEvent.getRoomId() as string;
        const room = this.client.getRoom(roomId);
        if (!room) {
            return;
        }
        const userId = this.client.getUserId() as string;
        let body = content?.body || content?.ciphertext?.[userId]?.body;
        if (content.url) {
            body = content.url;
        }
        const encryptionState = room.currentState.getStateEvents(EventType.RoomEncryption, "");
        const encryptionStateContent = encryptionState?.getContent?.();
        const isDM = encryptionStateContent?.algorithm === olmlib.SECP256K1;
        const isPrivateGroup = encryptionStateContent?.algorithm === olmlib.MEGOLM_ALGORITHM;
        const isDeleteEvent = rawEvent.event.type === EventType.RoomRedaction;
        const emojiRelyEventId = content?.["m.relates_to"]?.["event_id"];
        const citedEventId = content?.["m.relates_to"]?.["m.in_reply_to"];
        const relatePersonList = content?.body?.match?.(/@[\w]{63}/gi);

        // 获取kind
        const _getKind = () => {
            let kind = isDM ? 4 : 42;
            if (emojiRelyEventId) {
                // 回复表情
                kind = 7;
            } else if (isDeleteEvent) {
                // 删除事件
                kind = 5;
            }
            if (isPrivateGroup) {
                kind = 142;
            }
            return kind;
        };
        const _getTags = () => {
            let tags = isDM ? [["p", roomId]] : [["e", roomId, "", "root"]];
            if (isDM && citedEventId?.event_id) {
                tags.push(["e", citedEventId.event_id, "", "reply"]);
            } else if (emojiRelyEventId) {
                const emojiRelyEvent = room.findEventById(emojiRelyEventId);

                if (!body) {
                    body = content?.["m.relates_to"]?.key;
                }
                if (emojiRelyEvent?.sender?.userId) {
                    tags.push(["e", emojiRelyEventId, "", "reply"], ["p", emojiRelyEvent.sender.userId]);
                }
            } else if (isDeleteEvent) {
                body = content.reason ?? "";
                tags = [["e", rawEvent.event.redacts]];
            } else if (relatePersonList?.length) {
                relatePersonList.forEach((pubkey: string) => {
                    tags.push(["p", pubkey.replace("@", "")]);
                });
            }
            return tags;
        };
        const kind = _getKind();
        const tags = _getTags();
        let event = {
            kind,
            created_at: Math.floor(Date.now() / 1000),
            tags,
            content: body,
            pubkey: userId,
        } as Event;

        console.log("nbnb ---- content=", event);
        console.log("nbnb ---- roomId=", roomId);
        console.log("nbnb ---- userId=", userId);
        console.log("nbnb ---- body=", body);
        console.log("nbnb ---- room.currentState=", room.currentState.events);
        return;

        try {
            await this.handPublishEvent(event);
            this.relay.publish(event);
            if (event.kind === 7) {
                Events.handle(this.client, event);
            }
        } catch (e) {
            console.info(e, "发送错误");
        }
        console.info("你来说,", event);
        return { event_id: event.id };
    }

    async fetchUserMetadata(userId: string): Promise<{ avatar_url?: string; displayname?: string }> {
        // 从中继中获取单个用户的信息
        return new Promise((resolve) => {
            const filters: Filter[] = [
                {
                    authors: [userId],
                    kinds: [0],
                },
            ];
            const callback = (event: Event) => {
                const content = JSON.parse(event.content) as MetaInfo;
                const avatar_url = content.picture || "";
                const displayname = content.name || "";
                resolve({ avatar_url, displayname });
            };
            this.relay.subscribe({
                filters,
                id: `fetchUserMetadata-${userId}`,
                callback,
            });
        });
    }

    async setUserMetaData({ avatar_url, displayname }: { avatar_url?: string; displayname?: string }) {
        const userId = this.client.getUserId();
        const user = this.client.getUser(userId);
        const content = {
            picture: avatar_url ?? user.avatarUrl,
            name: displayname ?? user.displayName,
            about: "",
        } as MetaInfo;
        let event = {
            kind: 0,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: JSON.stringify(content),
            pubkey: userId,
        } as Event;
        await this.handPublishEvent(event);
        this.relay.publish(event);
    }

    get totalRoomCount() {
        return [...Events.getRooms().values()].length;
    }

    getPublicRooms(search: string, start = 0, end = 0) {
        let rooms = [...Events.getRooms().values()].filter((room) => {
            const nameMatch = new RegExp(`.*${search}.*`).test(room.name);
            const aboutMatch = new RegExp(`.*${search}.*`).test(room.about);
            const idMatch = new RegExp(`.*${search}.*`).test(room.roomId);
            return nameMatch || aboutMatch || idMatch;
        });
        if (start !== 0 && end !== 0) {
            rooms = [...rooms.slice(start, end)];
        }

        return rooms.map((room) => ({
            avatar_url: room.picture,
            canonical_alias: room.roomId,
            guest_can_join: true,
            join_rule: "public",
            name: room.name,
            num_joined_members: 0,
            room_id: room.roomId,
            topic: room.about,
            world_readable: true,
        }));
    }
    handleDeCryptedRoomMeta(event: MatrixEvent) {
        Events.handleDeCryptedRoomMeta(this.client, event);
    }
}

export default NostrClient;
