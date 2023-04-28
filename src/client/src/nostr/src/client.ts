import { Filter, Event } from "nostr-tools";
import { MatrixClient } from "../../client";
import Relays from "./Relays";
import Events from "./Events";
import {
    createKind104Event,
    createKind140Event,
    createKind141Event,
    handlePublishEvent,
    initRoomKeyTask,
    removeLocalTask,
    splitRequest,
} from "./Helpers";
import * as utils from "../../utils";
import { MetaInfo } from "./@types/index";
import { EventType } from "../../@types/event";
import { IJoinedRoom } from "../../sync-accumulator";
import { MatrixEvent } from "../../models/event";
import * as olmlib from "../../crypto/olmlib";
import Key from "./Key";
import { Room } from "../../models/room";
import { pool, UserPool, RoomPool } from "./Pool";

// export { Filter as NostrFilter };
let allUsers: string[] = [];
export interface UpdateRoomMetadata {
    name: string;
    about: string;
    picture: string;
}
class NostrClient {
    public relay: Relays;

    private leaveRooms: Set<string>;

    public readySubscribeRooms: boolean;

    public memberListenRoomid: string | null;

    private userPool: UserPool;

    private roomPool: RoomPool;

    constructor(private readonly client: MatrixClient) {
        this.relay = new Relays(this.client);
        this.leaveRooms = new Set();
        this.readySubscribeRooms = false;
        this.memberListenRoomid = null;
        this.userPool = new UserPool(pool, this.relay);
        this.roomPool = new RoomPool(pool, this.relay);
    }

    init() {
        this.relay.init();

        const leaveRooms = localStorage.getItem("leave_rooms");
        if (leaveRooms) {
            [...JSON.parse(leaveRooms)].forEach((roomId) => this.leaveRooms.add(roomId));
        }
        // 把当前所有的用户加载进来
        // Events.initUsersAndRooms(this.client);
        this.initRoomberListen();
    }

    handleFilters(
        batchFilters: Filter[][],
        opts: {
            since?: number;
            until?: number;
            isLastActiveTimestamp?: boolean;
            alwaysOnce?: boolean;
            initialSeens?: Map<string, number>;
        },
    ) {
        const { since, until, isLastActiveTimestamp = false } = opts;

        const newFilters: Filter[] = [];
        const filters = batchFilters.shift() as Filter[];
        filters.forEach((filter) => {
            if (filter?.since) {
                delete filter.since;
            }
            if (filter?.until) {
                delete filter.until;
            }

            newFilters.push({
                ...filter,
                since,
                ...(!isLastActiveTimestamp ? { until } : {}),
            });
        });
        return newFilters;
    }

    async initGlobalSubscribe() {
        Events.initUsersAndRooms(this.client);
        const roomIds = this.client.getRooms().map((room) => room.roomId) as string[];
        // const userIds = this.client.getUsers().map((user) => user.userId) as string[];
        const pubkey = this.client.getUserId() as string;
        this.sendSelfInfo();

        this.roomPool.fetchRoomMessageByMe(pubkey, 7);
        this.roomPool.fetchAllRoomInfoByMe(pubkey, 7);

        if (roomIds?.length) {
            this.subscribeRooms([...new Set(roomIds)]);
        }

        // if (userIds?.length) {
        //     this.subscribeUsersDeletion(userIds);
        // }
    }
    async sendSelfInfo() {
        const key = localStorage.getItem("user_meta_create");
        if (!key) {
            return;
        }
        const data = localStorage.getItem("nostr.profile");
        if (!data) return;

        try {
            const jsonData = JSON.parse(data);
            if (!jsonData) {
                return;
            }
            let t: number;
            await new Promise((res) => {
                t = setInterval(() => {
                    const relays = this.relay.getRelays();
                    for (const relay of relays) {
                        if (this.relay.getStatus(relay) === 1) {
                            clearInterval(t);
                            res(null);
                            break;
                        }
                    }
                }, 500);
            });
            this.setUserMetaData({ displayname: jsonData.name, avatar_url: "" });
        } catch (e) {
            console.info(e, "erro init user");
        } finally {
            localStorage.removeItem("user_meta_create");
        }
    }

