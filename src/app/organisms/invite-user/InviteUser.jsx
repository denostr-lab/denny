import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import './InviteUser.scss';

import initMatrix from '../../../client/initMatrix';
import cons from '../../../client/state/cons';
import * as roomActions from '../../../client/action/room';
import { selectRoom } from '../../../client/action/navigation';
import { hasDMWith, hasDevices } from '../../../util/matrixUtil';

import Text from '../../atoms/text/Text';
import Button from '../../atoms/button/Button';
import IconButton from '../../atoms/button/IconButton';
import Spinner from '../../atoms/spinner/Spinner';
import Input from '../../atoms/input/Input';
import PopupWindow from '../../molecules/popup-window/PopupWindow';
import RoomTile from '../../molecules/room-tile/RoomTile';

import CrossIC from '../../../../public/res/ic/outlined/cross.svg';
import AddUserIC from '../../../../public/res/ic/outlined/add-user.svg';
import CheckIC from '../../../../public/res/ic/outlined/check.svg';

import Key from '../../../client/src/nostr/src/Key'

function InviteUser({
  isOpen, roomId, searchTerm, onRequestClose,
}) {
  const [isSearching, updateIsSearching] = useState(false);
  const [searchQuery, updateSearchQuery] = useState({});
  const [users, updateUsers] = useState([]);

  const [procUsers, updateProcUsers] = useState(new Set()); // proc stands for processing.
  const [procUserError, updateUserProcError] = useState(new Map());

  const [createdDM, updateCreatedDM] = useState(new Map());
  const [roomIdToUserId, updateRoomIdToUserId] = useState(new Map());

  const [invitedUserIds, updateInvitedUserIds] = useState(new Set());

  const usernameRef = useRef(null);

  const mx = initMatrix.matrixClient;

  function getMapCopy(myMap) {
    const newMap = new Map();
    myMap.forEach((data, key) => {
      newMap.set(key, data);
    });
    return newMap;
  }
  function addUserToProc(userId) {
    procUsers.add(userId);
    updateProcUsers(new Set(Array.from(procUsers)));
  }
  function deleteUserFromProc(userId) {
    procUsers.delete(userId);
    updateProcUsers(new Set(Array.from(procUsers)));
  }

  function onDMCreated(newRoomId) {
    const myDMPartnerId = roomIdToUserId.get(newRoomId);
    if (typeof myDMPartnerId === 'undefined') return;

    createdDM.set(myDMPartnerId, newRoomId);
    roomIdToUserId.delete(newRoomId);

    deleteUserFromProc(myDMPartnerId);
    updateCreatedDM(getMapCopy(createdDM));
    updateRoomIdToUserId(getMapCopy(roomIdToUserId));
  }

  async function searchUser(username) {
    const inputUsername = username.trim();
    if (isSearching || inputUsername === '' || inputUsername === searchQuery.username) return;
    const isInputUserId = inputUsername[0] === '@' && inputUsername.indexOf(':') > 1;
    updateIsSearching(true);
    updateSearchQuery({ username: inputUsername });

    if (isInputUserId) {
      try {
        const result = await mx.getProfileInfo(inputUsername);
        updateUsers([{
          user_id: inputUsername,
          display_name: result.displayname,
          avatar_url: result.avatar_url,
        }]);
      } catch (e) {
        updateSearchQuery({ error: `${inputUsername} not found!` });
      }
    } else {
      try {
        const result = await mx.searchUserDirectory({
          term: inputUsername,
          limit: 20,
        });
        if (result.results.length === 0) {
          updateSearchQuery({ error: `No matches found for "${inputUsername}"!` });
          updateIsSearching(false);
          return;
        }
        updateUsers(result.results);
      } catch (e) {
        updateSearchQuery({ error: 'Something went wrong!' });
      }
    }
    updateIsSearching(false);
  }

  async function addInviteUser(address) {
    const inputAddress = address.trim();
    if (isSearching || inputAddress === '' || inputAddress === searchQuery.username) return;

    const user = {
      user_id: inputAddress,
      display_name: inputAddress,
      avatar_url: '',
    };
    if (inputAddress.startsWith('npub')) {
      user.display_name = inputAddress;
      user.user_id = Key.toNostrHexAddress(inputAddress);
    } else {
      user.display_name = Key.toNostrBech32Address(inputAddress, 'npub');
      user.user_id = inputAddress;
    }

    if (!user.user_id.match(/^[0-9a-fA-F]{64}$/)) {
      updateSearchQuery({ error: 'Invalid npub or hex value!' });
      return;
    }

    updateSearchQuery({});

    if (!users.find((u) => u.user_id === user.user_id)) {
      const profile = await mx.getProfileInfo(user.user_id);
      user.display_name = profile.displayname || user.display_name;
      user.avatar_url = profile.avatar_url || user.avatar_url;
      users.push(user);
      updateUsers([...users]);
    }
  }

  async function submitToInviteUsers() {
    updateSearchQuery({});
    if (roomId) {
      try {
        const invitePubkeys = users.map((user) => user.user_id);
        const event = await mx.inviteUserToEncryptedChannel({ id: roomId }, invitePubkeys);
        console.log('submitToInviteUsers result to event:', event);
        onRequestClose();
      } catch (e) {
        updateSearchQuery({ error: 'Something went wrong!' });
      }
    } else {
      addInviteUser(usernameRef.current.value);
    }
  }

  async function createDM(userId) {
    if (mx.getUserId() === userId) return;
    const dmRoomId = hasDMWith(userId);
    if (dmRoomId) {
      selectRoom(dmRoomId);
      onRequestClose();
      return;
    }

    try {
      addUserToProc(userId);
      procUserError.delete(userId);
      updateUserProcError(getMapCopy(procUserError));

      const result = await roomActions.createDM(userId, await hasDevices(userId));
      roomIdToUserId.set(result.room_id, userId);
      updateRoomIdToUserId(getMapCopy(roomIdToUserId));
      selectRoom(result.room_id);
      onRequestClose();
    } catch (e) {
      deleteUserFromProc(userId);
      if (typeof e.message === 'string') procUserError.set(userId, e.message);
      else procUserError.set(userId, 'Something went wrong!');
      updateUserProcError(getMapCopy(procUserError));
    }
  }

  // async function inviteToRoom(userId) {
  //   if (typeof roomId === 'undefined') return;
  //   try {
  //     addUserToProc(userId);
  //     procUserError.delete(userId);
  //     updateUserProcError(getMapCopy(procUserError));

  //     await roomActions.invite(roomId, userId);

  //     invitedUserIds.add(userId);
  //     updateInvitedUserIds(new Set(Array.from(invitedUserIds)));
  //     deleteUserFromProc(userId);
  //   } catch (e) {
  //     deleteUserFromProc(userId);
  //     if (typeof e.message === 'string') procUserError.set(userId, e.message);
  //     else procUserError.set(userId, 'Something went wrong!');
  //     updateUserProcError(getMapCopy(procUserError));
  //   }
  // }

  function renderUserList() {
    const renderOptions = (userId) => {
      //   const messageJSX = (message, isPositive) => <Text variant="b2"><span style={{ color: isPositive ? 'var(--bg-positive)' : 'var(--bg-negative)' }}>{message}</span></Text>;

      if (mx.getUserId() === userId) return null;
      if (procUsers.has(userId)) {
        return <Spinner size="small" />;
      }
      if (createdDM.has(userId)) {
        // eslint-disable-next-line max-len
        return <Button onClick={() => { selectRoom(createdDM.get(userId)); onRequestClose(); }}>Open</Button>;
      }

      if (typeof roomId === 'string') return null;

      return (<Button onClick={() => createDM(userId)} variant="primary">Message</Button>);

      //   if (invitedUserIds.has(userId)) {
      //     return messageJSX('Invited', true);
      //   }
      //   if (typeof roomId === 'string') {
      //     const member = mx.getRoom(roomId).getMember(userId);
      //     if (member !== null) {
      //       const userMembership = member.membership;
      //       switch (userMembership) {
      //         case 'join':
      //           return messageJSX('Already joined', true);
      //         case 'invite':
      //           return messageJSX('Already Invited', true);
      //         case 'ban':
      //           return messageJSX('Banned', false);
      //         default:
      //       }
      //     }
      //   }
      //   return (typeof roomId === 'string')
      //     ? <Button onClick={() => inviteToRoom(userId)} variant="primary">Invite</Button>
      //     : <Button onClick={() => createDM(userId)} variant="primary">Message</Button>;
    };
    const renderError = (userId) => {
      if (!procUserError.has(userId)) return null;
      return <Text variant="b2"><span style={{ color: 'var(--bg-danger)' }}>{procUserError.get(userId)}</span></Text>;
    };

    return users.map((user) => {
      const userId = user.user_id;
      const name = typeof user.display_name === 'string' ? user.display_name : userId;
      return (
        <RoomTile
          key={userId}
          avatarSrc={typeof user.avatar_url === 'string' ? mx.mxcUrlToHttp(user.avatar_url, 42, 42, 'crop') : null}
          name={name}
          id={userId}
          options={renderOptions(userId)}
          desc={renderError(userId)}
        />
      );
    });
  }

  useEffect(() => {
    if (isOpen && typeof searchTerm === 'string') searchUser(searchTerm);
    return () => {
      updateIsSearching(false);
      updateSearchQuery({});
      updateUsers([]);
      updateProcUsers(new Set());
      updateUserProcError(new Map());
      updateCreatedDM(new Map());
      updateRoomIdToUserId(new Map());
      updateInvitedUserIds(new Set());
    };
  }, [isOpen, searchTerm]);

  useEffect(() => {
    initMatrix.roomList.on(cons.events.roomList.ROOM_CREATED, onDMCreated);
    return () => {
      initMatrix.roomList.removeListener(cons.events.roomList.ROOM_CREATED, onDMCreated);
    };
  }, [isOpen, procUsers, createdDM, roomIdToUserId]);

  return (
    <PopupWindow
      isOpen={isOpen}
      title={(typeof roomId === 'string' ? `Invite to ${mx.getRoom(roomId).name}` : 'Direct message')}
      contentOptions={<IconButton src={CrossIC} onClick={onRequestClose} tooltip="Close" />}
      onRequestClose={onRequestClose}
    >
      <div className="invite-user">
        <form className="invite-user__form" onSubmit={(e) => { e.preventDefault(); submitToInviteUsers(); }}>
          {/* <Input value={searchTerm} forwardRef={usernameRef} label="Name or userId" /> */}
          <Input value={searchTerm} forwardRef={usernameRef} label="Npub or Hex key" inputTestid="invite-user-input" />
          {typeof roomId === 'string' ? (
            <>
              <Button disabled={isSearching} iconSrc={AddUserIC} variant="caution-invert" type="button" className="invite-user__add-invite-user" onClick={() => addInviteUser(usernameRef.current.value)} buttonTestid="invite-user-invite">Invite</Button>
              <Button disabled={isSearching} iconSrc={CheckIC} variant="primary" type="submit" className="invite-user__submit-invite-user" buttonTestid="invite-user-confirm">Submit</Button>
            </>
          ) : (
            <Button disabled={isSearching} iconSrc={CheckIC} variant="primary" type="submit" buttonTestid="invite-user-search">Search</Button>
          )
          }
        </form>
        <div className="invite-user__search-status">
          {
            typeof searchQuery.username !== 'undefined' && isSearching && (
              <div className="flex--center">
                <Spinner size="small" />
                <Text variant="b2">{`Searching for user "${searchQuery.username}"...`}</Text>
              </div>
            )
          }
          {
            typeof searchQuery.username !== 'undefined' && !isSearching && (
              <Text variant="b2">{`Search result for user "${searchQuery.username}"`}</Text>
            )
          }
          {
            searchQuery.error && <Text className="invite-user__search-error" variant="b2">{searchQuery.error}</Text>
          }
        </div>
        {users.length !== 0 && (
          <div className="invite-user__content">
            {renderUserList()}
          </div>
        )}
      </div>
    </PopupWindow>
  );
}

InviteUser.defaultProps = {
  roomId: undefined,
  searchTerm: undefined,
};

InviteUser.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  roomId: PropTypes.string,
  searchTerm: PropTypes.string,
  onRequestClose: PropTypes.func.isRequired,
};

export default InviteUser;
