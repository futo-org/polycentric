import { Models } from '@polycentric/polycentric-core';
import { base64 } from '@scure/base';
import Long from 'long';
import { Ban, UserCheck, Users, UserX } from 'lucide-react';
import { useState } from 'react';
import { ProfilePicture } from '../../../../components/profile/ProfilePicture';
import { useAvatar } from '../../../../hooks/imageHooks';
import { useUsernameCRDTQuery } from '../../../../hooks/queryHooks';
import { BannedUser, ForumUser } from '../types';
import { BanUserModal } from './Modals';

interface BannedUserItemProps {
  bannedUser: BannedUser;
  onUnbanUser?: (publicKey: Uint8Array) => Promise<void>;
  unbanningUserId?: string | null;
}

const BannedUserItem: React.FC<BannedUserItemProps> = ({
  bannedUser,
  onUnbanUser,
  unbanningUserId,
}) => {
  const publicKeyObj = Models.PublicKey.fromProto({
    key: bannedUser.public_key,
    keyType: Long.UONE,
  });
  const avatarUrl = useAvatar(publicKeyObj);
  const username = useUsernameCRDTQuery(publicKeyObj);
  const shortKey = Models.PublicKey.toString(publicKeyObj).slice(0, 10);

  return (
    <div
      key={bannedUser.id}
      className="p-4 border rounded shadow-sm bg-red-50 border-red-200"
    >
      <div className="flex justify-between items-start">
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <ProfilePicture
            src={avatarUrl}
            alt={username || shortKey}
            className="h-10 w-10 rounded-full border"
          />
          <div className="min-w-0">
            <div className="font-medium text-gray-900 break-words">
              {username || shortKey}
            </div>
            <div className="text-xs text-gray-500 font-mono break-words">
              {shortKey}
            </div>
            {bannedUser.reason && (
              <div className="text-sm text-gray-600 mb-2 break-words">
                Reason: {bannedUser.reason}
              </div>
            )}
            <div className="text-xs text-gray-500 break-words">
              Banned on: {new Date(bannedUser.created_at).toLocaleString()}
            </div>
          </div>
        </div>
        {onUnbanUser && (
          <button
            onClick={() => onUnbanUser(bannedUser.public_key)}
            disabled={!!unbanningUserId}
            className="ml-4 px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            <UserCheck className="w-4 h-4 mr-1" />
            {unbanningUserId === base64.encode(bannedUser.public_key)
              ? 'Unbanning...'
              : 'Unban'}
          </button>
        )}
      </div>
    </div>
  );
};

interface UserItemProps {
  user: ForumUser;
  bannedUsers?: BannedUser[];
  onShowBanModal: (publicKey: Uint8Array) => void;
  banningUserId?: string | null;
}

const UserItem: React.FC<UserItemProps> = ({
  user,
  bannedUsers,
  onShowBanModal,
  banningUserId,
}) => {
  const publicKeyObj = Models.PublicKey.fromProto({
    key: user.public_key,
    keyType: Long.UONE,
  });
  const avatarUrl = useAvatar(publicKeyObj);
  const username = useUsernameCRDTQuery(publicKeyObj);
  const shortKey = Models.PublicKey.toString(publicKeyObj).slice(0, 10);
  const isBanned = (bannedUsers ?? []).some((banned) => {
    // Compare Uint8Arrays directly
    if (banned.public_key.length !== user.public_key.length) {
      return false;
    }
    return banned.public_key.every(
      (byte, index) => byte === user.public_key[index],
    );
  });

  return (
    <div
      key={base64.encode(user.public_key)}
      className={`p-4 border rounded shadow-sm ${
        isBanned ? 'bg-red-50 border-red-200' : 'bg-white'
      }`}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <ProfilePicture
            src={avatarUrl}
            alt={username || shortKey}
            className="h-10 w-10 rounded-full border"
          />
          <div className="min-w-0">
            <div className="font-medium text-gray-900 break-words">
              {username || shortKey}
            </div>
            <div className="text-xs text-gray-500 font-mono break-words">
              {shortKey}
            </div>
            <div className="text-sm text-gray-600 mb-2 break-words">
              Posts: {user.total_posts} | Threads: {user.total_threads}
            </div>
            <div className="text-xs text-gray-500 break-words">
              First post:{' '}
              {user.first_post_at
                ? new Date(user.first_post_at).toLocaleDateString()
                : '?'}{' '}
              | Last post:{' '}
              {user.last_post_at
                ? new Date(user.last_post_at).toLocaleDateString()
                : '?'}
            </div>
          </div>
        </div>
        {!isBanned && (
          <button
            onClick={() => onShowBanModal(user.public_key)}
            disabled={!!banningUserId}
            className="ml-4 px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            <UserX className="w-4 h-4 mr-1" />
            Ban
          </button>
        )}
        {isBanned && (
          <span className="ml-4 px-3 py-1 text-sm bg-red-100 text-red-800 rounded flex items-center">
            <Ban className="w-4 h-4 mr-1" />
            Banned
          </span>
        )}
      </div>
    </div>
  );
};

