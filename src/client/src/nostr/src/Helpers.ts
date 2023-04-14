import { getEventHash, Event } from "nostr-tools";
import { MsgType } from "matrix-js-sdk/lib/@types/event";
import { IContent } from "matrix-js-sdk/lib/models/event";

import { IJoinedRoom, ISyncResponse } from "../../sync-accumulator";

import { EventType } from "../../@types/event";
import { RoomMetaInfo } from "./@types";
import { MatrixClient } from "../../matrix";
import Key from "./Key";

export const stateKeyFilters = [
    EventType.RoomName,
    EventType.RoomTopic,
    EventType.RoomAvatar,
    EventType.RoomCreate,
    EventType.RoomJoinRules,
];
export const arrayToHex = (array: Uint8Array): string => {
    return Array.from(array, (byte) => {
        return ("0" + (byte & 0xff).toString(16)).slice(-2);
    }).join("");
};

const imgRegex = /\b(https?:\/\/\S+(?:\.png|\.jpe?g|\.gif|\.webp|\.PNG|\.JPE?G|\.GIF|\.WEBP)\S*)\b/g;
const videoRegex = /\b(https?:\/\/\S+(?:\.mp4|\.mov|\.avi)\S*)\b/g;
const audioRegex = /\b(https?:\/\/\S+(?:\.mp3|\.wav|\.ogg)\S*)\b/g;
// const Regex = /\b(https?:\/\/\S+(?:\.mp3|\.wav|\.ogg)\S*)\b/g;
const mediaList = [
    { reg: imgRegex, key: "image", msgtype: MsgType.Image },
    { reg: videoRegex, key: "video", msgtype: MsgType.Video },
    { reg: audioRegex, key: "audio", msgtype: MsgType.Audio },
];
export const getDefaultRoomData = (): IJoinedRoom => {
    return {
        summary: {
            "m.heroes": [],
            "m.invited_member_count": null,
            "m.joined_member_count": null,
        },
        state: {
            events: [],
        },
        timeline: {
            events: [],
            limited: false,
            prev_batch: `${Date.now()}`,
        },
        ephemeral: {
            events: [],
        },
        account_data: {
            events: [],
        },
        unread_notifications: {
            highlight_count: 0,
            notification_count: 0,
        },
    };
};

export const getDefaultSyncResponse = (): ISyncResponse => {
    return {
        presence: {
            events: [],
        },
        to_device: {
            events: [],
        },
        next_batch: `${Math.random()}`,
        rooms: {
            join: {},
            invite: {},
            leave: {},
        },
        account_data: {
            events: [],
        },
    };
};

export const ROOM_META_TYPES = {
    name: {
        type: EventType.RoomName,
        field: "name",
    },
    about: {
        type: EventType.RoomTopic,
        field: "topic",
    },
    picture: {
        type: EventType.RoomAvatar,
        field: "url",
    },
};
export const addRoomMeta = (syncResponse, roomMetaInfo: RoomMetaInfo) => {
    if (!syncResponse.rooms.join?.[roomMetaInfo.roomId]) {
        syncResponse.rooms.join[roomMetaInfo.roomId] = getDefaultRoomData();
    }
    syncResponse.rooms.join[roomMetaInfo.roomId].state.events.push({
        content: roomMetaInfo.content,
        origin_server_ts: roomMetaInfo.createdAt,
        sender: roomMetaInfo.sender,
        state_key: roomMetaInfo.state_key ?? "",
        type: roomMetaInfo.type,
        unsigned: {
            age: Date.now() - roomMetaInfo.createdAt,
        },
        event_id: roomMetaInfo.eventId,
    });
};
export const handMediaContent = (content: IContent): IContent => {
    for (const mediaType of mediaList) {
        if (content?.body?.match?.(mediaType.reg)) {
            const splitList = content.body.split(".");
            const ext = splitList[splitList.length - 1];
            const newContent = {
                body: `${splitList[splitList.length - 2]}.${ext}`,
                info: {
                    mimetype: `${mediaType.key}/${ext}`,
                },
                msgtype: mediaType.msgtype,
                url: content.body,
            };
            return newContent;
        }
    }
    return content;
};

export const getQuery = (content: string): Record<string, string> => {
    // str为？之后的参数部分字符串
    if (!content) {
        return {};
    }
    const str = content.substr(content.indexOf("?") + 1);
    // arr每个元素都是完整的参数键值
    const arr = str.split("&");
    // result为存储参数键值的集合
    const result: Record<string, string> = {};
    for (let i = 0; i < arr.length; i++) {
        // item的两个元素分别为参数名和参数值
        const item = arr[i].split("=");
        result[item[0]] = item[1];
    }
    return result;
};

export async function handlePublishEvent(event: Event) {
    if (!event.sig) {
        if (!event.tags) {
            event.tags = [];
        }
        event.content = event.content || "";
        event.created_at = event.created_at || Math.floor(Date.now() / 1000);
        event.pubkey = Key.getPubKey();
        event.id = event.id || getEventHash(event);
        event.sig = await Key.sign(event);
    }

    if (!(event.id && event.sig)) {
        throw new Error("Invalid event");
    }
}

export async function createKind140Event(
    client: MatrixClient,
    payload: string,
    session: { sessionId: string; sessionKey: string },
) {
    const olmDevice = client.crypto.olmDevice!;
    const event: Event = {
        kind: 140,
        tags: [["p", Key.getPubKey()]],
    };
    const ciphertext = olmDevice.encryptGroupMessage(session.sessionId, payload);
    event.content = `${ciphertext}?sid=${session.sessionId}`;
    await handlePublishEvent(event);
    await client.nostrClient.relay.publishAsPromise(event);
    return event;
}
export const createEncryptedChannelEvent = createKind140Event;

export async function createKind104Event(
    client: MatrixClient,
    roomId: string,
    pubkey: string,
    session: { sessionId: string; sessionKey: string },
) {
    try {
        const event: Event = {
            kind: 104,
            content: JSON.stringify({
                session_id: session.sessionId,
                session_key: session.sessionKey,
                room_id: roomId,
            }),
            tags: [["p", pubkey]],
        };
        event.content = await Key.encrypt(event.content, pubkey);
        await handlePublishEvent(event);
        await client.nostrClient.relay.publishAsPromise(event);
        return event;
    } catch (e) {
        console.info(e, "发送104错误");
    }
}
export const communicateMegolmSessionEvent = createKind104Event;

export async function createKind141Event(
    client: MatrixClient,
    room: { id: string; relayUrl?: string },
    payload: string,
    toPubkeys: string[],
    sessionId: string,
) {
    const olmDevice = client.crypto.olmDevice!;
    if (toPubkeys.length === 0) {
        toPubkeys.push(Key.getPubKey());
    }

    const relatedEvent = ["e", room.id];
    if (room.relayUrl) {
        relatedEvent.push(room.relayUrl);
    }
    const event: Event = {
        kind: 141,
        tags: [relatedEvent, ...[...new Set(toPubkeys)].map((pubkey) => ["p", pubkey])],
    };
    const ciphertext = olmDevice.encryptGroupMessage(sessionId, payload);
    event.content = `${ciphertext}?sid=${sessionId}`;
    await handlePublishEvent(event);
    await client.nostrClient.relay.publishAsPromise(event);
    return event;
}
export const updateEncryptedChannelMetadataEvent = createKind141Event;
