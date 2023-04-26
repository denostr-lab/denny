/* eslint-disable import/prefer-default-export */
import { useState, useEffect } from 'react';

import cons from '../../client/state/cons';
import navigation from '../../client/state/navigation';

export function useSelectedTab() {
  const [selectedTab, setSelectedTab] = useState(navigation.selectedTab);
  const [subSelectedTab, setSubSelectedTab] = useState('');

  useEffect(() => {
    const onTabSelected = (tabIdString) => {
      const tabIdList = tabIdString.split('|')
      const tabId = tabIdList[0]
      const subTabId = tabIdList[1] || ''
      setSelectedTab(tabId);
      setSubSelectedTab(subTabId)
    };
    navigation.on(cons.events.navigation.TAB_SELECTED, onTabSelected);
    return () => {
      navigation.removeListener(cons.events.navigation.TAB_SELECTED, onTabSelected);
    };
  }, []);

  return [selectedTab, subSelectedTab];
}