interface UserManagementProps {
  users: ForumUser[];
  bannedUsers?: BannedUser[];
  loadingUsers: boolean;
  usersError: string | null;
  onBanUser?: (publicKey: Uint8Array, reason: string) => Promise<void>;
  onUnbanUser?: (publicKey: Uint8Array) => Promise<void>;
  banningUserId?: string | null;
  unbanningUserId?: string | null;
  banError?: string | null;
}

export function UserManagement({
  users,
  bannedUsers,
  loadingUsers,
  usersError,
  onBanUser,
  onUnbanUser,
  banningUserId,
  unbanningUserId,
  banError,
}: UserManagementProps) {
  const [showBanModal, setShowBanModal] = useState(false);
  const [banReason, setBanReason] = useState('');
  const [userToBan, setUserToBan] = useState<Uint8Array | null>(null);

  const handleShowBanModal = (publicKey: Uint8Array) => {
    setUserToBan(publicKey);
    setShowBanModal(true);
    setBanReason('');
  };

  const handleBanUser = async () => {
    if (userToBan && onBanUser) {
      await onBanUser(userToBan, banReason);
      setShowBanModal(false);
      setBanReason('');
      setUserToBan(null);
    }
  };

  const handleCloseBanModal = () => {
    setShowBanModal(false);
    setBanReason('');
    setUserToBan(null);
  };

  if (loadingUsers) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-2 text-gray-600 break-words">Loading users...</p>
        </div>
      </div>
    );
  }

  if (usersError) {
    return (
      <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded break-words">
        Error: {usersError}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold mb-6 flex items-center">
        <Users className="w-6 h-6 mr-2" />
        User Management
      </h2>

      {banError && (
        <div className="p-3 bg-red-100 border border-red-400 text-red-700 rounded mb-4 break-words">
          Error: {banError}
        </div>
      )}

      {/* Banned Users Section */}
      {bannedUsers && (
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-4 flex items-center">
            <Ban className="w-5 h-5 mr-2 text-red-600" />
            Banned Users ({(bannedUsers ?? []).length})
          </h3>
          {(bannedUsers ?? []).length === 0 ? (
            <p className="text-gray-500 break-words">No users are currently banned.</p>
          ) : (
            <div className="space-y-3">
              {(bannedUsers ?? []).map((bannedUser) => (
                <BannedUserItem
                  key={bannedUser.id}
                  bannedUser={bannedUser}
                  onUnbanUser={onUnbanUser}
                  unbanningUserId={unbanningUserId}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* All Users Section */}
      <div>
        <h3 className="text-lg font-medium mb-4 flex items-center">
          <Users className="w-5 h-5 mr-2" />
          All Users ({users.length})
        </h3>
        {users.length === 0 ? (
          <p className="text-gray-500 break-words">No users found.</p>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <UserItem
                key={base64.encode(user.public_key)}
                user={user}
                bannedUsers={bannedUsers}
                onShowBanModal={handleShowBanModal}
                banningUserId={banningUserId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Ban User Modal */}
      {onBanUser && (
        <BanUserModal
          isOpen={showBanModal}
          onClose={handleCloseBanModal}
          onBan={handleBanUser}
          banReason={banReason}
          setBanReason={setBanReason}
          isBanning={!!banningUserId}
        />
      )}
    </div>
  );
}