    subscribePublicRooms() {
        this.readySubscribeRooms = true;
        this.roomPool.fetchPublicRooms();
    }

    unsubscribePublicRooms() {
        this.relay.unsubscribe("public-rooms");
        this.readySubscribeRooms = false;
    }

    getLastActiveTimestamp(room: Room) {
        const events = room
            .getLiveTimeline()
            .getEvents()
            .sort((a, b) => (a.getTs() > b.getTs() ? 1 : -1));
        if (events.length) {
            const lastEvent = events[events.length - 1];
            return lastEvent.getTs();
        }
        return Number.MIN_SAFE_INTEGER;
    }

    async subscribeRooms(roomIds: string[]) {
        // const exitedRoomIds = this.client.getRooms().map((room) => room.roomId) as string[];
        // const roomIds = [...new Set([...roomsIds, ...exitedRoomIds])].filter((i) => !Events.userProfileMap[i]);
        if (!roomIds.length) {
            return;
        }

        this.roomPool.fetchMetadataMore(roomIds);
        this.roomPool.fetchRoomMessages(roomIds, 7);
    }

    async initRoomberListen() {
        while (true) {
            if (!this.memberListenRoomid) {
                await utils.sleep(3000);
                continue;
            }
            const room = this.client.getRoom(this.memberListenRoomid);
            if (!room) {
                await utils.sleep(3000);
                continue;
            }
            const userIds = room.getMembers().map((member) => member.userId);
            let change = false;
            for (const id of userIds) {
                if (!Events.roomMemberList.has(id)) {
                    Events.roomMemberList.add(id);
                    change = true;
                }
            }
            if (!change) {
                await utils.sleep(3000);
                continue;
            }
            this.subscribeUsersDeletion(userIds);
            await utils.sleep(3000);
        }
    }

    subscribeUsersDeletionRoom(roomid: string) {
        if (this.memberListenRoomid !== roomid) {
            Events.roomMemberList.clear();
        }
        this.memberListenRoomid = roomid;
    }

    subscribeUsersDeletion(userIds: string[]) {
        // const exitedIds = this.client.getUsers().map((user) => user.userId) as string[];
        const ids = [...new Set(userIds)];
        if (ids?.length) {
            this.userPool.fetchMetadataMore(ids);
            this.roomPool.fetchRoomDeletionMessage(ids, 2);
        }
    }

    getBufferEvent() {
        const data = Events.getBufferEvent();
        try {
            let joinRoomIds = Object.keys(data?.rooms?.join || {}) as string[];
            let rooms = Object.values(data?.rooms?.join || {}) as IJoinedRoom[];
            const userIds = new Set();
            const roomIds: string[] = [];
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
                let roomChange = false;
                roomIds.forEach((i) => {
                    if (!Events.allRooms.has(i)) {
                        Events.allRooms.add(i);
                        roomChange = true;
                    }
                });
                if (roomChange) {
                    this.subscribeRooms([...Events.allRooms]);
                }
            }
        } catch (e) {
            console.info(e, "getBufferEvent error");
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
        // this.relay.removeLastSince(`room/${roomId}`);
        this.saveLeaveRooms();
    }

    joinRoom(roomId: string) {
        Events.handJoinRoom(this.client, roomId);
        this.leaveRooms.delete(roomId);
        this.saveLeaveRooms();
    }

    async handPublishEvent(event: Event) {
        await handlePublishEvent(event);
    }

    getUserName(userId: string) {
        return this.client.getUser(userId).displayName ?? "";
    }

    async fetchUserMetadatas(userIds: string[]) {
        /*
            批量获取房间的MetaData信息,
            如果出现中继提示连接过多的错误，则后续继续获取
        */
        userIds = userIds.filter((i) => {
            return !Events.userProfileMap[i];
        });
        userIds = userIds.filter((i) => {
            if (!Events.fetchedUsers.has(i)) {
                Events.fetchedUsers.add(i);
                return true;
            }
            return false;
        });
        if (!userIds?.length) return;

        await this.userPool.fetchMetadataMore(userIds);
    }

