import React, { useState, useEffect, useRef } from 'react';
import './Settings.scss';

import initMatrix from '../../../client/initMatrix';
import cons from '../../../client/state/cons';
import settings from '../../../client/state/settings';
import navigation from '../../../client/state/navigation';
import {
  toggleSystemTheme, toggleMarkdown, toggleMembershipEvents, toggleNickAvatarEvents,
  toggleNotifications, toggleNotificationSounds,
} from '../../../client/action/settings';
import { usePermission } from '../../hooks/usePermission';

import Text from '../../atoms/text/Text';
import IconButton from '../../atoms/button/IconButton';
import Button from '../../atoms/button/Button';
import Toggle from '../../atoms/button/Toggle';
import Tabs from '../../atoms/tabs/Tabs';
import { MenuHeader } from '../../atoms/context-menu/ContextMenu';
import SegmentedControls from '../../atoms/segmented-controls/SegmentedControls';
import Input from '../../atoms/input/Input';

import PopupWindow from '../../molecules/popup-window/PopupWindow';
import SettingTile from '../../molecules/setting-tile/SettingTile';
import ImportE2ERoomKeys from '../../molecules/import-export-e2e-room-keys/ImportE2ERoomKeys';
import ExportE2ERoomKeys from '../../molecules/import-export-e2e-room-keys/ExportE2ERoomKeys';
import { ImagePackUser, ImagePackGlobal } from '../../molecules/image-pack/ImagePack';
import GlobalNotification from '../../molecules/global-notification/GlobalNotification';
import KeywordNotification from '../../molecules/global-notification/KeywordNotification';
import IgnoreUserList from '../../molecules/global-notification/IgnoreUserList';

import ProfileEditor from '../profile-editor/ProfileEditor';
import CrossSigning from './CrossSigning';
import KeyBackup from './KeyBackup';
import DeviceManage from './DeviceManage';

import SunIC from '../../../../public/res/ic/outlined/sun.svg';
import EmojiIC from '../../../../public/res/ic/outlined/emoji.svg';
import LockIC from '../../../../public/res/ic/outlined/lock.svg';
import BellIC from '../../../../public/res/ic/outlined/bell.svg';
import InfoIC from '../../../../public/res/ic/outlined/info.svg';
import PowerIC from '../../../../public/res/ic/outlined/power.svg';
import CrossIC from '../../../../public/res/ic/outlined/cross.svg';
import BinIC from '../../../../public/res/ic/outlined/bin.svg';

import CinnySVG from '../../../../public/res/svg/cinny.svg';
import { confirmDialog } from '../../molecules/confirm-dialog/ConfirmDialog';

function RelaySection() {
  const mx = initMatrix.matrixClient;
  const [relays, setRelays] = useState([...mx.getRelays()]);
  const [, refreshState] = useState({});

  useEffect(() => {
    const relaysTimer = setInterval(() => {
      setRelays([...mx.getRelays()]);
    }, 1000);
    return () => {
      clearInterval(relaysTimer);
    };
  }, []);

  const addRelay = (e) => {
    e.preventDefault();
    if ('new-relay-url' in e.target.elements) {
      const input = e.target.elements['new-relay-url'];
      const url = input.value.trim();
      // const isWebSocketURI = /^ws(s)?:\/\/(([A-Za-z0-9-~]+)\.)+[A-Za-z0-9-~/]+(\?[\w-~&=]*)?(#\w*)?$/.test(url);
      const isWebSocketProtocol = /^ws(s)?:\/\//.test(url);
      if (url && isWebSocketProtocol) {
        mx.addRelay(url);
        input.value = '';
        refreshState();
      }
    }
  };

  const saveRelays = () => {
    mx.saveRelays()
  };

  const resetRelays = async () => {
    if (
      await confirmDialog(
        'Reset',
        'Are you sure you want to reset to the default relays?',
        'Yes',
        'danger'
      )
    ) {
      mx.restoreDefaultRelays();
    }
  };

  return (
    <div className="settings-appearance__card">
      <MenuHeader>Your Relays</MenuHeader>
      {
        relays.map((relay) => (
          <SettingTile
            title={relay.url}
            options={
              <div className="relay-manage">
                <div className="toggle-margin">
                  {' '}
                  <Toggle
                    isActive={relay.status === 1 && relay.enabled}
                    onToggle={async () => {
                      await mx.toggleRelay(relay);
                      refreshState();
                    }}
                  />
                </div>
                <IconButton
                  size="small"
                  onClick={() => {
                    mx.removeRelay(relay.url);
                    refreshState();
                  }}
                  src={BinIC}
                  tooltip="Remove session"
                />
              </div>
            }
          />
        ))
      }
      <SettingTile
        content={
          <div className="keyword-notification__keyword">
            <form onSubmit={addRelay}>
              <Input name="new-relay-url" required placeholder="wss://relay.example.com" />
              <Button variant="primary" type="submit">
                Add
              </Button>
            </form>
            {' '}
            <div className="relay-buttons">
              {' '}
              <Button
                variant="positive"
                type="submit"
                onClick={saveRelays}
              >
                Save
              </Button>
              <Button variant="danger" type="submit" onClick={resetRelays}>
                Reset
              </Button>
            </div>
          </div>
        }
      />
    </div>
  )
}

