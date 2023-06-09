import React, { useState, useEffect, useRef } from 'react';
import './Drawer.scss';

import initMatrix from '../../../client/initMatrix';
import cons from '../../../client/state/cons';
import navigation from '../../../client/state/navigation';

import Text from '../../atoms/text/Text';
import ScrollView from '../../atoms/scroll/ScrollView';

import DrawerHeader from './DrawerHeader';
import DrawerBreadcrumb from './DrawerBreadcrumb';
import Home from './Home';
import Directs from './Directs';

import { useForceUpdate } from '../../hooks/useForceUpdate';
import { useSelectedTab } from '../../hooks/useSelectedTab';
import { useSelectedSpace } from '../../hooks/useSelectedSpace';

function useSystemState() {
  const [systemState, setSystemState] = useState(null);

  useEffect(() => {
    const handleSystemState = (state) => {
      if (state === 'ERROR' || state === 'RECONNECTING' || state === 'STOPPED') {
        setSystemState({ status: 'Connection lost!' });
      }
      if (systemState !== null) setSystemState(null);
    };
    initMatrix.matrixClient.on('sync', handleSystemState);
    return () => {
      initMatrix.matrixClient.removeListener('sync', handleSystemState);
    };
  }, [systemState]);

  return [systemState];
}

function Drawer() {
  const [systemState] = useSystemState();
  const [selectedTab, subSelectedTab] = useSelectedTab();
  const [spaceId] = useSelectedSpace();
  const [, forceUpdate] = useForceUpdate();
  const scrollRef = useRef(null);
  const { roomList } = initMatrix;
  const classNameHidden = 'client__item-hidden';
  const navWrapperRef = useRef(null);

  function onRoomSelected(roomId) {
    if (roomId === cons.sepcialRoomType.Contacts) {
      navWrapperRef.current?.classList.add(classNameHidden);
    }
  }
  function onNavigationSelected() {
    navWrapperRef.current?.classList.remove(classNameHidden);
  }
  useEffect(() => {
    const handleUpdate = () => {
      forceUpdate();
    };
    navigation.on(cons.events.navigation.ROOM_SELECTED, onRoomSelected);
    navigation.on(cons.events.navigation.NAVIGATION_OPENED, onNavigationSelected);

    roomList.on(cons.events.roomList.ROOMLIST_UPDATED, handleUpdate);
    return () => {
      roomList.removeListener(cons.events.roomList.ROOMLIST_UPDATED, handleUpdate);
      navigation.off(cons.events.navigation.ROOM_SELECTED, onRoomSelected);
      navigation.off(cons.events.navigation.NAVIGATION_OPENED, onNavigationSelected);


    };
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    });
  }, [selectedTab]);

  return (
    <div className="drawer" ref={navWrapperRef}>
      <DrawerHeader selectedTab={selectedTab} spaceId={spaceId} subSelectedTab={subSelectedTab} />
      <div className="drawer__content-wrapper">
        {navigation.selectedSpacePath.length > 1 && selectedTab !== cons.tabs.DIRECTS && (
          <DrawerBreadcrumb spaceId={spaceId} />
        )}
        <div className="rooms__wrapper">
          <ScrollView ref={scrollRef} autoHide>
            <div className="rooms-container">
              {
                selectedTab !== cons.tabs.DIRECTS
                  ? <Home spaceId={spaceId} />
                  : <Directs size={roomList.directs.size} />
              }
            </div>
          </ScrollView>
        </div>
      </div>
      {systemState !== null && (
        <div className="drawer__state">
          <Text>{systemState.status}</Text>
        </div>
      )}
    </div>
  );
}

export default Drawer;
