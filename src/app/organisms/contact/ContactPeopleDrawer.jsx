import React, {
  useState, useEffect, useCallback, useRef,
} from 'react';
import PropTypes from 'prop-types';
import './ContactPeopleDrawer.scss';
import { useForceUpdate } from '../../hooks/useForceUpdate';
import { throttle } from "lodash-es";
import RoomViewHeader from './RoomViewHeader';

import initMatrix from '../../../client/initMatrix';
import { getPowerLabel, getUsernameOfRoomMember } from '../../../util/matrixUtil';
import colorMXID from '../../../util/colorMXID';
import { openInviteUser, openProfileViewer } from '../../../client/action/navigation';
import AsyncSearch from '../../../util/AsyncSearch';
import { memberByAtoZ, memberByPowerLevel } from '../../../util/sort';

import Text from '../../atoms/text/Text';
import Header, { TitleWrapper } from '../../atoms/header/Header';
import RawIcon from '../../atoms/system-icons/RawIcon';
import IconButton from '../../atoms/button/IconButton';
import Button from '../../atoms/button/Button';
import ScrollView from '../../atoms/scroll/ScrollView';
import Input from '../../atoms/input/Input';
import SegmentedControl from '../../atoms/segmented-controls/SegmentedControls';
import PeopleSelector from '../../molecules/people-selector/PeopleSelector';

import AddUserIC from '../../../../public/res/ic/outlined/add-user.svg';
import SearchIC from '../../../../public/res/ic/outlined/search.svg';
import CrossIC from '../../../../public/res/ic/outlined/cross.svg';

function simplyfiMembers(members) {
  return members.map((member) => ({
    userId: member.userId,
    name: member.getDisplayName(),
    username: member.userId,
    avatarSrc: member.getAvatarUrl(),

  }));
}

const asyncSearch = new AsyncSearch();
function ContactPeopleDrawer({ roomId }) {
  const PER_PAGE_MEMBER = 50;
  const mx = initMatrix.matrixClient;
  const [itemCount, setItemCount] = useState(PER_PAGE_MEMBER);
  const [memberList, setMemberList] = useState([]);
  const [searchedMembers, setSearchedMembers] = useState(null);
  const searchRef = useRef(null);
  const [randDomData, forceUpdateLimit] = useForceUpdate();
  const roomViewRef = useRef(null);


  function loadMorePeople() {
    setItemCount(itemCount + PER_PAGE_MEMBER);
  }

  function handleSearchData(data) {
    // NOTICE: data is passed as object property
    // because react sucks at handling state update with array.
    setSearchedMembers({ data });
    setItemCount(PER_PAGE_MEMBER);
  }

  function handleSearch(e) {
    const term = e.target.value;
    if (term === '' || term === undefined) {
      searchRef.current.value = '';
      searchRef.current.focus();
      setSearchedMembers(null);
      setItemCount(PER_PAGE_MEMBER);
    } else asyncSearch.search(term);
  }
  useEffect(() => {
    const t = setInterval(() => {
      forceUpdateLimit()
    }, 3000);
    return () => {
      clearInterval(t)
    }
  }, [])
  useEffect(() => {
    const mx = initMatrix.matrixClient;
    const _handle = (event) => {
      const userId = event?.event?.user_id
      if (!userId || !room) {
        return
      }
      forceUpdateLimit()

    }
    const throttled = throttle(_handle, 3000, { 'trailing': false });

    mx.on('event', throttled)
    return () => {
      throttled.cancel()
      mx.off('event', throttled)
    }
  }, [])
  useEffect(() => {
    asyncSearch.setup(memberList, {
      keys: ['name', 'username', 'userId'],
      limit: PER_PAGE_MEMBER,
    });
  }, [memberList]);

  useEffect(() => {
    let isLoadingMembers = false;
    const updateMemberList = () => {
      if (isLoadingMembers) return;
      setMemberList(
        simplyfiMembers(
          mx.getContacts()
            .sort(memberByAtoZ),
        ),
      );
    };
    searchRef.current.value = '';
    updateMemberList();
    isLoadingMembers = true;
    asyncSearch.on(asyncSearch.RESULT_SENT, handleSearchData);
    mx.on('Contact.change', updateMemberList);
    return () => {
      setMemberList([]);
      setSearchedMembers(null);
      setItemCount(PER_PAGE_MEMBER);
      asyncSearch.removeListener(asyncSearch.RESULT_SENT, handleSearchData);
      mx.removeListener('Contact.change', updateMemberList);
    };
  }, [randDomData]);


  const mList = searchedMembers !== null ? searchedMembers.data : memberList.slice(0, itemCount);
  return (
    <div className="room">
      <div className="room__content">
        <div className="room-view">
          <RoomViewHeader roomId={roomId} />
          <div className="room-view__content-wrapper">
            <div className="people-drawer__contacts">
              <form onSubmit={(e) => e.preventDefault()} className="people-search">
                <Input forwardRef={searchRef} type="text" onChange={handleSearch} placeholder="Search" required />
                <IconButton onClick={handleSearch} size="small" src={searchedMembers !== null ? CrossIC : SearchIC} />



              </form>
            </div>
            <div className="room-view__scrollable">
              <ScrollView autoHide>
                <div className="people-drawer__content">

                  {
                    mList.map((member) => (
                      <PeopleSelector
                        key={member.userId}
                        onClick={() => openProfileViewer(member.userId, roomId)}
                        avatarSrc={initMatrix.matrixClient.getUserAvatar(member.userId)}
                        name={member.name}
                        color={colorMXID(member.userId)}
                        peopleRole={member.peopleRole}
                      />
                    ))
                  }
                  {
                    (searchedMembers?.data.length === 0 || memberList.length === 0)
                    && (
                      <div className="people-drawer__noresult">
                        <Text variant="b2">No results found!</Text>
                      </div>
                    )
                  }
                  <div className="people-drawer__load-more">
                    {
                      mList.length !== 0
                      && memberList.length > itemCount
                      && searchedMembers === null
                      && (
                        <Button onClick={loadMorePeople}>View more</Button>
                      )
                    }
                  </div>
                </div>
              </ScrollView>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export default ContactPeopleDrawer;
