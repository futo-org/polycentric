/**
 * @fileoverview Account switcher component for managing multiple accounts.
 */

import { Menu } from '@headlessui/react';
import { IonMenuToggle } from '@ionic/react';
import { MetaStore, Models } from '@polycentric/polycentric-core';
import { useState } from 'react';
import { useAvatar } from '../../../hooks/imageHooks';
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks';
import {
  useSystemLink,
  useTextPublicKey,
  useUsernameCRDTQuery,
} from '../../../hooks/queryHooks';
import { CircleExpandMenuReverse } from '../../util/circleexpandmenu';
import { Link } from '../../util/link';
import { ProfilePicture } from '../ProfilePicture';

// Expand/collapse arrow icon
const UpArrowIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-6 h-6"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75"
    />
  </svg>
);

// Individual account item with switch/signout actions
const AccountSwitcherItem = ({
  storeInfo,
  setSubMenuExpanded,
}: {
  storeInfo: MetaStore.StoreInfo;
  setSubMenuExpanded: (b: boolean) => void;
}) => {
  const system = storeInfo.system;

  const avatarURL = useAvatar(system);
  const username = useUsernameCRDTQuery(system);
  const displayKey = useTextPublicKey(system, 6);
  const { changeHandle, signOut } = useProcessHandleManager();

  return (
    <div className="flex justify-between w-full p-2">
      <div className="flex space-x-2 min-w-0 flex-grow overflow-hidden">
        <div className="h-[3rem] rounded-full w-auto aspect-square border overflow-clip flex-shrink-0">
          <img className="" src={avatarURL} />
        </div>
        <div className="flex flex-col min-w-0 overflow-hidden">
          <p className="bold text-normal truncate">{username}</p>
          <p className="font-light text-gray-400 truncate">{displayKey}</p>
        </div>
      </div>
      <CircleExpandMenuReverse
        menuItems={[
          {
            label: 'Switch To',
            action: () => changeHandle(storeInfo),
          },
          {
            label: 'Sign Out',
            action: () => signOut(storeInfo),
          },
        ]}
        title={username}
        onIsOpenChange={(isOpen) => setSubMenuExpanded(isOpen)}
      />
    </div>
  );
};

// Main account switcher with expandable account list and menu actions
export const AccountSwitcher = () => {
  const [expanded, setExpanded] = useState(false);
  const [subMenuExpanded, setSubMenuExpanded] = useState(false);

  const { stores, processHandle, signOut } = useProcessHandleManager();

  const username = useUsernameCRDTQuery(processHandle.system());
  const avatarURL = useAvatar(processHandle.system());
  const key = useTextPublicKey(processHandle.system(), 6);
  const systemLink = useSystemLink(processHandle.system());

  const notCurrentStores = stores.filter(
    (storeInfo) =>
      !Models.PublicKey.equal(storeInfo.system, processHandle.system()),
  );

  // Determine menu items based on account count
  const mainMenuItems = [
    {
      label: 'Add Account',
      routerLink: '/add-account',
    },
    {
      label: 'Settings',
      routerLink: '/settings',
    },
    {
      label: 'Sign Out',
      action: () =>
        signOut(
          stores.find((store) =>
            Models.PublicKey.equal(store.system, processHandle.system()),
          ),
        ),
    },
  ];

  return (
    <Menu as="div" className="relative">
      {/* Border radius is 2rem because inner circle is 3rem with .5rem (p-2) padding both sides, so diameter=4 r=2rem */}
      <div
        className={`rounded-[2rem] w-full flex flex-col border bottom-0 bg-white ${
          subMenuExpanded
            ? 'after:rounded-[2rem] after:absolute after:inset-0 after:block'
            : ''
        }`}
      >
        {expanded && notCurrentStores.length > 0 && (
          <>
            <Menu.Items static={true}>
              <div className="flex flex-col">
                {notCurrentStores.map((storeInfo) => (
                  <AccountSwitcherItem
                    key={Models.PublicKey.toString(storeInfo.system)}
                    storeInfo={storeInfo}
                    setSubMenuExpanded={setSubMenuExpanded}
                  />
                ))}
              </div>
            </Menu.Items>
            <div className="w-full border-b m-0"></div>
          </>
        )}
        <div
          className={`flex justify-between p-2 w-full ${
            expanded ? 'rounded-b-[2rem]' : 'rounded-[2rem]'
          }`}
        >
          <div className="flex flex-shrink space-x-2 min-w-0 overflow-hidden overflow-ellipsis">
            <IonMenuToggle className="contents">
              <Link routerLink={systemLink} routerDirection="root">
                <ProfilePicture src={avatarURL} className="h-[3rem] w-[3rem]" />
              </Link>
            </IonMenuToggle>
            <div className="flex flex-col flex-shrink min-w-0">
              <p className="bold text-normal overflow-hidden overflow-ellipsis">
                {username}
              </p>
              <p className="font-light text-gray-400 overflow-hidden overflow-ellipsis">
                {key}
              </p>
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            {notCurrentStores.length > 0 && (
              <button
                className={`h-[3rem] bg-gray-50 p-1 rounded-full w-auto aspect-square flex justify-center items-center ${
                  expanded ? ' -scale-y-100' : 'scale-y-100'
                }`}
                onClick={() => {
                  setExpanded(!expanded);
                }}
              >
                <UpArrowIcon />
              </button>
            )}
            <div className="min-w-[3rem] min-h-[3rem] flex flex-col justify-end items-end">
              <CircleExpandMenuReverse
                menuItems={mainMenuItems}
                title={username}
                onIsOpenChange={(isOpen) => setSubMenuExpanded(isOpen)}
              />
            </div>
          </div>
        </div>
      </div>
    </Menu>
  );
};
