import { EventType } from 'src/client/src/@types/event';
import { Kind } from 'nostr-tools';

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
export type Kinds = Kind | KindExtention;
