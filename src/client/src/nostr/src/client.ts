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
} from "./Helpers";
import * as utils from "../../utils";
import { MetaInfo, TFollow } from "./@types/index";
import { EventType } from "../../@types/event";
import { IJoinedRoom } from "../../sync-accumulator";
import { MatrixEvent } from "../../models/event";
import * as olmlib from "../../crypto/olmlib";
import Key from "./Key";
import { Room } from "../../models/room";

// export { Filter as NostrFilter };
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

    private initGlobalSubscribeOnce = false;

    constructor(private readonly client: MatrixClient) {
        this.relay = new Relays(this.client);
        this.leaveRooms = new Set();
        this.readySubscribeRooms = false;
        this.memberListenRoomid = null;
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

    async initGlobalSubscribe() {
        if (this.initGlobalSubscribeOnce) {
            return;
        }
        this.initGlobalSubscribeOnce = true;

        Events.initUsersAndRooms(this.client);
        const roomIds = this.client.getRooms().map((room) => room.roomId) as string[];
        // const userIds = this.client.getUsers().map((user) => user.userId) as string[];
        const pubkey = this.client.getUserId() as string;
        this.sendSelfInfo();

        const since = utils.now() - utils.timedelta(7, "days");
        const onceFilters: Filter[] = [{ "kinds": [42], "#p": [pubkey], since }];
        this.relay.subscribe({ filters: onceFilters, id: "global-once", once: true });
        const filters: Filter[] = [
            { kinds: [0, 40, 42, 4, 7, 3], authors: [pubkey], since },
            { "kinds": [4, 7, 104, 140, 141], "#p": [pubkey], since },
        ];
        this.relay.subscribe({ filters, id: "global" });
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
        try {
            this.readySubscribeRooms = true;
            const since = utils.now() - utils.timedelta(30, "days");
            const filters: Filter[] = [{ kinds: [40, 41], since }];
            const callback = (event: Event) => {
                if (!event) {
                    return;
                }
                let roomid = "";
                if (event.kind === 40) {
                    roomid = event.id;
                } else {
                    roomid = event.tags.find((tags) => tags[0] === "e")?.[1] as string;
                }
                try {
                    const created_at = event.created_at * 1000;
                    const content = JSON.parse(event.content);
                    Events.addRoom(roomid, { ...content, pubkey: event.pubkey, created_at });
                } catch (e) {
                    //
                }
            };
            this.relay.subscribe({ filters, id: "public-rooms", disableEventHandle: true, callback });
        } catch (e) {
            //
        }
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
        const since = utils.now() - utils.timedelta(7, "days");

        const roomFilters = [
            {
                "kinds": [42, 7, 142],
                "#e": roomIds as string[],
                since,
                "limit": 1000,
            },
        ] as Filter[];
        const roomMetaFilters = [
            { kinds: [40, 140], ids: roomIds },
            { "kinds": [41, 141], "#e": roomIds },
        ] as Filter[];
        this.relay.subscribe({ filters: roomMetaFilters, id: "global-room-meta" });
        this.relay.subscribe({ filters: roomFilters, id: "global-room" });
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
            const since = utils.now() - utils.timedelta(2, "days");
            const roomFilters = [{ kinds: [5], authors: ids, since, limit: 200 }] as Filter[];
            this.relay.subscribe({ filters: roomFilters, id: "global-user-deletion" });
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
        this.relay.subscribe({ filters, id: `fetchRoomMetadatas`, once: true });
    }

    getUserName(userId: string) {
        return this.client.getUser(userId).displayName ?? "";
    }

    async fetchUserMetadatas(userIds: string[], count: number = 0) {
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

        const filters: Filter[] = [
            {
                authors: userIds,
                kinds: [0],
            },
        ];

        const result = new Promise((resolve) => {
            const callback = (event: Event | null) => {
                resolve("ok");
            };
            this.relay.subscribe({ filters, id: `fetchUserMetadatas-${Math.random()}`, once: true, callback });
        });
        // const presult = await Promise.race([utils.sleep(3 * 1000), result]);
        // if (!presult && count < 3) {
        //     setTimeout(() => {
        //         this.fetchUserMetadatas(userIds, count + 1);
        //     }, 1000);
        // }
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

        const robotMetadata = this.getRobotMatedata(room);
        if (robotMetadata && body) {
            const robotName = robotMetadata.name;
            const robotUserId = robotMetadata.userId;
            // body = body.replace(/@[a-f0-9]{64}/i, `@${robotName}`);
            // if (rawEvent.status && rawEvent?.event?.content) {
            //     rawEvent.event.content = rawEvent.event.content.replace(/@[a-f0-9]{64}/i, `@${robotName}`);
            //     room.updatePendingEvent(rawEvent, rawEvent.status)
            // }

            // @[ROBOT_NAME] hi
            if (body.match(new RegExp(`@${robotName}`))) {
                body = body.replace(`@${robotName}`, `@${robotUserId}`);
            }
        }
        const relatePersonList = (body || '')?.match?.(/@[a-f0-9]{64}/i);

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
        return new Promise((resolve) => {
            const filters: Filter[] = [
                {
                    authors: [userId],
                    kinds: [0],
                },
            ];
            const callback = (event: Event | null) => {
                if (!event) {
                    return resolve({});
                }

                const content = JSON.parse(event.content) as MetaInfo;
                resolve({
                    avatar_url: content.picture || "",
                    displayname: content.name || "",
                    about: content.about || "",
                });
            };
            this.relay.subscribe({
                filters,
                id: `fetchUserMetadata-${userId}-${Math.random()}`,
                callback,
                once: true,
            });
        });
    }
    async followUser(followInfo: TFollow, follow: boolean) {
        const userId = this.client.getUserId() as string;
        const currentPeople = this.client.getContact(userId);
        const tags = currentPeople.map((i) => {
            return ["p", i.userId, "", i.name ?? ""];
        });
        const index = tags.findIndex((i) => i[1] === followInfo.userId);
        if (follow) {
            if (index === -1) {
                tags.push(["p", followInfo.userId, "", followInfo.name]);
            }
        } else {
            if (index !== -1) {
                tags.splice(index, 1);
            }
        }
        const create_at = Date.now();
        const event = {
            kind: 3,
            created_at: Math.floor(create_at / 1000),
            tags,
            content: "",
            pubkey: userId,
        } as Event;
        await this.handPublishEvent(event);
        Events.handle(this.client, event);

        await this.relay.publishAsPromise(event);
    }
    async setUserMetaData({ avatar_url, displayname }: { avatar_url?: string; displayname?: string }) {
        const userId = this.client.getUserId() as string;
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

    getRobotPubkey() {
        return 'd4826f0c7ea24b6c7de1d55ed5c543185729820057e9434c5315859386ce7950';
    }

    getRobotMatedata(room: Room) {
        const members = room.getJoinedMembers()
          .map((member) => ({
            name: member?.user?.displayName ?? member.name,
            userId: member.userId,
          }));
        return members.find(m => m.userId === this.getRobotPubkey())
    }
}

export default NostrClient;
