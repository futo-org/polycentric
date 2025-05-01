import { base64 } from '@scure/base';
import { useEffect, useMemo, useState } from 'react';
import { useProcessHandleManager } from './processHandleManagerHooks';
import { useAuthHeaders } from './useAuthHeaders';

interface UseIsAdminResult {
  isAdmin: boolean | undefined; // undefined while loading/logged out, true/false otherwise
  loading: boolean;
  error: string | null;
}

// Simple cache for admin status to avoid checks on every render
// Keyed by composite string: `${serverUrl}|${userPublicKeyString}`
const adminStatusCache = new Map<string, boolean>();

/**
 * Hook to check if the current logged-in user is an admin for a specific forum server.
 * @param serverUrl The base URL of the forum server to check against.
 * @returns An object containing the admin status, loading state, and any error.
 */
export function useIsAdmin(serverUrl: string): UseIsAdminResult {
  const { processHandle } = useProcessHandleManager();
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const {
    headers: authHeaders,
    loading: headersLoading,
    error: headersError,
    fetchHeaders,
  } = useAuthHeaders(serverUrl);
  const [checkingAdmin, setCheckingAdmin] = useState<boolean>(false);
  const loading = headersLoading || checkingAdmin;
  const [adminCheckError, setAdminCheckError] = useState<string | null>(null);
  const error = headersError || adminCheckError;

  // Get the current user's public key string if available
  const userPublicKeyString = useMemo(() => {
    if (!processHandle) return undefined;
    try {
      const pubKey = processHandle.system().key;
      return base64.encode(pubKey);
    } catch (e) {
      console.error('Error getting public key for admin check:', e);
      return undefined;
    }
  }, [processHandle]);

  const cacheKey = useMemo(() => {
    if (!serverUrl || !userPublicKeyString) return undefined;
    return `${serverUrl}|${userPublicKeyString}`;
  }, [serverUrl, userPublicKeyString]);

  useEffect(() => {
    if (!processHandle || !userPublicKeyString || !serverUrl || !cacheKey) {
      setIsAdmin(undefined);
      setAdminCheckError(null);
      return;
    }

    if (adminStatusCache.has(cacheKey)) {
      setIsAdmin(adminStatusCache.get(cacheKey)!);
      return;
    }

    const checkAdminStatus = async () => {
      const currentAuthHeaders = await fetchHeaders();
      if (!currentAuthHeaders) {
        setCheckingAdmin(false);
        setIsAdmin(false);
        return;
      }

      setCheckingAdmin(true);
      setAdminCheckError(null);
      setIsAdmin(undefined);

      try {
        const baseUrl = serverUrl.endsWith('/')
          ? serverUrl.slice(0, -1)
          : serverUrl;
        const checkAdminUrl = `${baseUrl}/auth/check-admin`;

        const checkResRaw = await fetch(checkAdminUrl, {
          headers: { ...currentAuthHeaders },
          credentials: 'include',
        });

        if (!checkResRaw.ok) {
          if (checkResRaw.status === 401 || checkResRaw.status === 403) {
            adminStatusCache.set(cacheKey, false);
            setIsAdmin(false);
          } else {
            let errorText = '';
            try {
              errorText = await checkResRaw.text();
            } catch (_) {
              /* Ignore */
            }
            throw new Error(
              `Admin check failed (@ ${serverUrl}): ${checkResRaw.status} ${checkResRaw.statusText}. Response: ${errorText}`,
            );
          }
        } else {
          const checkResText = await checkResRaw.text();
          let checkData: { isAdmin: boolean };
          try {
            checkData = JSON.parse(checkResText);
            if (typeof checkData?.isAdmin !== 'boolean') {
              throw new Error('Invalid isAdmin field in response');
            }
            adminStatusCache.set(cacheKey, checkData.isAdmin);
            setIsAdmin(checkData.isAdmin);
          } catch (jsonError) {
            console.error(
              `Error parsing JSON for admin check from ${serverUrl}:`,
              jsonError,
            );
            console.error(
              `Raw admin check response text from ${serverUrl}:`,
              checkResText,
            );
            throw new Error(
              `Invalid JSON admin check response received from ${serverUrl}`,
            );
          }
        }
      } catch (fetchError: any) {
        console.error(
          `Error checking admin status for ${serverUrl}:`,
          fetchError,
        );
        setAdminCheckError(
          fetchError.message ||
            `Failed to check admin status for ${serverUrl}.`,
        );
        setIsAdmin(false);
      } finally {
        setCheckingAdmin(false);
      }
    };

    if (!adminStatusCache.has(cacheKey)) {
      checkAdminStatus();
    }
  }, [processHandle, userPublicKeyString, serverUrl, cacheKey, fetchHeaders]);

  return { isAdmin, loading, error };
}
