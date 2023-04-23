import { EventType } from "src/client/src/@types/event";
import { Kind } from "nostr-tools";

export interface MetaInfo {
    picture: string;
    name: string;
    about: string;
}

export interface RoomMetaInfo {
    roomId: string;
    sender: string;
    eventId: string;
    createdAt: number;
    content: string | object;
    type: EventType;
    state_key?: string;
}
enum KindExtention {
    Typing = 20001,
    Recipent = 20002,
}
enum CryptoGroupExtention {
    RoomKey = 104,
    RoomCreation = 140,
    RoomMeta = 141,
    RoomMessage = 142,
}
export interface RoomKey {
    session_id: string;
    session_key: string;
    room_id: string;
}

export type Kinds = Kind | KindExtention | CryptoGroupExtention;

export type RoomKeySession = {
    sessionId: string;
    sessionKey: string;
};

export type LocalTask = {
    roomId: string;
    created: number;
    userIds: string[];
    session: RoomKeySession;
};