    async createRoom(metadata: UpdateRoomMetadata) {
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

        // encrypt channel
        if (metadata?.visibility === "private") {
            const olmDevice = this.client.crypto.olmDevice!;
            const sessionId = olmDevice.createOutboundGroupSession();
            const key = olmDevice.getOutboundGroupSessionKey(sessionId);
            const session = {
                sessionId,
                sessionKey: key.key,
            };
            const event140 = await createKind140Event(
                this.client,
                JSON.stringify({
                    name: metadata.name || "Empty Room",
                    about: metadata.about || "",
                    ...{ picture: metadata.picture || "" },
                }),
                session,
            );
            await createKind104Event(this.client, event140.id, Key.getPubKey(), session);
            return event140;
        }

        // public channel
        const event = {
            kind: 40,
            content: JSON.stringify({
                name: metadata.name || "Empty Room",
                about: metadata.about || "",
                ...{ picture: metadata.picture || "" },
            }),
        } as Event;
        await this.handPublishEvent(event);
        await this.relay.publishAsPromise(event);
        return event;
    }

    async updateRoomMetaData(roomId: string, metadata: UpdateRoomMetadata) {
        const userId = this.client.getUserId() as string;
        const room = this.client.getRoom(roomId) as Room;
        const encryptionState = room!.currentState.getStateEvents(EventType.RoomEncryption, "");
        const encryptionStateContent = encryptionState?.getContent?.();
        const isPrivateGroup = encryptionStateContent?.algorithm === olmlib.MEGOLM_ALGORITHM;
        let content = JSON.stringify({
            ...metadata,
            ...{ picture: metadata.picture || "" },
        });
        let toPubkeys: any = [];
        if (isPrivateGroup) {
            toPubkeys = [Key.getPubKey(), ...room!.getMembers().map((member) => member.userId)];
            toPubkeys = [...new Set(toPubkeys)].map((i) => ["p", i]);
            // 直接对房间进行加密
            const localEvent = new MatrixEvent({
                event_id: `${Math.random()}`,
                content: {
                    body: {
                        ...metadata,
                        ...{ picture: metadata.picture || "" },
                    },
                },
                user_id: userId,
                sender: userId,
                room_id: roomId,
                origin_server_ts: new Date().getTime(),
            });

            await this.client.crypto.encryptEvent(localEvent, room);
            const cipherResult = localEvent.getWireContent();
            content = `${cipherResult.ciphertext}?sid=${cipherResult.session_id}`;
        }
        const event = {
            kind: isPrivateGroup ? 141 : 41,
            content,
            tags: [["e", roomId], ...toPubkeys],
        } as Event;
        await this.handPublishEvent(event);
        await this.relay.publishAsPromise(event);
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
            } else if (isPrivateGroup) {
                kind = 142;
                body = `${content.ciphertext}?sid=${content.session_id}`;
            }
            return kind;
        };
        const _getTags = () => {
            let tags = isDM ? [["p", roomId]] : [["e", roomId, "", "root"]];
            if (emojiRelyEventId) {
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
            }
            if (relatePersonList?.length) {
                relatePersonList.forEach((pubkey: string) => {
                    const pubkeyReplace = pubkey.replace("@", "");
                    const hitOne = tags.find((i) => i[0] === "p" && i[1] === pubkeyReplace);
                    if (!hitOne) {
                        tags.push(["p", pubkeyReplace]);
                    }
                });
            }
            if (citedEventId?.event_id) {
                const hitOne = tags.find((i) => i[0] === "e" && i[3] === "reply" && i[1] === citedEventId.event_id);
                if (!hitOne) {
                    tags.push(["e", citedEventId.event_id, "", "reply"]);
                }
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
        try {
            await this.handPublishEvent(event);
            rawEvent.replaceLocalNostrEventId(event.id);
            await this.relay.publishAsPromise(event);

            if (event.kind === 7) {
                Events.handle(this.client, event);
            }
        } catch (e) {
            console.info(e, "send message error");
        }
        return { event_id: event.id };
    }

    async fetchUserMetadata(userId: string): Promise<{ avatar_url?: string; displayname?: string; about?: string }> {
        // 从中继中获取单个用户的信息
        const user = await this.userPool.fetchMetadata(userId, { force: true });
        if (!user) {
            return {};
        }
        return {
            avatar_url: user.picture || "",
            displayname: user.name || "",
            about: user.about || "",
        };
    }

    async setUserMetaData({ avatar_url, displayname }: { avatar_url?: string; displayname?: string }) {
        const userId = this.client.getUserId();
        localStorage.removeItem("user_meta_create");
        const user = this.client.getUser(userId);
        const content = {
            picture: avatar_url ?? user?.avatarUrl,
            name: displayname ?? user?.displayName,
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
        await this.relay.publishAsPromise(event);
    }

    get totalRoomCount() {
        return [...Events.getRooms().values()].length;
    }

    getPublicRooms(search: string, start = 0, end = 0) {
        let rooms = [...Events.getRooms().values()].filter((room) => {
            const nameMatch = new RegExp(`.*${search}.*`, "i").test(room.name);
            const aboutMatch = new RegExp(`.*${search}.*`, "i").test(room.about);
            const idMatch = new RegExp(`.*${search}.*`, "i").test(room.roomId);
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

    createKind104Event(roomId: string, pubkey: string, session?: any) {
        if (!session) {
            const olmDevice = this.client.crypto.olmDevice!;
            const sessionId = olmDevice.createOutboundGroupSession();
            const key = olmDevice.getOutboundGroupSessionKey(sessionId);
            session = {
                sessionId,
                sessionKey: key.key,
            };
        }

        return createKind104Event(this.client, roomId, pubkey, session);
    }

    async inviteUserToEncryptedChannel(
        room: { id: string; relayUrl?: string },
        invitePubkeys: string[],
        kickPubkeys?: string[],
    ) {
        // 查找创建event事件
        const currentRoom = this.client.getRoom(room.id);
        if (!currentRoom) {
            return;
        }

        let toPubkeys = [
            ...new Set(
                [
                    Key.getPubKey(),
                    ...currentRoom
                        .getMembers()
                        .filter((i) => i.membership !== "leave")
                        .map((member) => member.userId),
                ].filter(Boolean),
            ),
        ];
        let newToPubkeys: string[] = [];

        // 剔除 kick 列表内的 pubkey
        if (kickPubkeys && Array.isArray(kickPubkeys)) {
            newToPubkeys = toPubkeys.filter((pubkey) => !kickPubkeys.includes(pubkey));
        }

        invitePubkeys.forEach((pubkey) => {
            if (!newToPubkeys.includes(pubkey)) {
                newToPubkeys.push(pubkey);
            }
        });

        toPubkeys = [...new Set(toPubkeys)].sort();
        newToPubkeys = [...new Set(newToPubkeys)].sort();

        if (toPubkeys.join("") === newToPubkeys.join("")) {
            return;
        }

        const { currentState } = currentRoom;
        const roomTopic = currentState.getStateEvents("m.room.topic")[0]?.getContent().topic;

        const metadata: UpdateRoomMetadata = {
            name: currentRoom.name,
            about: roomTopic || "",
            picture: currentRoom.getAvatarUrl(this.client.baseUrl, 24, 24, "crop") || "",
        };

        const olmDevice = this.client.crypto.olmDevice!;
        const sessionId = olmDevice.createOutboundGroupSession();
        const key = olmDevice.getOutboundGroupSessionKey(sessionId);
        const session = {
            sessionId,
            sessionKey: key.key,
        };
        const event141 = await createKind141Event(
            this.client,
            room,
            JSON.stringify(metadata),
            newToPubkeys,
            session.sessionId,
        );

        // 初始化共享RoomKey
        initRoomKeyTask(room.id, session, newToPubkeys);

        await Promise.all(
            newToPubkeys.map(async (pubkey) => {
                const res = await createKind104Event(this.client, room.id, pubkey, session);
                if (res) {
                    removeLocalTask(session.sessionId, [pubkey]);
                }
            }),
        );

        return event141;
    }

    getUserPubKey(pubKey: string) {
        return Key.toNostrBech32Address(pubKey, "npub");
    }

    getUserPrivateKey(privateKey: string) {
        return Key.toNostrBech32Address(privateKey, "nsec");
    }
    handSetRoomUnReadCount(roomid: string, count: number) {
        Events.handSetRoomUnReadCount(this.client, roomid, count);
    }
}

export default NostrClient;
