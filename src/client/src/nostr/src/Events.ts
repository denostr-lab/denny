import { IStateEvent, ISyncResponse } from "../../sync-accumulator";
import { MatrixClient } from "../../client";

// import IndexedDB from './IndexedDB';
import Key from "./Key";
import {
    ROOM_META_TYPES,
    addRoomMeta,
    getDefaultRoomData,
    stateKeyFilters,
    getDefaultSyncResponse,
    handMediaContent,
    getQuery,
    getRoomMetaUpdateTs,
    judgeEventExisted,
    setRoomUnreadNotificationCount,
} from "./Helpers";
import * as olmlib from "../../crypto/olmlib";

import { Event, nip04, verifySignature } from "nostr-tools";
import { EventType, RelationType } from "../../@types/event";
import { MsgType } from "matrix-js-sdk/lib/@types/event";
import { IContent } from "matrix-js-sdk/lib/models/event";
import { MetaInfo, RoomMetaInfo, Kinds, RoomKey } from "./@types";
import { MatrixEvent } from "../../matrix";

type UserProfile = {
    picture: string;
    created_at?: number;
    name: string;
    about: string;
};
type lastFetchInfo = {
    fetchTime: number;
    updateTime: number;
};

class Events {
    bufferEvent: ISyncResponse | undefined;
    operatedEvent: Record<string, boolean> = {};

    userProfileMap: { [key: string]: UserProfile } = {};

    roomJoinMap: Record<string, Set<string>> = {};

    NprevAccountData = {};
    userMetaFetchTs: Map<string, lastFetchInfo> = new Map();
    roomMetaFetchTs: Map<string, lastFetchInfo> = new Map();
    rooms: Map<string, any> = new Map();
    allRooms: Set<string> = new Set();
    fetchedUsers: Set<string> = new Set();
    roomMemberList: Set<string> = new Set();
    initUsersAndRooms = (client: MatrixClient) => {
        const users = client.getUsers();
        users.forEach((user) => {
            const userProfile: UserProfile = {
                about: user.displayName ?? "",
                created_at: user.getLastModifiedTime(),
                name: user.displayName ?? "",
                picture: user.avatarUrl ?? "",
            };
            this.userProfileMap[user.userId] = userProfile;
        });
        const rooms = client.getRooms();
        rooms.forEach((room) => {
            const userIds = room
                .getMembers()
                .map((member) => member.userId)
                .filter(Boolean);
            this.roomJoinMap[room.roomId] = new Set(userIds);
            this.allRooms.add(room.roomId);
        });
    };

    handleDeCryptedRoomMeta(client: MatrixClient, event: MatrixEvent) {
        // 在这里创建房间

        const roomid = event.getRoomId() as string;
        const userId = client.getUserId();
        let syncResponse = this.bufferEvent;

        if (!syncResponse) {
            syncResponse = getDefaultSyncResponse();
            this.bufferEvent = syncResponse;
        }

        const created_at = event.getTs();
        const clearContent = event.getContent();
        const rowContent = event.getWireContent();

        if (event.isDecryptionFailure()) {
            return;
        }
        const content = clearContent.body;
        let roomAttrs = [
            { key: "join-rules", type: EventType.RoomJoinRules, content: { join_rule: "private" }, state_key: "" },
            {
                key: "member",
                type: EventType.RoomMember,
                state_key: userId,
                sender: userId,
                content: { displayname: userId, membership: "join" },
            },
        ];
        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        const currentTs = getRoomMetaUpdateTs(client, roomid, syncResponse);

        if (currentTs < created_at) {
            const roomStateAttrs = [
                { key: "name", type: EventType.RoomName, content: { name: content.name }, state_key: "" },
                { key: "topic", type: EventType.RoomTopic, content: { topic: content.about }, state_key: "" },
                { key: "avatar", type: EventType.RoomAvatar, content: { url: content.picture }, state_key: "" },
            ];
            roomAttrs = roomAttrs.concat(roomStateAttrs);
        }
        for (const roomAttr of roomAttrs) {
            if (roomAttr.key === "member") {
                const isLeave = client.nostrClient.hasLeaveRoom(roomid) && Key.getPubKey() === userId;
                roomAttr.content.membership = isLeave ? "leave" : "join";
            }

            syncResponse.rooms.join[roomid].state.events.push({
                content: roomAttr.content as unknown as IStateEvent,
                origin_server_ts: created_at,
                sender: roomAttr.sender || (event.sender?.userId as string),
                state_key: roomAttr.state_key as string,
                type: roomAttr.type,
                unsigned: {
                    age: Date.now() - created_at,
                },
                event_id: `${roomAttr.key}-${event.getId()}-${Math.random().toString(16).slice(2, 8)}`,
            });
        }
    }

