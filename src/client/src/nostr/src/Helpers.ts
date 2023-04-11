import { IJoinedRoom, ISyncResponse } from '../../sync-accumulator';

import { EventType } from '../../@types/event';
import { MsgType } from 'matrix-js-sdk/lib/@types/event';
import { IContent } from 'matrix-js-sdk/lib/models/event';
import { RoomMetaInfo } from './@types';
export const stateKeyFilters = [
  EventType.RoomName,
  EventType.RoomTopic,
  EventType.RoomAvatar,
  EventType.RoomCreate,
  EventType.RoomJoinRules,
];
export const arrayToHex = (array: Uint8Array): string => {
  return Array.from(array, (byte) => {
    return ('0' + (byte & 0xff).toString(16)).slice(-2);
  }).join('');
};

const imgRegex =
  /\b(https?:\/\/\S+(?:\.png|\.jpe?g|\.gif|\.webp|\.PNG|\.JPE?G|\.GIF|\.WEBP)\S*)\b/g;
const videoRegex = /\b(https?:\/\/\S+(?:\.mp4|\.mov|\.avi)\S*)\b/g;
const audioRegex = /\b(https?:\/\/\S+(?:\.mp3|\.wav|\.ogg)\S*)\b/g;
// const Regex = /\b(https?:\/\/\S+(?:\.mp3|\.wav|\.ogg)\S*)\b/g;
const mediaList = [
  { reg: imgRegex, key: 'image', msgtype: MsgType.Image },
  { reg: videoRegex, key: 'video', msgtype: MsgType.Video },
  { reg: audioRegex, key: 'audio', msgtype: MsgType.Audio },
];
export const getDefaultRoomData = (): IJoinedRoom => {
  return {
    summary: {
      'm.heroes': [],
      'm.invited_member_count': null,
      'm.joined_member_count': null,
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
    field: 'name',
  },
  about: {
    type: EventType.RoomTopic,
    field: 'topic',
  },
  picture: {
    type: EventType.RoomAvatar,
    field: 'url',
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
    state_key: roomMetaInfo.state_key ?? '',
    type: roomMetaInfo.type,
    unsigned: {
      age: Date.now() - roomMetaInfo.createdAt,
    },
    event_id: roomMetaInfo.eventId,
  });
};
export const handMediaContent = (content: IContent): IContent => {
  for (const mediaType of mediaList) {
    if (content.body.match(mediaType.reg)) {
      const splitList = content.body.split('.');
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
