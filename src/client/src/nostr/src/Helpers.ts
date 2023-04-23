import { getEventHash, Event } from "nostr-tools";
import { MsgType } from "matrix-js-sdk/lib/@types/event";
import { IContent } from "matrix-js-sdk/lib/models/event";

import { IJoinedRoom, ISyncResponse } from "../../sync-accumulator";

import { EventType } from "../../@types/event";
import { RoomMetaInfo, RoomKeySession, LocalTask } from "./@types";
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
export const getRoomMetaUpdateTs = (client: MatrixClient, roomid: string, syncResponse: ISyncResponse) => {
    const events = syncResponse?.rooms?.join?.[roomid]?.state?.events || [];
    const event = events.find((i) => i.type === EventType.RoomName);
    let eventTs = 0;
    let roomStateTs = 0;
    if (event) {
        eventTs = event.origin_server_ts;
    }

    const room = client.getRoom(roomid);
    if (room?.currentState) {
        const event = room.currentState.getStateEvents(EventType.RoomName, "");
        if (event) {
            roomStateTs = event.getTs();
        }
    }
    return Math.max(roomStateTs, eventTs);
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
        console.info(e, "send kin 104 error");
    }
    return null;
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

export function splitRequest(tasks: string[], defaultMaxPerRequest = 20) {
    const maxPerRequestWithFormat = Number(defaultMaxPerRequest);
    const maxPerRequest = Number.isNaN(maxPerRequestWithFormat) ? 20 : maxPerRequestWithFormat;

    let currentSlice: string[] = [];
    const mapSlices = [currentSlice];

    // eslint-disable-next-line no-restricted-syntax
    for (const task of tasks) {
        currentSlice.push(task);

        if (currentSlice.length >= maxPerRequest) {
            currentSlice = [];
            mapSlices.push(currentSlice);
        }
    }

    if (currentSlice.length === 0) {
        mapSlices.pop();
    }

    return mapSlices;
}

export async function batchRequest(
    roomId: string,
    session: {
        sessionId: string;
        sessionKey: string;
    },
    users: string[],
    failedUsers: string[],
    callback: any,
) {
    await Promise.all(
        users.map((userId) => {
            try {
                return callback(roomId, userId, session);
            } catch (err) {
                failedUsers.push(userId);
            }
            return null;
        }),
    );
}

export async function attemptShareRoomKey(client: MatrixClient, task: LocalTask, callback: any) {
    const failedUserIds: string[] = [];
    const userIds = [...task.userIds];
    const megolmSessionSharers = splitRequest(userIds);

    for (let i = 0; i < megolmSessionSharers.length; i++) {
        const taskFailedUserIds: string[] = [];
        const taskDetail = `(retry) megolm keys for ${task.session.sessionId} (slice ${i + 1}/${
            megolmSessionSharers.length
        })`;
        console.debug(
            `(retry) Sharing ${taskDetail}`,
            megolmSessionSharers[i].map((userId) => `${userId}/${task.session.sessionId}`),
        );
        await batchRequest(task.roomId, task.session, megolmSessionSharers[i], taskFailedUserIds, callback);
        console.debug(
            `(retry) Shared ${taskDetail} (sent ${megolmSessionSharers[i].length - taskFailedUserIds.length}/${
                megolmSessionSharers[i].length
            })`,
        );
        failedUserIds.push(...taskFailedUserIds);
    }

    if (failedUserIds.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
        await attemptShareRoomKey(
            client,
            {
                ...task,
                userIds: [...failedUserIds],
            },
            callback,
        );
    }
}

export function initRoomKeyTask(roomId: string, session: RoomKeySession, userIds: string[]): LocalTask {
    const key = `nostr.task.${session.sessionId}`;
    const currentTask = localStorage.getItem(key);
    if (!currentTask) {
        localStorage.setItem(
            key,
            JSON.stringify({
                roomId,
                session,
                userIds,
                created: Date.now(),
            }),
        );
    }

    return JSON.parse(currentTask as string);
}

export function replaceLocalTask(sessionId: string, add: string[], remove?: string[]) {
    const key = `nostr.task.${sessionId}`;
    const localVal = localStorage.getItem(key);
    if (!localVal) {
        return;
    }

    const currentTasks: LocalTask = JSON.parse(localVal as string);

    let userIds = [...currentTasks.userIds];
    let newUserIds: string[] = [];

    if (remove && Array.isArray(remove)) {
        newUserIds = userIds.filter((userId) => !remove.includes(userId));
    }

    add.forEach((userId) => {
        if (!newUserIds.includes(userId)) {
            newUserIds.push(userId);
        }
    });

    userIds = [...new Set(userIds)].sort();
    newUserIds = [...new Set(newUserIds)].sort();

    if (userIds.join("") === newUserIds.join("")) {
        return;
    }

    if (newUserIds.length === 0) {
        localStorage.removeItem(key);
    } else {
        currentTasks.userIds = newUserIds;
        localStorage.setItem(key, JSON.stringify(currentTasks));
    }
}

export function addLocalTask(sessionId: string, add: string[]) {
    return replaceLocalTask(sessionId, add, []);
}

export function removeLocalTask(sessionId: string, remove: string[]) {
    return replaceLocalTask(sessionId, [], remove);
}

export async function resendSharedRoomKey(client: MatrixClient) {
    const taskKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || "";
        if (/^nostr.task./.test(key)) {
            taskKeys.push(key);
        }
    }

    const callback = async (roomId: string, userId: string, session: any) => {
        let res;
        try {
            res = await createKind104Event(client, roomId, userId, session);
            removeLocalTask(session.sessionId, [userId]);
        } catch {
            console.debug(`Failed send to share ${userId}/${session.sessionId}`);
        }
        return res;
    };

    const allTasks: LocalTask[] = taskKeys
        .map((key) => JSON.parse(localStorage.getItem(key) as string) as LocalTask)
        .sort((a, b) => a.created > b.created);

    await Promise.all(allTasks.map((task) => attemptShareRoomKey(client, task, callback)));
}
