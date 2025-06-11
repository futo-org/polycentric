import * as Core from '@polycentric/polycentric-core';
import Long from 'long';
import { useEffect, useState } from 'react';
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks';

interface APIError extends Error {
  response?: {
    extendedMessage?: string;
    message?: string;
  };
}

export function OAuthCallback() {
  const [username, setUsername] = useState<string | null>(null);
  const [permanentToken, setPermanentToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { processHandle } = useProcessHandleManager();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const processOAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const stateParam = params.get('state');
      const verifier = decodeURIComponent(params.get('verifier') || '');

      if (!stateParam) {
        setError('Missing state parameter');
        return;
      }

      try {
        const state = JSON.parse(decodeURIComponent(stateParam));
        const encodedData = state.data;

        if (
          !encodedData ||
          !state.claimType ||
          !verifier ||
          !processHandle
        ) {
          setError(`Missing required OAuth parameters`);
          return;
        }

        try {
          const claimTypeNum = parseInt(state.claimType);
          const claimTypeLong = new Long(
            claimTypeNum,
            0,
            true,
          ) as Core.Models.ClaimType.ClaimType;

          const tokenQueryString = encodedData;

          try {
            const oauthResponse = await Core.APIMethods.getOAuthUsername(
              verifier,
              tokenQueryString,
              claimTypeLong,
            );

            setUsername(oauthResponse.username);
            setPermanentToken(oauthResponse.token);
          } catch (error: unknown) {
            const apiError = error as APIError;

            if (
              apiError?.response?.extendedMessage?.includes(
                'temporarily unavailable',
              )
            ) {
              setError(
                'OAuth service is temporarily unavailable. Please try again later.',
              );
            } else if (apiError?.response?.message) {
              setError(apiError.response.message);
            } else if (apiError?.message) {
              setError(apiError.message);
            } else {
              setError('Failed to verify OAuth credentials');
            }
          }
        } catch (error) {
          setError('Failed to process OAuth response');
          console.error('Error processing OAuth response:', error);
        }
      } catch (error) {
        setError('Failed to process state');
        console.error('Error processing state parameter:', error);
      }
    };

    processOAuth();
  }, [processHandle]);

  const handleConfirm = async () => {
    if (!username || !permanentToken || !processHandle) {
      setError('Missing necessary information to complete verification.');
      console.error('handleConfirm missing data:', {
        username,
        permanentToken,
        processHandle,
      });
      return;
    }

    try {
      setIsSubmitting(true);

      const params = new URLSearchParams(window.location.search);
      const stateParam = params.get('state');

      if (!stateParam) {
        setError('Missing state parameter');
        setIsSubmitting(false);
        return;
      }

      const state = JSON.parse(decodeURIComponent(stateParam));
      const claimTypeNum = parseInt(state.claimType);
      if (!claimTypeNum) {
        setError('Missing claim type in state');
        setIsSubmitting(false);
        return;
      }

      let claim: Core.Protocol.Claim;
      let claimType: Core.Models.ClaimType.ClaimType;

      switch (claimTypeNum) {
        case Core.Models.ClaimType.ClaimTypeTwitter.toNumber():
          claim = Core.Models.claimTwitter(username);
          claimType = Core.Models.ClaimType.ClaimTypeTwitter;
          break;
        case Core.Models.ClaimType.ClaimTypeDiscord.toNumber():
          claim = Core.Models.claimDiscord(username);
          claimType = Core.Models.ClaimType.ClaimTypeDiscord;
          break;
        case Core.Models.ClaimType.ClaimTypeInstagram.toNumber():
          claim = Core.Models.claimInstagram(username);
          claimType = Core.Models.ClaimType.ClaimTypeInstagram;
          break;
        case Core.Models.ClaimType.ClaimTypePatreon.toNumber():
          claim = Core.Models.claimPatreon(username);
          claimType = Core.Models.ClaimType.ClaimTypePatreon;
          break;
        default:
          throw new Error(`Unsupported claim type: ${claimTypeNum}`);
      }

      const pointer = await processHandle.claim(claim);

      const propagationDelayMs = 3000;

      await new Promise((resolve) => setTimeout(resolve, propagationDelayMs));

      const systemState = await processHandle.loadSystemState(
        processHandle.system(),
      );

      await Core.APIMethods.requestVerification(
        systemState.verifiers()[0],
        pointer,
        claimType,
        permanentToken,
      );

      window.location.href = '/';
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error during handleConfirm:', error);
      setError(
        `Failed to complete verification: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      setIsSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-4">
        <div className="text-red-500">{error}</div>
        <button
          onClick={() => (window.location.href = '/')}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
        >
          Return to Profile
        </button>
      </div>
    );
  }

  if (!username || !permanentToken) {
    return <div>Loading...</div>;
  }

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <h2 className="text-xl mb-4">
        Is this the account you would like to verify?
      </h2>
      <div className="text-lg mb-6">{username}</div>
      <div className="flex gap-4">
        <button
          onClick={() => (window.location.href = '/')}
          className="px-4 py-2 bg-gray-500 text-white rounded"
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 bg-blue-500 text-white rounded"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Processing...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
