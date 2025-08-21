import { base64 } from '@scure/base';
import React, { useState } from 'react';
import { useParams } from '../../../hooks/stackRouterHooks';
import { useAuthHeaders } from '../../../hooks/useAuthHeaders';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import { CategoriesAndBoards } from './components/CategoriesAndBoards';
import { UserManagement } from './components/UserManagement';
import { useAdminData, useUserManagement } from './hooks';

export const AdminPanelPage: React.FC = () => {
  const params = useParams<{ '*'?: string }>();
  const encodedServerUrl = params['*'];
  const serverUrl = encodedServerUrl
    ? decodeURIComponent(encodedServerUrl)
    : undefined;

  const {
    isAdmin,
    loading: adminLoading,
    error: adminError,
  } = useIsAdmin(serverUrl || '');
  const {
    fetchHeaders,
    loading: headersLoading,
    error: headersError,
  } = useAuthHeaders(serverUrl);

  const {
    categories,
    setCategories,
    loadingData,
    dataError,
    setDataError,
    hasLoadedSuccessfully,
    fetchAdminData,
  } = useAdminData(serverUrl, isAdmin);

  const { users, bannedUsers, loadingUsers, usersError, fetchUsers } =
    useUserManagement(serverUrl, isAdmin);

  // User management state
  const [banningUserId, setBanningUserId] = useState<string | null>(null);
  const [unbanningUserId, setUnbanningUserId] = useState<string | null>(null);
  const [banError, setBanError] = useState<string | null>(null);

  const overallLoading =
    adminLoading ||
    loadingData ||
    headersLoading ||
    loadingUsers ||
    !!banningUserId ||
    !!unbanningUserId;
  const overallError =
    adminError || dataError || headersError || usersError || banError;

  const handleBanUser = async (publicKey: Uint8Array, reason: string) => {
    if (!serverUrl) return;

    setBanningUserId(base64.encode(publicKey));
    setBanError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;
      const banUrl = `${baseUrl}/forum/users/ban`;

      const response = await fetch(banUrl, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          public_key: Array.from(publicKey),
          reason: reason.trim() || undefined,
        }),
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = 'Failed to ban user';
        try {
          errorText = await response.text();
        } catch (_) {}
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      await fetchUsers();
    } catch (error: unknown) {
      console.error('Error banning user:', error);
      setBanError(
        error instanceof Error ? error.message : 'Failed to ban user',
      );
    } finally {
      setBanningUserId(null);
    }
  };

  const handleUnbanUser = async (publicKey: Uint8Array) => {
    if (!serverUrl) return;

    const publicKeyB64 = base64.encode(publicKey);
    setUnbanningUserId(publicKeyB64);
    setBanError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers.');
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;
      const unbanUrl = `${baseUrl}/forum/users/unban/${publicKeyB64}`;

      const response = await fetch(unbanUrl, {
        method: 'DELETE',
        headers: { ...authHeaders },
        credentials: 'include',
      });

      if (!response.ok) {
        let errorText = 'Failed to unban user';
        try {
          errorText = await response.text();
        } catch (_) {}
        throw new Error(`Error ${response.status}: ${errorText}`);
      }

      await fetchUsers();
    } catch (error: unknown) {
      console.error('Error unbanning user:', error);
      setBanError(
        error instanceof Error ? error.message : 'Failed to unban user',
      );
    } finally {
      setUnbanningUserId(null);
    }
  };

  let content;
  if (hasLoadedSuccessfully) {
    content = (
      <div className="space-y-6">
        <CategoriesAndBoards
          categories={categories}
          setCategories={setCategories}
          serverUrl={serverUrl || ''}
          fetchHeaders={fetchHeaders}
          fetchAdminData={fetchAdminData}
          setDataError={setDataError}
        />

        <UserManagement
          users={users}
          bannedUsers={bannedUsers}
          loadingUsers={loadingUsers}
          usersError={usersError}
          onBanUser={handleBanUser}
          onUnbanUser={handleUnbanUser}
          banningUserId={banningUserId}
          unbanningUserId={unbanningUserId}
          banError={banError}
        />
      </div>
    );
  }

  if (overallLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-2 text-gray-600 break-words">
            Loading admin panel...
          </p>
        </div>
      </div>
    );
  }

  if (overallError) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center max-w-md">
          <div className="text-red-600 text-lg font-medium mb-2">Error</div>
          <p className="text-gray-600 break-words">{overallError}</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center max-w-md">
          <div className="text-gray-600 text-lg font-medium mb-2">
            Access Denied
          </div>
          <p className="text-gray-500 break-words">
            You don&apos;t have admin privileges for this forum server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-y-auto max-h-screen pb-8">{content}</div>
  );
};