function AppearanceSection() {
  const [, updateState] = useState({});

  return (
    <div className="settings-appearance">
      <div className="settings-appearance__card">
        <MenuHeader>Theme</MenuHeader>
        <SettingTile
          title="Follow system theme"
          options={(
            <Toggle
              isActive={settings.useSystemTheme}
              onToggle={() => { toggleSystemTheme(); updateState({}); }}
            />
          )}
          content={<Text variant="b3">Use light or dark mode based on the system settings.</Text>}
        />
        <SettingTile
          title="Theme"
          content={(
            <SegmentedControls
              selected={settings.useSystemTheme ? -1 : settings.getThemeIndex()}
              segments={[
                { text: 'Light' },
                { text: 'Silver' },
                { text: 'Dark' },
                { text: 'Butter' },
              ]}
              onSelect={(index) => {
                if (settings.useSystemTheme) toggleSystemTheme();
                settings.setTheme(index);
                updateState({});
              }}
            />
          )}
        />
      </div>
      {/* <div className="settings-appearance__card">
        <MenuHeader>Room messages</MenuHeader>
        <SettingTile
          title="Markdown formatting"
          options={(
            <Toggle
              isActive={settings.isMarkdown}
              onToggle={() => { toggleMarkdown(); updateState({}); }}
            />
          )}
          content={<Text variant="b3">Format messages with markdown syntax before sending.</Text>}
        />
        <SettingTile
          title="Hide membership events"
          options={(
            <Toggle
              isActive={settings.hideMembershipEvents}
              onToggle={() => { toggleMembershipEvents(); updateState({}); }}
            />
          )}
          content={<Text variant="b3">Hide membership change messages from room timeline. (Join, Leave, Invite, Kick and Ban)</Text>}
        />
        <SettingTile
          title="Hide nick/avatar events"
          options={(
            <Toggle
              isActive={settings.hideNickAvatarEvents}
              onToggle={() => { toggleNickAvatarEvents(); updateState({}); }}
            />
          )}
          content={<Text variant="b3">Hide nick and avatar change messages from room timeline.</Text>}
        />
      </div> */}
      <RelaySection />
    </div>
  );
}