    handSetRoomUnReadCount(_: MatrixClient, roomid: string, count: number) {
        let syncResponse = this.bufferEvent;

        if (!syncResponse) {
            syncResponse = getDefaultSyncResponse();
            this.bufferEvent = syncResponse;
        }
        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        syncResponse.rooms.join[roomid].unread_notifications.notification_count = count;
    }
    handJoinRoom = (client: MatrixClient, roomid: string) => {
        let syncResponse = this.bufferEvent;

        if (!syncResponse) {
            syncResponse = getDefaultSyncResponse();
            this.bufferEvent = syncResponse;
        }
        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        let created_at = 1;
        const userId = client.getUserId();
        // const roomAttr =
        const roomAttrs = [
            {
                key: "member",
                type: EventType.RoomMember,
                state_key: userId,
                sender: userId,
                content: { displayname: userId, membership: "join" },
            },
        ];
        const publicRoom = this.getRoom(roomid);
        if (publicRoom) {
            created_at = publicRoom?.create_at ?? created_at;
            roomAttrs.push(
                ...[
                    { key: "name", type: EventType.RoomName, content: { name: publicRoom.name ?? "" } },
                    { key: "topic", type: EventType.RoomTopic, content: { topic: publicRoom.about ?? "" } },
                    { key: "avatar", type: EventType.RoomAvatar, content: { url: publicRoom.picture ?? "" } },
                ],
            );
        }
        for (const roomAttr of roomAttrs) {
            syncResponse.rooms.join[roomid].state.events.push({
                content: roomAttr.content as unknown as IStateEvent,
                origin_server_ts: created_at,
                sender: userId as string,
                state_key: roomAttr.state_key as string,
                type: roomAttr.type,
                unsigned: {
                    age: Date.now() - created_at,
                },
                event_id: `${roomAttr.key}-${Math.random().toString(16).slice(2, 8)}`,
            });
        }
    };
    handleLeaveRoom(client: MatrixClient, event: Event) {
        if (![40, 41, 42, 4].includes(event?.kind)) return false;
        if (!Array.isArray(event?.tags)) return false;

        let roomId: string | undefined;
        if (event.kind === 40) {
            roomId = event.id;
        }
        if (event.kind === 41) {
            roomId = event.tags?.find((tag) => tag[0] === "e")?.[1];
        }
        if (event.kind === 42) {
            roomId = event.tags?.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1];
        }
        if (event.kind === 4) {
            roomId = event.tags?.find((tag) => tag[0] === "p")?.[1];
        }

