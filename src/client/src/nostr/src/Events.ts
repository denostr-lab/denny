import { debounce } from "lodash-es";
import { ISyncResponse } from "../../sync-accumulator";
import { MatrixClient } from "../../client";

// import IndexedDB from './IndexedDB';
import Key from "./Key";
import Relays from "./Relays";
import {
    ROOM_META_TYPES,
    addRoomMeta,
    getDefaultRoomData,
    stateKeyFilters,
    getDefaultSyncResponse,
    handMediaContent,
} from "./Helpers";

import {
    CachedReceiptStructure,
    MAIN_ROOM_TIMELINE,
    Receipt,
    ReceiptContent,
    ReceiptType,
} from "../../@types/read_receipts";
import { Event, Kind } from "nostr-tools";
import { EventType, RelationType } from "../../@types/event";
import { MsgType } from "matrix-js-sdk/lib/@types/event";
import { IContent } from "matrix-js-sdk/lib/models/event";
import { MetaInfo, RoomMetaInfo, Kinds } from "./@types";

type UserProfile = {
    picture: string;
    created_at?: number;
    name: string;
    about: string;
};

class Events {
    bufferEvent: ISyncResponse | null;
    operatedEvent: Record<string, boolean> = {};
    userProfileMap: { [key: string]: UserProfile } = {};
    roomJoinMap: Record<string, Set<string>> = {};
    NprevAccountData = {};
    rooms: Map<string, any> = new Map();

    initUsersAndRooms = (client: MatrixClient) => {
        const users = client.getUsers();
        users.forEach((user) => {
            const userProfile: UserProfile = {
                about: user.displayName,
                created_at: user.getLastModifiedTime(),
                name: user.displayName,
                picture: user.avatarUrl,
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
        });
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

        return client.nostrClient.getLeaveRooms().has(roomId);
    }

    handle(client: MatrixClient, event: Event) {
        // 处理一些特殊事件是否入库
        if (!event) return;

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
        try {
            this.bufferEvent = this.convertEventToSyncResponse(client, event, this.bufferEvent);
        } catch (e) {
            console.info(e, "有错误了吗");
        }
    }

    getBufferEvent() {
        const data = this.bufferEvent;
        this.bufferEvent = null;
        return data;
    }

    getEventRoot(event: Event) {
        return event?.tags.find((t) => t[0] === "e" && t[3] === "root")?.[1];
    }

    getRooms() {
        return this.rooms;
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
            // case 20001:
            //   this.handleEphemeralEvent(event, syncResponse);
            //   break;
            // case 20002:
            //   this.handleEphemeralEvent(event, syncResponse);
            //   break;
        }
        return syncResponse;
    }

    handleCreateRoomEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        const roomid = event.id;
        // if (client.getRoom(roomid)) {
        //   return syncResponse;
        // }

        const created_at = event.created_at * 1000;
        const content = JSON.parse(event.content);
        const roomAttrs = [
            { key: "create", type: EventType.RoomCreate, content: { creator: event.pubkey } },
            { key: "name", type: EventType.RoomName, content: { name: content.name } },
            { key: "topic", type: EventType.RoomTopic, content: { topic: content.about } },
            { key: "avatar", type: EventType.RoomAvatar, content: { url: content.picture } },
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
            // console.info(
            //   syncResponse.rooms.join[roomid].state.events,
            //   'syncResponse.rooms.join[roomid].state.events',
            //   event,
            //   'as水电费是的'
            // );
        }

        this.addRoom(roomid, { ...content, pubkey: event.pubkey, created_at });
    };

    handleUserMetaEvent = (client: MatrixClient, event: Event, syncResponse: ISyncResponse) => {
        // 这个除了更新个人信息 还要更新房间的头像信息
        const created_at = event.created_at * 1000;
        const content = JSON.parse(event.content) as MetaInfo;
        const currentUser = client.getUser(event.pubkey);
        let currentTs = currentUser?.events?.presence?.getTs?.() || 0;
        if (!currentUser || currentTs < created_at) {
            const userProfile: UserProfile = {
                ...content,
                created_at,
            };
            this.userProfileMap[event.pubkey] = userProfile;
            syncResponse.presence.events.push({
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
            const room = client.getRoom(event.pubkey);
            if (!room) {
                return;
            }
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

        this.addRoom(roomid, { ...content, pubkey: event.pubkey, created_at });
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
                eventId: `${roomState.type}-${event.id}`,
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
        let eventType = EventType.RoomMessage;
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

        let roomStates = [];

        // 这里构造房间的一些用户信息
        if (!this.roomJoinMap[roomid]) {
            this.roomJoinMap[roomid] = new Set();
            const room = client.getRoom(roomid);
            if (!room) {
                roomStates = [
                    {
                        content: {
                            topic: roomid,
                        },
                        type: EventType.RoomTopic,
                        sender: null,
                        created_at: 1,
                    },
                    {
                        content: {
                            name: roomid,
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
}

export default new Events();
