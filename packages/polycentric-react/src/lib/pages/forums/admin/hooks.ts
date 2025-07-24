import { useCallback, useEffect, useState } from 'react';
import { useAuthHeaders } from '../../../hooks/useAuthHeaders';
import { BannedUser, Board, Category, ForumUser } from './types';

export const useAdminData = (
  serverUrl: string | undefined,
  isAdmin: boolean | undefined,
) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [hasLoadedSuccessfully, setHasLoadedSuccessfully] = useState(false);

  const { fetchHeaders } = useAuthHeaders(serverUrl);

  const fetchAdminData = useCallback(async () => {
    if (!serverUrl || !isAdmin) {
      setCategories([]);
      setLoadingData(false);
      setHasLoadedSuccessfully(false);
      return;
    }

    setLoadingData(true);
    setDataError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        console.error('[AdminPanelPage Fetch] Failed to get auth headers.');
        throw new Error(
          'Could not get authentication headers to fetch admin data.',
        );
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;

      const catApiUrl = `${baseUrl}/forum/categories`;
      const catResponse = await fetch(catApiUrl, {
        headers: { ...authHeaders },
        credentials: 'include',
      });
      if (!catResponse.ok) {
        throw new Error(
          `Failed to fetch categories: ${catResponse.status} ${catResponse.statusText}`,
        );
      }
      const fetchedCategories: Omit<Category, 'boards'>[] =
        await catResponse.json();

      const categoriesWithBoards: Category[] = await Promise.all(
        fetchedCategories.map(async (category) => {
          const boardApiUrl = `${baseUrl}/forum/categories/${category.id}/boards`;
          try {
            const boardResponse = await fetch(boardApiUrl, {
              headers: { ...authHeaders },
              credentials: 'include',
            });
            if (!boardResponse.ok) {
              console.error(
                `Failed to fetch boards for category ${category.id}: ${boardResponse.status} ${boardResponse.statusText}`,
              );
              return { ...category, boards: [] };
            }
            const boards: Board[] = await boardResponse.json();
            const boardsWithCatId = boards.map((b) => ({
              ...b,
              category_id: category.id,
            }));
            return { ...category, boards: boardsWithCatId };
          } catch (boardError) {
            console.error(
              `[AdminPanelPage Fetch]   Error fetching boards for category ${category.id}:`,
              boardError,
            );
            return { ...category, boards: [] };
          }
        }),
      );
      categoriesWithBoards.sort((a, b) => a.order - b.order);
      categoriesWithBoards.forEach((cat) =>
        cat.boards.sort((a, b) => a.order - b.order),
      );

      setCategories(categoriesWithBoards);
      setHasLoadedSuccessfully(true);
    } catch (error: unknown) {
      console.error(
        '[AdminPanelPage Fetch] ERROR caught in fetchAdminData:',
        error,
      );
      setDataError(
        error instanceof Error ? error.message : 'Failed to load admin data',
      );
      setCategories([]);
      setHasLoadedSuccessfully(false);
    } finally {
      setLoadingData(false);
    }
  }, [serverUrl, isAdmin, fetchHeaders]);

  useEffect(() => {
    if (serverUrl && isAdmin === true) {
      fetchAdminData();
    } else {
      setCategories([]);
      setHasLoadedSuccessfully(false);
    }
  }, [serverUrl, isAdmin, fetchAdminData]);

  return {
    categories,
    setCategories,
    loadingData,
    dataError,
    setDataError,
    hasLoadedSuccessfully,
    fetchAdminData,
  };
};

export const useUserManagement = (
  serverUrl: string | undefined,
  isAdmin: boolean | undefined,
) => {
  const [users, setUsers] = useState<ForumUser[]>([]);
  const [bannedUsers, setBannedUsers] = useState<BannedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const { fetchHeaders } = useAuthHeaders(serverUrl);

  const fetchUsers = useCallback(async () => {
    if (!serverUrl || !isAdmin) {
      setUsers([]);
      setBannedUsers([]);
      setLoadingUsers(false);
      return;
    }

    setLoadingUsers(true);
    setUsersError(null);

    try {
      const authHeaders = await fetchHeaders();
      if (!authHeaders) {
        throw new Error('Could not get authentication headers to fetch users.');
      }

      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;

      const usersUrl = `${baseUrl}/forum/users`;
      const usersResponse = await fetch(usersUrl, {
        headers: { ...authHeaders },
        credentials: 'include',
      });
      if (!usersResponse.ok) {
        throw new Error(
          `Failed to fetch users: ${usersResponse.status} ${usersResponse.statusText}`,
        );
      }
      const fetchedUsers: ForumUser[] = await usersResponse.json();

      const processedUsers: ForumUser[] = fetchedUsers.map((user) => ({
        ...user,
        public_key: new Uint8Array(user.public_key),
      }));

      const bannedUsersUrl = `${baseUrl}/forum/users/banned`;
      const freshAuthHeaders = await fetchHeaders();
      const bannedUsersResponse = await fetch(bannedUsersUrl, {
        headers: { ...freshAuthHeaders },
        credentials: 'include',
      });
      if (!bannedUsersResponse.ok) {
        throw new Error(
          `Failed to fetch banned users: ${bannedUsersResponse.status} ${bannedUsersResponse.statusText}`,
        );
      }
      const fetchedBannedUsers: BannedUser[] = await bannedUsersResponse.json();

      const processedBannedUsers: BannedUser[] = fetchedBannedUsers.map(
        (user) => ({
          ...user,
          public_key: new Uint8Array(user.public_key),
          banned_by: new Uint8Array(user.banned_by),
        }),
      );

      setUsers(processedUsers);
      setBannedUsers(processedBannedUsers);
    } catch (error: unknown) {
      console.error('[AdminPanelPage] ERROR caught in fetchUsers:', error);
      setUsersError(
        error instanceof Error ? error.message : 'Failed to load users',
      );
      setUsers([]);
      setBannedUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [serverUrl, isAdmin, fetchHeaders]);

  useEffect(() => {
    if (serverUrl && isAdmin === true) {
      fetchUsers();
    } else {
      setUsers([]);
      setBannedUsers([]);
    }
  }, [serverUrl, isAdmin, fetchUsers]);

  return {
    users,
    bannedUsers,
    loadingUsers,
    usersError,
    fetchUsers,
  };
};