        return client.nostrClient.getLeaveRooms().has(roomId as string);
    }

    handle(client: MatrixClient, event: Event) {
        // 处理一些特殊事件是否入库
        if (!event) return;
        // return;
        if (this.operatedEvent[event.id]) {
            if (client.nostrClient.readySubscribeRooms) {
                if (!this.handleLeaveRoom(client, event)) {
                    return;
                }
            } else {
                return;
            }
        }

        this.operatedEvent[event.id] = true;
        // 暂时不处理未来事件
        if (event.created_at > Date.now() / 1000) {
            return;
        }

        // 确认签名, 消息无篡改
        if (!verifySignature(event)) {
            return;
        }

        try {
            this.bufferEvent = this.convertEventToSyncResponse(client, event, this.bufferEvent);
        } catch (e) {
            console.info(e, "get buffer error");
        }
    }

    getBufferEvent() {
        const data = this.bufferEvent;
        this.bufferEvent = undefined;
        return data;
    }

    getEventRoot(event: Event) {
        return event.tags.find((t) => t[0] === "e" && t[3] === "root")?.[1];
    }

    getRooms() {
        return this.rooms;
    }

    getRoom(roomId: string) {
        return this.rooms.get(roomId);
    }
    addRoom(roomId: string, content: any) {
        const rooms = this.getRooms();
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            if (room?.created_at && room?.created_at > content?.created_at) {
                return;
            }
            this.rooms.set(roomId, { roomId, ...room, ...content });
        } else {
            this.rooms.set(roomId, { roomId, ...content });
        }
    }

    handleCreateRoomEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        const roomid = event.id;
        const created_at = event.created_at * 1000;
        const content = JSON.parse(event.content);
        let roomAttrs = [
            { key: "create", type: EventType.RoomCreate, content: { creator: event.pubkey } },
            { key: "join-rules", type: EventType.RoomJoinRules, content: { join_rule: "public" } },
            {
                key: "member",
                type: EventType.RoomMember,
                content: { displayname: event.pubkey, membership: "join" },
            },
        ];

        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        const currentTs = getRoomMetaUpdateTs(client, roomid, syncResponse);

        if (currentTs < created_at) {
            const roomStateAttrs = [
                { key: "name", type: EventType.RoomName, content: { name: content.name } },
                { key: "topic", type: EventType.RoomTopic, content: { topic: content.about } },
                { key: "avatar", type: EventType.RoomAvatar, content: { url: content.picture } },
            ];
            roomAttrs = roomAttrs.concat(roomStateAttrs);
        }
        for (const roomAttr of roomAttrs) {
            if (roomAttr.key === "member") {
                const isLeave = client.nostrClient.hasLeaveRoom(roomid) && Key.getPubKey() === event.pubkey;
                roomAttr.content.membership = isLeave ? "leave" : "join";
            }
            syncResponse.rooms.join[roomid].state.events.push({
                content: roomAttr.content,
                origin_server_ts: created_at,
                sender: event.pubkey,
                state_key: stateKeyFilters.includes(roomAttr.type) ? "" : event.pubkey,
                type: roomAttr.type,
                unsigned: {
                    age: Date.now() - created_at,
                },
                event_id: `${roomAttr.key}-${event.id}-${Math.random().toString(16).slice(2, 8)}`,
            });
        }

        // this.addRoom(roomid, { ...content, pubkey: event.pubkey, created_at });
    };
    handleContactsEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        // 获取联系人列表
        const created_at = event.created_at * 1000;

        const contactEvent = client.getContactEvent(event.pubkey);
        console.info(contactEvent, "contactEvent");
        let currentTs = contactEvent?.origin_server_ts || 0;
        if (!currentTs < created_at) {
            const people = event.tags
                .filter((i) => i[0] === "p")
                .map((i) => {
                    if (!i[0] || i[1].length !== 64) return null;
                    return {
                        id: i[1] ?? "",
                        relay: i[2] ?? "",
                        petname: i[3] ?? "",
                    };
                })
                .filter(Boolean);
            syncResponse.contacts!.events.push({
                content: {
                    people,
                },
                origin_server_ts: created_at,
                sender: event.pubkey,
                type: EventType.Contact,
                unsigned: {
                    age: Date.now() - created_at,
                },
            });
        }
    };
    handleUserMetaEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        // 这个除了更新个人信息 还要更新房间的头像信息
        const created_at = event.created_at * 1000;
        const content = JSON.parse(event.content) as MetaInfo;
        const currentUser = client.getContact(event.pubkey);
        let currentTs = currentUser?.events?.presence?.getTs?.() || 0;
        if (!currentUser || currentTs < created_at) {
            const userProfile: UserProfile = {
                ...content,
                created_at,
            };
            this.userProfileMap[event.pubkey] = userProfile;
            syncResponse.presence!.events.push({
                content: {
                    avatar_url: content.picture,
                    displayname: content.name,
                },
                origin_server_ts: created_at,
                presence: true,
                user_id: event.pubkey,
                sender: event.pubkey,

                type: EventType.Presence,
                unsigned: {
                    age: Date.now() - created_at,
                },
            });
            // 要更新所有的m.direct的房间
            const accountData = client.getAccountData(EventType.Direct)?.getContent() || {};
            const hasDirect = accountData[event.pubkey];
            if (!hasDirect) {
                return;
            }
            // 直接设置房间的 name abcout, picture
            // const room = client.getRoom(event.pubkey);
            // if (!room) {
            //     return;
            // }
            for (const roomType in ROOM_META_TYPES) {
                // 直接加入
                const roomValue = ROOM_META_TYPES[roomType];
                if (content[roomType] === undefined || content[roomType] === null) {
                    continue;
                }
                const metadata: RoomMetaInfo = {
                    roomId: event.pubkey,
                    sender: event.pubkey,
                    eventId: event.id,
                    createdAt: created_at,
                    content: { [roomValue.field]: content[roomType] },
                    type: roomValue.type,
                };
                addRoomMeta(syncResponse, metadata);
            }
        }
    };

    handleReactionMessageEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        let content = {
            msgtype: MsgType.Text,
            body: event.content,
        } as IContent;
        const userId = client.getUserId();

        let roomid = null;
        const rootRoomid = event.tags.find((tags) => tags[0] === "e" && tags[3] === "root")?.[1] as string;
        if (rootRoomid) {
            roomid = rootRoomid;
        } else {
            if (event.pubkey === userId) {
                roomid = event.tags.find((tags) => tags[0] === "p" && tags[1] !== userId)?.[1] as string;
            } else {
                roomid = event.pubkey;
            }
        }
        if (!roomid) {
            return;
        }
        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }

        const created_at = event.created_at * 1000;
        const replyEventId = event.tags.find((tags) => tags[0] === "e" && tags[3] === "reply")?.[1] as string;
        if (replyEventId) {
            content["m.relates_to"] = {
                "m.in_reply_to": {
                    event_id: replyEventId,
                },
            };
        }
        let eventType = EventType.Reaction;
        content = {
            "m.relates_to": {
                event_id: replyEventId,
                key: event.content,
                rel_type: RelationType.Annotation,
            },
        };
        syncResponse.rooms.join[roomid].timeline.events.push({
            content,
            origin_server_ts: created_at,
            sender: event.pubkey,
            type: eventType,
            unsigned: {
                age: Date.now() - created_at,
            },
            event_id: event.id,
        });
    };

    handleDeleteMessageEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        // 这里是删除的事件, 需要反向推出是哪个房间的event
        // 获取全部房间, 找到后直接拼接对房间的某个事件的删除
        if (!event?.tags?.length) {
            return;
        }
        let eventId = event.tags.find((tags) => tags[0] === "e")?.[1] as string;
        if (!eventId) {
            return;
        }
        const rooms = client.getRooms();
        for (const room of rooms) {
            const matrixEvent = room.findEventById(eventId);

            if (matrixEvent) {
                const roomid = room.roomId;
                const created_at = event.created_at * 1000;

                if (!syncResponse.rooms.join?.[roomid]) {
                    syncResponse.rooms.join[roomid] = getDefaultRoomData();
                }
                syncResponse.rooms.join[roomid].timeline.events.push({
                    content: {},
                    origin_server_ts: created_at,
                    sender: event.pubkey,
                    redacts: eventId,
                    type: EventType.RoomRedaction,
                    unsigned: {
                        age: Date.now() - created_at,
                    },
                    event_id: event.id,
                });
                return;
            }
        }
    };

    handleRoomMetaDataEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        /*  在这里处理房间的metadata
      需要注意有房间没有meta信息的情况
    */
        const roomid = event.tags.find((tags) => tags[0] === "e")?.[1] as string;
        const created_at = event.created_at * 1000;
        const content = JSON.parse(event.content);
        if (!("name" in content) || !("about" in content)) {
            return;
        }

        const room = client.getRoom(roomid);

        const roomAttrs = [];
        for (const key of Object.keys(content)) {
            if (room) {
                const stateEvents = room.currentState.getStateEvents(ROOM_META_TYPES[key].type);
                if (
                    stateEvents &&
                    stateEvents.some((i) => {
                        return i.getTs() > created_at;
                    })
                ) {
                    continue;
                }
            }

            roomAttrs.push({
                key,
                type: ROOM_META_TYPES[key].type,
                content: { [ROOM_META_TYPES[key].field]: content[key] },
            });
        }

        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        for (const roomAttr of roomAttrs) {
            syncResponse.rooms.join[roomid].state.events.push({
                content: roomAttr.content,
                origin_server_ts: created_at,
                sender: event.pubkey,
                state_key: "",
                type: roomAttr.type,
                unsigned: {
                    age: Date.now() - created_at,
                },
                event_id: `${roomAttr.key}-${event.id}-${Math.random().toString(16).slice(2, 8)}`,
            });
        }

        // this.addRoom(roomid, { ...content, pubkey: event.pubkey, created_at });
    };

    handlePrivateEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        const tag = "p";
        let content = {
            algorithm: "m.secp256k1-ecdh",
            ciphertext: event.content,
        } as IContent;
        let roomid = event.tags.find((tags) => tags[0] === tag)?.[1] as string;
        if (!roomid) {
            return;
        }
        const userId = client.getUserId();
        if (event.pubkey === userId) {
            roomid = roomid;
        } else {
            roomid = event.pubkey;
        }
        const created_at = event.created_at * 1000;
        const prevAccountData = client.getAccountData(EventType.Direct)?.getContent();
        const newAccountData = {
            ...prevAccountData,
            [roomid]: [roomid, userId],
        };
        this.NprevAccountData = {
            ...this.NprevAccountData,
            ...newAccountData,
        };
        syncResponse.account_data.events.push({
            content: this.NprevAccountData,
            type: EventType.Direct,
        });
        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }

        if (event.content !== "nostr-create-room") {
            const replyEventId = event.tags.find((tags) => tags[0] === "e" && tags[3] === "reply")?.[1] as string;
            if (replyEventId) {
                content["m.relates_to"] = {
                    "m.in_reply_to": {
                        event_id: replyEventId,
                    },
                };
            }
            let eventType = EventType.RoomMessageEncrypted;
            const existed = judgeEventExisted(client, roomid, event.id, syncResponse);
            if (!existed) {
                if (event.pubkey !== client.getUserId()) {
                    if (Date.now() - created_at < 7 * 1000) {
                        setRoomUnreadNotificationCount(client, roomid, syncResponse, 1);
                    }
                } else {
                    this.handSetRoomUnReadCount(client, roomid, 0);
                }
                syncResponse.rooms.join[roomid].timeline.events.push({
                    content,
                    origin_server_ts: created_at,
                    sender: event.pubkey,
                    type: eventType,
                    unsigned: {
                        age: Date.now() - created_at,
                    },
                    event_id: event.id,
                });
            }
        }
        let roomStates = [];

        // 这里构造房间的一些用户信息
        if (!this.roomJoinMap[roomid]) {
            this.roomJoinMap[roomid] = new Set();
            const room = client.getRoom(roomid);
            if (!room) {
                roomStates = [
                    {
                        content: {
                            algorithm: "m.secp256k1-ecdh",
                        },
                        type: EventType.RoomEncryption,
                        sender: null,
                    },
                    {
                        content: {
                            url: this.userProfileMap?.[roomid]?.picture ?? "",
                        },
                        type: EventType.RoomAvatar,
                        sender: null,
                        created_at: 1,
                    },
                    {
                        content: {
                            topic: this.userProfileMap?.[roomid]?.about ?? roomid,
                        },
                        type: EventType.RoomTopic,
                        sender: null,
                        created_at: 1,
                    },
                    {
                        content: {
                            name: this.userProfileMap?.[roomid]?.name ?? roomid,
                        },
                        type: EventType.RoomName,
                        sender: null,
                        created_at: 1,
                    },
                ];
            }
        }
        const memberStates = [
            {
                content: {
                    avatar_url: "",
                    displayname: userId,
                    membership: "join",
                },
                type: EventType.RoomMember,
                sender: userId,
                state_key: userId,
            },
            {
                content: {
                    avatar_url: "",
                    displayname: roomid,
                    membership: "join",
                },
                type: EventType.RoomMember,
                sender: roomid,
                state_key: roomid,
            },
        ].filter((memberState) => {
            return !this.roomJoinMap[roomid].has(memberState.sender);
        });
        memberStates.forEach((memberState) => {
            this.roomJoinMap[roomid].add(memberState.sender);
        });
        roomStates = roomStates.concat(memberStates);
        roomStates.forEach((roomState) => {
            const metadata: RoomMetaInfo = {
                roomId: roomid,
                sender: roomState.sender ?? event.pubkey,
                eventId: `private-${roomState.type}-${event.id}`,
                createdAt: roomState?.created_at || created_at,
                content: roomState.content,
                type: roomState.type,
                state_key: roomState.state_key ?? "",
            };
            addRoomMeta(syncResponse, metadata);
        });
    };

    handleChannleMessage = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        let tag = "e";
        let content = {
            msgtype: MsgType.Text,
            body: event.content,
        } as IContent;
        let roomid = event.tags.find((tags) => tags[0] === tag && tags[3] === "root")?.[1] as string;
        if (!roomid) {
            return;
        }
        content = handMediaContent(content);
        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        const created_at = event.created_at * 1000;
        const replyEventId = event.tags.find((tags) => tags[0] === "e" && tags[3] === "reply")?.[1] as string;
        if (replyEventId) {
            content["m.relates_to"] = {
                "m.in_reply_to": {
                    event_id: replyEventId,
                },
            };
        }
        const eventType = EventType.RoomMessage;
        const existed = judgeEventExisted(client, roomid, event.id, syncResponse);
        if (!existed) {
            if (event.pubkey !== client.getUserId()) {
                if (Date.now() - created_at < 7 * 1000) {
                    setRoomUnreadNotificationCount(client, roomid, syncResponse, 1);
                }
            } else {
                this.handSetRoomUnReadCount(client, roomid, 0);
            }
            syncResponse.rooms.join[roomid].timeline.events.push({
                content,
                origin_server_ts: created_at,
                sender: event.pubkey,
                type: eventType,
                unsigned: {
                    age: Date.now() - created_at,
                },
                event_id: event.id,
            });
        }

        let roomStates = [];

        // 这里构造房间的一些用户信息
        if (!this.roomJoinMap[roomid]) {
            this.roomJoinMap[roomid] = new Set();
        }
        const currentTs = getRoomMetaUpdateTs(client, roomid, syncResponse);

        if (!currentTs) {
            roomStates = [
                { key: "name", type: EventType.RoomName, content: { name: roomid }, state_key: "", created_at: 1 },
                { key: "topic", type: EventType.RoomTopic, content: { topic: roomid }, state_key: "", created_at: 1 },
            ];
        }
        const memberStates = [
            {
                content: {
                    avatar_url: "",
                    displayname: event.pubkey,
                    membership: "join",
                },
                type: EventType.RoomMember,
                sender: event.pubkey,
                state_key: event.pubkey,
            },
        ].filter((memberState) => {
            return !this.roomJoinMap[roomid].has(memberState.sender);
        });
        memberStates.forEach((memberState) => {
            this.roomJoinMap[roomid].add(memberState.sender);
        });
        roomStates = roomStates.concat(memberStates);

        roomStates.forEach((roomState) => {
            const metadata: RoomMetaInfo = {
                roomId: roomid,
                sender: roomState.sender ?? event.pubkey,
                eventId: `${roomState.type}-${event.id}`,
                createdAt: roomState?.created_at || created_at,
                content: roomState.content,
                type: roomState.type,
                state_key: roomState.state_key ?? "",
            };
            addRoomMeta(syncResponse, metadata);
        });
    };

    handlePrivateGroupRoomKeyEvent = async (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        // 只监听了发给自己的104消息不会有其他人的

        const _decryptoMessage = async () => {
            try {
                const ciphertext = event.content;
                const priKey = Key.getPrivKey();
                const decryptoContent = JSON.parse(
                    await nip04.decrypt(priKey, event.pubkey, ciphertext),
                ) as unknown as RoomKey;
                return decryptoContent;
            } catch (e) {
                console.info(e, "decrypt error");
            }
        };

        const _createRoom = (roomid: string) => {
            if (!roomid) {
                return;
            }
            // 这里仅仅只是加入了房间的加密信息, 并没有放入房间的creation信息
            const roomState = {
                content: {
                    algorithm: olmlib.MEGOLM_ALGORITHM,
                },
                type: EventType.RoomEncryption,
                sender: event.pubkey,
                state_key: "",
            };
            const metadata: RoomMetaInfo = {
                roomId: roomid,
                sender: roomState.sender ?? event.pubkey,
                eventId: `${roomState.type}-${event.id}`,
                createdAt: 1,
                content: roomState.content,
                type: roomState.type,
                state_key: roomState.state_key ?? "",
            };

            addRoomMeta(syncResponse, metadata);
        };
        const _addTodevice = (decryptoContent: RoomKey) => {
            // 添加到to_device的数据里去解析数据
            syncResponse.to_device!.events.push({
                content: {
                    algorithm: olmlib.MEGOLM_ALGORITHM,
                    sender_key: event.pubkey,
                    session_id: decryptoContent.session_id,
                    session_key: decryptoContent.session_key,
                    room_id: decryptoContent.room_id,
                },
                sender: event.pubkey,
                type: EventType.RoomKey,
            });
        };
        let decryptoContent = await _decryptoMessage();
        if (!decryptoContent?.room_id || !decryptoContent?.session_key || !decryptoContent?.session_id) {
            return;
        }
        syncResponse = this.bufferEvent;

        if (!syncResponse) {
            syncResponse = getDefaultSyncResponse();
            this.bufferEvent = syncResponse;
        }
        _createRoom(decryptoContent?.room_id);
        _addTodevice(decryptoContent);
    };

    handlePrivateGroupRoomMetaEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        // 房间的140 和141非常相近 只是roomid的获取不同
        // 房间的140 事件目前只有创建人可以收到
        // 但是141还必须验证 event.pubkey 必须等于房间里面的加密算法加入人的信息
        const userId = client.getUserId() as string;
        let roomid = event.id;
        const created_at = event.created_at * 1000;
        const kind = event.kind as Kinds;
        if (kind === 141) {
            roomid = event.tags.find((tags) => tags[0] === "e")?.[1] as string;
        }
        if (!roomid) {
            return;
        }
        const currentTs = getRoomMetaUpdateTs(client, roomid, syncResponse, EventType.RoomCreate);

        if (currentTs >= created_at) {
            return;
        }
        const room = client.getRoom(roomid);

        if (kind === 141) {
            // 判断自己是否在房间, 不在房间则立即标记自己退出了
            const mySelf = event.tags.find((tags) => tags[0] === "p" && tags[1] === userId)?.[1] as string;
            if (!mySelf) {
                if (!syncResponse.rooms.join?.[roomid]) {
                    syncResponse.rooms.join[roomid] = getDefaultRoomData();
                }
                if (room) {
                    const joinRule = room.currentState.getStateEvents(EventType.RoomJoinRules, "");
                    if (joinRule) {
                        const content = joinRule.getContent();
                        if (content?.join_rule === "public") {
                            return;
                        }
                    }
                }
                syncResponse.rooms.join[roomid].state.events.push({
                    content: {
                        avatar_url: "",
                        displayname: userId,
                        membership: "leave",
                    },
                    origin_server_ts: created_at,
                    sender: userId,
                    state_key: userId,
                    type: EventType.RoomMember,
                    unsigned: {
                        age: Date.now() - created_at,
                    },
                    event_id: `${EventType.RoomMember}-${event.id}`,
                });
                return;
            }
        }
        let sendKey;

        if (room) {
            const cryptoStateEvent = room.currentState.getStateEvents(EventType.RoomEncryption, "");
            sendKey = cryptoStateEvent?.sender?.userId;
        }
        if (!sendKey) {
            const room = this.getRoom(roomid);
            sendKey = room?.pubkey;
        }
        // 在此之前肯定已经有房间了

        // if (sendKey !== event.pubkey && kind === 141) {
        //     // 虚假消息
        //     return;
        // }

        const eventContent = event.content;
        const ciphertext = eventContent.split("?")[0];
        const query = getQuery(eventContent);
        if (!query?.sid) {
            return;
        }
        const content = {
            algorithm: olmlib.MEGOLM_ALGORITHM,
            sender_key: event.pubkey,
            session_id: query.sid,
            room_id: roomid,
            ciphertext,
        };

        // 获取当前爱房间中的state的
        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        if (!this.roomJoinMap[roomid]) {
            this.roomJoinMap[roomid] = new Set();
        }
        const pList = event.tags.filter((tag) => tag[0] === "p").map((i) => i[1]);
        const PListMap = new Set(pList);
        const memberStates = pList.map((i) => {
            return {
                content: {
                    avatar_url: "",
                    displayname: i,
                    membership: "join",
                },
                type: EventType.RoomMember,
                sender: i,
                state_key: i,
            };
        });
        if (room && kind === 141) {
            const memberStateEvents = room.getMembers();
            let hasLeave = false;
            memberStateEvents.forEach((i) => {
                if (!PListMap.has(i.userId)) {
                    hasLeave = true;
                    memberStates.push({
                        content: {
                            avatar_url: "",
                            displayname: i.userId,
                            membership: "leave",
                        },
                        type: EventType.RoomMember,
                        sender: i.userId,
                        state_key: i.userId,
                    });
                }
                if (memberStateEvents.length !== PListMap.size || hasLeave) {
                    try {
                        client.forceDiscardSession(room.roomId);
                    } catch (e) {
                        console.info(e, "141 destroy session error");
                    }
                }
            });
        }
        // memberStates.forEach((memberState) => {
        //     this.roomJoinMap[roomid].add(memberState.sender);
        // });
        memberStates.forEach((roomState) => {
            const metadata: RoomMetaInfo = {
                roomId: roomid,
                sender: roomState.sender,
                eventId: `${roomState.type}-${roomState.sender}`,
                createdAt: created_at,
                content: roomState.content,
                type: roomState.type,
                state_key: roomState.state_key,
            };
            addRoomMeta(syncResponse, metadata);
        });
        syncResponse.rooms.join[roomid].state.events.push({
            content: { creator: event.pubkey },
            origin_server_ts: created_at,
            sender: event.pubkey,
            state_key: "",
            type: EventType.RoomCreate,
            unsigned: {
                age: Date.now() - created_at,
            },
            event_id: event.id,
        });
        syncResponse.rooms.join[roomid].state.events.push({
            content: {
                state_default: 50,
                invite: 100,
                users: {
                    [event.pubkey]: 100,
                },
            },
            origin_server_ts: created_at,
            sender: event.pubkey,
            state_key: "",
            type: EventType.RoomPowerLevels,
            unsigned: {
                age: Date.now() - created_at,
            },
            event_id: event.id,
        });
        syncResponse.rooms.join[roomid].state.events.push({
            content: content,
            origin_server_ts: created_at,
            sender: event.pubkey,
            state_key: "",
            type: EventType.RoomMetaEncrypted,
            unsigned: {
                age: Date.now() - created_at,
            },
            event_id: event.id,
        });
    };
    handlePrivateGroupRoomMessageEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        const eventContent = event.content;
        const ciphertext = eventContent.split("?")[0];
        const query = getQuery(eventContent);

        if (!query?.sid) {
            return;
        }
        let roomid = event.tags.find((tags) => tags[0] === "e" && tags[3] === "root")?.[1] as string;
        if (!roomid) {
            return;
        }
        let content = {
            algorithm: olmlib.MEGOLM_ALGORITHM,
            sender_key: event.pubkey,
            session_id: query.sid,
            ciphertext,
            version: query.v,
        } as IContent;

        if (!syncResponse.rooms.join?.[roomid]) {
            syncResponse.rooms.join[roomid] = getDefaultRoomData();
        }
        const created_at = event.created_at * 1000;
        const replyEventId = event.tags.find((tags) => tags[0] === "e" && tags[3] === "reply")?.[1] as string;
        if (replyEventId) {
            content["m.relates_to"] = {
                "m.in_reply_to": {
                    event_id: replyEventId,
                },
            };
        }
        const existed = judgeEventExisted(client, roomid, event.id, syncResponse);
        if (!existed) {
            if (event.pubkey !== client.getUserId()) {
                if (Date.now() - created_at < 7 * 1000) {
                    setRoomUnreadNotificationCount(client, roomid, syncResponse, 1);
                }
            } else {
                this.handSetRoomUnReadCount(client, roomid, 0);
            }
            syncResponse.rooms.join[roomid].timeline.events.push({
                content,
                origin_server_ts: created_at,
                sender: event.pubkey,
                type: EventType.RoomMessageEncrypted,
                unsigned: {
                    age: Date.now() - created_at,
                },
                event_id: event.id,
            });
        }
    };
    convertEventToSyncResponse(client: MatrixClient, event: Event, syncResponse?: ISyncResponse): ISyncResponse {
        /*
      处理 不同消息放入不同的数据结构
      kind 20000-29999 短暂信息 例子(typing,recipet) 放入 join 的ephemeral
      kind 42 群聊的消息 直接放入房间的里面的
      kind 4 单聊的消息
    */
        if (!syncResponse) {
            syncResponse = getDefaultSyncResponse();
        }
        switch (event.kind as Kinds) {
            case 0:
                this.handleUserMetaEvent(client, event, syncResponse);
                break;
            case 3:
                this.handleContactsEvent(client, event, syncResponse);
                break;
            case 4:
                this.handlePrivateEvent(client, event, syncResponse);
                break;
            case 5:
                this.handleDeleteMessageEvent(client, event, syncResponse);
                break;
            case 7:
                this.handleReactionMessageEvent(client, event, syncResponse);
                break;
            case 40:
                this.handleCreateRoomEvent(client, event, syncResponse);
                break;
            case 41:
                this.handleRoomMetaDataEvent(client, event, syncResponse);
                break;
            case 42:
                this.handleChannleMessage(client, event, syncResponse);
                break;
            case 104:
                this.handlePrivateGroupRoomKeyEvent(client, event, syncResponse);
                break;
            case 140:
                this.handlePrivateGroupRoomMetaEvent(client, event, syncResponse);
                break;
            case 141:
                this.handlePrivateGroupRoomMetaEvent(client, event, syncResponse);
                break;
            case 142:
                this.handlePrivateGroupRoomMessageEvent(client, event, syncResponse);
                break;
        }
        return syncResponse;
    }
}

export default new Events();
