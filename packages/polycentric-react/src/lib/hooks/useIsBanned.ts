import { base64 } from '@scure/base';
import { useEffect, useMemo, useState } from 'react';
import { useProcessHandleManager } from './processHandleManagerHooks';
import { useAuthHeaders } from './useAuthHeaders';

interface UseIsBannedResult {
  isBanned: boolean | undefined;
  loading: boolean;
  error: string | null;
  banReason?: string;
  bannedAt?: string;
}

const banStatusCache = new Map<
  string,
  { isBanned: boolean; reason?: string; bannedAt?: string }
>();

let banCheckInProgress = false;

/**
 * Hook to check if the current logged-in user is banned from a specific forum server.
 * @param serverUrl The base URL of the forum server to check against.
 * @returns An object containing the ban status, loading state, and any error.
 */
export function useIsBanned(serverUrl: string): UseIsBannedResult {
  const { processHandle } = useProcessHandleManager();
  const [isBanned, setIsBanned] = useState<boolean | undefined>(undefined);
  const [banReason, setBanReason] = useState<string | undefined>(undefined);
  const [bannedAt, setBannedAt] = useState<string | undefined>(undefined);
  const {
    headers: authHeaders,
    loading: headersLoading,
    error: headersError,
    fetchHeaders,
  } = useAuthHeaders(serverUrl);
  const [checkingBan, setCheckingBan] = useState<boolean>(false);
  const loading = headersLoading || checkingBan;
  const [banCheckError, setBanCheckError] = useState<string | null>(null);
  const error = headersError || banCheckError;

  const userPublicKeyString = useMemo(() => {
    if (!processHandle) return undefined;
    try {
      const pubKey = processHandle.system().key;
      return base64.encode(pubKey);
    } catch (e) {
      console.error('Error getting public key for ban check:', e);
      return undefined;
    }
  }, [processHandle]);

  const cacheKey = useMemo(() => {
    if (!serverUrl || !userPublicKeyString) return undefined;
    return `${serverUrl}|${userPublicKeyString}`;
  }, [serverUrl, userPublicKeyString]);

  useEffect(() => {
    if (!processHandle || !userPublicKeyString || !serverUrl || !cacheKey) {
      setIsBanned(undefined);
      setBanReason(undefined);
      setBannedAt(undefined);
      setBanCheckError(null);
      return;
    }

    if (banStatusCache.has(cacheKey)) {
      const cached = banStatusCache.get(cacheKey)!;
      setIsBanned(cached.isBanned);
      setBanReason(cached.reason);
      setBannedAt(cached.bannedAt);
      return;
    }

    const checkBanStatus = async () => {
      if (banCheckInProgress) {
        // Another ban check is already in progress, skipping
        return;
      }

      banCheckInProgress = true;

      try {
        const currentAuthHeaders = await fetchHeaders();

        if (!currentAuthHeaders) {
          setCheckingBan(false);
          setIsBanned(false);
          return;
        }

        setCheckingBan(true);
        setBanCheckError(null);
        setIsBanned(undefined);
        setBanReason(undefined);
        setBannedAt(undefined);

        try {
          const baseUrl = serverUrl.endsWith('/')
            ? serverUrl.slice(0, -1)
            : serverUrl;
          const checkBanUrl = `${baseUrl}/forum/users/check-ban`;

          const checkResRaw = await fetch(checkBanUrl, {
            headers: { ...currentAuthHeaders },
            credentials: 'include',
          });

          if (checkResRaw.status === 403) {
            // User is banned
            const banData = await checkResRaw.json();
            const banInfo = {
              isBanned: true,
              reason: banData.reason,
              bannedAt: banData.banned_at,
            };
            banStatusCache.set(cacheKey, banInfo);
            setIsBanned(true);
            setBanReason(banData.reason);
            setBannedAt(banData.banned_at);
          } else if (checkResRaw.ok) {
            // User is not banned
            const banInfo = { isBanned: false };
            banStatusCache.set(cacheKey, banInfo);
            setIsBanned(false);
            setBanReason(undefined);
            setBannedAt(undefined);
          } else {
            // Unexpected response
            console.error(
              '[useIsBanned] Unexpected response status:',
              checkResRaw.status,
            );
            setBanCheckError(
              `Unexpected response from server: ${checkResRaw.status}`,
            );
          }
        } catch (fetchError) {
          console.error(
            `Error checking ban status for ${serverUrl}:`,
            fetchError,
          );
          setBanCheckError(
            (fetchError as Error)?.message ||
              `Failed to check ban status for ${serverUrl}.`,
          );
          setIsBanned(false);
        } finally {
          setCheckingBan(false);
        }
      } finally {
        banCheckInProgress = false;
      }
    };

    if (!banStatusCache.has(cacheKey)) {
      checkBanStatus();
    }
  }, [
    processHandle,
    userPublicKeyString,
    serverUrl,
    cacheKey,
    fetchHeaders,
    authHeaders,
  ]);

  return { isBanned, loading, error, banReason, bannedAt };
}