function NotificationsSection() {
  const [permission, setPermission] = usePermission('notifications', window.Notification?.permission);

  const [, updateState] = useState({});

  const renderOptions = () => {
    if (window.Notification === undefined) {
      return <Text className="settings-notifications__not-supported">Not supported in this browser.</Text>;
    }

    if (permission === 'granted') {
      return (
        <Toggle
          isActive={settings._showNotifications}
          onToggle={() => {
            toggleNotifications();
            setPermission(window.Notification?.permission);
            updateState({});
          }}
        />
      );
    }

    return (
      <Button
        variant="primary"
        onClick={() => window.Notification.requestPermission().then(setPermission)}
      >
        Request permission
      </Button>
    );
  };

  return (
    <>
      <div className="settings-notifications">
        <MenuHeader>Notification & Sound</MenuHeader>
        <SettingTile
          title="Desktop notification"
          options={renderOptions()}
          content={<Text variant="b3">Show desktop notification when new messages arrive.</Text>}
        />
        <SettingTile
          title="Notification Sound"
          options={(
            <Toggle
              isActive={settings.isNotificationSounds}
              onToggle={() => { toggleNotificationSounds(); updateState({}); }}
            />
          )}
          content={<Text variant="b3">Play sound when new messages arrive.</Text>}
        />
      </div>
      <GlobalNotification />
      <KeywordNotification />
      <IgnoreUserList />
    </>
  );
}

function EmojiSection() {
  return (
    <>
      <div className="settings-emoji__card"><ImagePackUser /></div>
      <div className="settings-emoji__card"><ImagePackGlobal /></div>
    </>
  );
}

function SecuritySection() {
  // change by nostr
  const mx = initMatrix.matrixClient;
  const onPrivateClick = () => {
    const clipboard = navigator.clipboard;
    clipboard.writeText(mx.getAccessToken())
  }
  const onPubClick = () => {
    const clipboard = navigator.clipboard;
    clipboard.writeText(mx.getUserId())
  }
  return (
    <div className="settings-security">
      <div className="settings-security__card">
        <MenuHeader>Keys</MenuHeader>
        <SettingTile
          title='Your public key'
          content={<div className="keyword-notification__keyword">
            <div className='key-form'>
              <Input name="new-relay-url" disabled value={mx.getUserId()} />
              <Button variant="primary" onClick={onPubClick}>
                Copy
              </Button>
            </div>

          </div>}
        />
        <SettingTile
          title='Your private key'
          content={<div className="keyword-notification__keyword">
            <div className='key-form'>

              <Input name="private" disabled value={mx.getAccessToken()} type="password" />
              <Button variant="primary" onClick={onPrivateClick}>
                Copy
              </Button>
            </div>

          </div>}
        />
      </div>
    </div >
  )
  // return (
  //   <div className="settings-security">
  //     <div className="settings-security__card">
  //       <MenuHeader>Cross signing and backup</MenuHeader>
  //       <CrossSigning />
  //       <KeyBackup />
  //     </div>
  //     <DeviceManage />
  //     <div className="settings-security__card">
  //       <MenuHeader>Export/Import encryption keys</MenuHeader>
  //       <SettingTile
  //         title="Export E2E room keys"
  //         content={(
  //           <>
  //             <Text variant="b3">Export end-to-end encryption room keys to decrypt old messages in other session. In order to encrypt keys you need to set a password, which will be used while importing.</Text>
  //             <ExportE2ERoomKeys />
  //           </>
  //         )}
  //       />
  //       <SettingTile
  //         title="Import E2E room keys"
  //         content={(
  //           <>
  //             <Text variant="b3">{'To decrypt older messages, Export E2EE room keys from Element (Settings > Security & Privacy > Encryption > Cryptography) and import them here. Imported keys are encrypted so you\'ll have to enter the password you set in order to decrypt it.'}</Text>
  //             <ImportE2ERoomKeys />
  //           </>
  //         )}
  //       />
  //     </div>
  //   </div>
  // );
}

