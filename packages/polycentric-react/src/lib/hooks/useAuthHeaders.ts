import { sign } from '@noble/ed25519';
import { Models } from '@polycentric/polycentric-core';
import { base64 } from '@scure/base';
import { useCallback, useMemo, useState } from 'react';
import { useProcessHandleManager } from './processHandleManagerHooks';

export interface AuthHeaders {
  'X-Polycentric-Pubkey-Base64': string;
  'X-Polycentric-Signature-Base64': string;
  'X-Polycentric-Challenge-ID': string;
}

interface UseAuthHeadersResult {
  headers: AuthHeaders | null;
  loading: boolean;
  error: string | null;
  fetchHeaders: () => Promise<AuthHeaders | null>;
}

/**
 * Hook to prepare authentication headers for API requests to a specific forum server.
 * @param serverUrl The base URL of the forum server.
 * @returns An object containing the headers (or null), loading state, error state,
 *          and a function to manually trigger header fetching.
 */
export function useAuthHeaders(
  serverUrl: string | undefined,
): UseAuthHeadersResult {
  const { processHandle } = useProcessHandleManager();
  const [headers] = useState<AuthHeaders | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const userPublicKeyString = useMemo(() => {
    if (!processHandle) return undefined;
    try {
      const pubKey = processHandle.system().key;
      return base64.encode(pubKey);
    } catch (e) {
      console.error('Error getting public key for auth headers:', e);
      return undefined;
    }
  }, [processHandle]);

  const fetchHeaders = useCallback(async (): Promise<AuthHeaders | null> => {
    if (!processHandle || !userPublicKeyString || !serverUrl) {
      setError('User not logged in or server URL missing.');
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const baseUrl = serverUrl.endsWith('/')
        ? serverUrl.slice(0, -1)
        : serverUrl;

      const challengeUrl = `${baseUrl}/auth/challenge`;
      const challengeResRaw = await fetch(challengeUrl);
      if (!challengeResRaw.ok)
        throw new Error(
          `Auth header prep failed (challenge @ ${serverUrl}): ${challengeResRaw.status} ${challengeResRaw.statusText}`,
        );
      const challengeResText = await challengeResRaw.text();
      let challengeData: { challenge_id: string; nonce_base64: string };
      try {
        challengeData = JSON.parse(challengeResText);
        if (
          !challengeData ||
          typeof challengeData.challenge_id !== 'string' ||
          typeof challengeData.nonce_base64 !== 'string'
        ) {
          throw new Error('Incomplete challenge data received');
        }
      } catch (jsonError) {
        console.error(
          `Error parsing JSON for challenge from ${serverUrl}:`,
          jsonError,
        );
        console.error(
          `Raw challenge response text from ${serverUrl}:`,
          challengeResText,
        );
        throw new Error(
          `Invalid JSON challenge response received from ${serverUrl}`,
        );
      }
      const { challenge_id, nonce_base64 } = challengeData;
      const nonce = base64.decode(nonce_base64);

      const privateKey = processHandle.processSecret().system;
      if (!privateKey)
        throw new Error('Private key unavailable for signing challenge.');
      const signature = await sign(nonce, privateKey.key);

      const pubKey = await Models.PrivateKey.derivePublicKey(privateKey);
      const pubKeyBase64 = base64.encode(pubKey.key);
      const signatureBase64 = base64.encode(signature);

      const preparedHeaders: AuthHeaders = {
        'X-Polycentric-Pubkey-Base64': pubKeyBase64,
        'X-Polycentric-Signature-Base64': signatureBase64,
        'X-Polycentric-Challenge-ID': challenge_id,
      };

      setError(null);
      return preparedHeaders;
    } catch (fetchError: unknown) {
      console.error(
        `Error preparing auth headers for ${serverUrl}:`,
        fetchError,
      );
      setError(
        (fetchError as Error)?.message ||
          `Failed to prepare auth headers for ${serverUrl}.`,
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [processHandle, userPublicKeyString, serverUrl]);

  return { headers, loading, error, fetchHeaders };
}
