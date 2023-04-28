import React, { useState, useEffect } from 'react';
import './Room.scss';

import initMatrix from '../../../client/initMatrix';
import cons from '../../../client/state/cons';
import settings from '../../../client/state/settings';
import RoomTimeline from '../../../client/state/RoomTimeline';
import navigation from '../../../client/state/navigation';
import { openNavigation } from '../../../client/action/navigation';
import ContactPeopleDrawer from "../contact/ContactPeopleDrawer"
import Welcome from '../welcome/Welcome';
import RoomView from './RoomView';
import RoomSettings from './RoomSettings';
import PeopleDrawer from './PeopleDrawer';

function Room() {
  const [roomInfo, setRoomInfo] = useState({
    roomTimeline: null,
    eventId: null,
    roomId: null,
  });
  const [isDrawer, setIsDrawer] = useState(settings.isPeopleDrawer);

  const mx = initMatrix.matrixClient;

  useEffect(() => {
    const handleRoomSelected = (rId, pRoomId, eId) => {
      roomInfo.roomTimeline?.removeInternalListeners();
      if (rId === cons.sepcialRoomType.Contacts) {
        setRoomInfo({
          roomTimeline: null,
          eventId: null,
          roomId: rId
        });
        return
      }
      const room = mx.getRoom(rId)
      if (room) {
        mx.subscribeUsersDeletionRoom(rId)
        mx.handSetRoomUnReadCount(rId, 0)
        setRoomInfo({
          roomTimeline: new RoomTimeline(rId),
          eventId: eId ?? null,
          roomId: rId
        });
      } else {
        // TODO: add ability to join room if roomId is invalid
        setRoomInfo({
          roomTimeline: null,
          eventId: null,
          roomId: null
        });
      }
    };

    navigation.on(cons.events.navigation.ROOM_SELECTED, handleRoomSelected);
    return () => {
      const roomId = roomInfo?.roomTimeline?.roomId
      if (roomId) {
        mx.handSetRoomUnReadCount(roomId, 0)

      }

      navigation.removeListener(cons.events.navigation.ROOM_SELECTED, handleRoomSelected);
    };
  }, [roomInfo]);

  useEffect(() => {
    const handleDrawerToggling = (visiblity) => setIsDrawer(visiblity);
    settings.on(cons.events.settings.PEOPLE_DRAWER_TOGGLED, handleDrawerToggling);
    return () => {
      settings.removeListener(cons.events.settings.PEOPLE_DRAWER_TOGGLED, handleDrawerToggling);
    };
  }, []);

  const { roomTimeline, eventId, roomId } = roomInfo;

  if (roomId === cons.sepcialRoomType.Contacts) {
    return <ContactPeopleDrawer roomId={roomId} />;
  }
  if (roomTimeline === null) {
    setTimeout(() => openNavigation());
    return <Welcome />;
  }

  return (
    <div className="room">
      <div className="room__content">
        <RoomSettings roomId={roomTimeline.roomId} />
        <RoomView roomTimeline={roomTimeline} eventId={eventId} />
      </div>
      {isDrawer && <PeopleDrawer roomId={roomTimeline.roomId} />}
    </div>
  );
}

export default Room;