function AboutSection() {
  return (
    <div className="settings-about">
      <div className="settings-about__card">
        <MenuHeader>Application</MenuHeader>
        <div className="settings-about__branding">
          <img width="60" height="60" src={CinnySVG} alt="Denny logo" />
          <div>
            <Text variant="h2" weight="medium">
              Denny
              <span className="text text-b3" style={{ margin: '0 var(--sp-extra-tight)' }}>{`v${cons.version}`}</span>
            </Text>
            <Text>Yet another denny client</Text>

            <div className="settings-about__btns">
              <Button onClick={() => window.open('https://github.com/Guakamoli/denny')}>Source code</Button>
              {/* <Button onClick={() => window.open('https://cinny.in/#sponsor')}>Support</Button> */}
              <Button onClick={() => initMatrix.clearCacheAndReload()} variant="danger">Clear cache & reload</Button>
            </div>
          </div>
        </div>
      </div>
      <div className="settings-about__card">
        <MenuHeader>Credits</MenuHeader>
        <div className="settings-about__credits">
          <ul>
            <li>
              {/* eslint-disable-next-line react/jsx-one-expression-per-line */}
              <Text>The <a href="https://github.com/Guakamoli/matrix-nostr-js-sdk" rel="noreferrer noopener" target="_blank">matrix-nostr-js-sdk</a> is © <a rel="noreferrer noopener" target="_blank">Guakamoli Media Technology Corporation</a> used under the terms of <a href="http://www.apache.org/licenses/LICENSE-2.0" rel="noreferrer noopener" target="_blank">Apache 2.0</a>.</Text>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export const tabText = {
  APPEARANCE: 'Appearance',
  NOTIFICATIONS: 'Notifications',
  EMOJI: 'Emoji',
  SECURITY: 'Security',
  ABOUT: 'About',
};
const tabItems = [{
  text: tabText.APPEARANCE,
  iconSrc: SunIC,
  disabled: false,
  render: () => <AppearanceSection />,
}, {
  text: tabText.NOTIFICATIONS,
  iconSrc: BellIC,
  disabled: false,
  render: () => <NotificationsSection />,
}, {
  text: tabText.EMOJI,
  iconSrc: EmojiIC,
  disabled: false,
  render: () => <EmojiSection />,
}, {
  text: tabText.SECURITY,
  iconSrc: LockIC,
  disabled: false,
  render: () => <SecuritySection />,
}, {
  text: tabText.ABOUT,
  iconSrc: InfoIC,
  disabled: false,
  render: () => <AboutSection />,
}];

function useWindowToggle(setSelectedTab) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const openSettings = (tab) => {
      const tabItem = tabItems.find((item) => item.text === tab);
      if (tabItem) setSelectedTab(tabItem);
      setIsOpen(true);
    };
    navigation.on(cons.events.navigation.SETTINGS_OPENED, openSettings);
    return () => {
      navigation.removeListener(cons.events.navigation.SETTINGS_OPENED, openSettings);
    };
  }, []);

  const requestClose = () => setIsOpen(false);

  return [isOpen, requestClose];
}

function Settings() {
  const [selectedTab, setSelectedTab] = useState(tabItems[0]);
  const [isOpen, requestClose] = useWindowToggle(setSelectedTab);

  const handleTabChange = (tabItem) => setSelectedTab(tabItem);
  const handleLogout = async () => {
    if (await confirmDialog('Logout', 'Are you sure that you want to logout your session?', 'Logout', 'danger')) {
      initMatrix.logout();
    }
  };

  return (
    <PopupWindow
      isOpen={isOpen}
      className="settings-window"
      title={<Text variant="s1" weight="medium" primary>Settings</Text>}
      contentOptions={(
        <>
          <Button variant="danger" iconSrc={PowerIC} onClick={handleLogout} buttonTestid="logout">
            Logout
          </Button>
          <IconButton src={CrossIC} onClick={requestClose} tooltip="Close" />
        </>
      )}
      onRequestClose={requestClose}
    >
      {isOpen && (
        <div className="settings-window__content">
          <ProfileEditor userId={initMatrix.matrixClient.getUserId()} />
          <Tabs
            items={tabItems}
            defaultSelected={tabItems.findIndex((tab) => tab.text === selectedTab.text)}
            onSelect={handleTabChange}
          />
          <div className="settings-window__cards-wrapper">
            {selectedTab.render()}
          </div>
        </div>
      )}
    </PopupWindow>
  );
}

export default Settings;
