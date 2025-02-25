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
  const [error, setError] = useState<string | null>(null);
  const { processHandle } = useProcessHandleManager();

  useEffect(() => {
    const processOAuth = async () => {
      const futoIDSecret = localStorage.getItem('futoIDSecret');

      const params = new URLSearchParams(window.location.search);
      const stateParam = params.get('state');

      if (!stateParam) {
        setError('Missing state parameter');
        return;
      }

      try {
        const state = JSON.parse(decodeURIComponent(stateParam));
        const encodedData = state.data;

        if (!encodedData || !state.claimType || !processHandle) {
          setError('Missing required OAuth parameters');
          return;
        }

        try {
          const claimTypeNum = parseInt(state.claimType);
          const claimTypeLong = new Long(
            claimTypeNum,
            0,
            true,
          ) as Core.Models.ClaimType.ClaimType;

          const decodedData = JSON.parse(atob(encodedData));
          decodedData.harborSecret = futoIDSecret;
          const newEncodedData = btoa(JSON.stringify(decodedData));

          const tokenQueryString = newEncodedData;

          try {
            const oauthResponse = await Core.APIMethods.getOAuthUsername(
              Core.APIMethods.VERIFIER_SERVER,
              tokenQueryString,
              claimTypeLong,
            );

            setUsername(oauthResponse.username);

            localStorage.removeItem('oauth_debug_url');
            localStorage.removeItem('oauth_debug_secret');
            localStorage.removeItem('futoIDSecret');
          } catch (error: unknown) {
            const apiError = error as APIError;
            console.error('OAuth API error:', apiError);

            if (
              apiError?.response?.extendedMessage?.includes(
                'temporarily unavailable',
              )
            ) {
              setError(
                "Twitter's OAuth service is temporarily unavailable. Please try again later.",
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
          console.error('OAuth verification failed:', error);
          setError('Failed to process OAuth response');
        }
      } catch (error) {
        console.error('Failed to process state:', error);
        setError('Failed to process state');
      }
    };

    processOAuth();
  }, [processHandle]);

  const handleConfirm = async () => {
    if (!username || !processHandle) return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const parsedClaimType = params.get('claim_type');

    if (!token || !parsedClaimType) return;

    try {
      const claimTypeNum = parseInt(parsedClaimType);

      let claim: Core.Protocol.Claim;
      let claimType: Core.Models.ClaimType.ClaimType;
      switch (claimTypeNum) {
        case Core.Models.ClaimType.ClaimTypeTwitter.toNumber():
          claim = Core.Models.claimTwitter(username);
          claimType = Core.Models.ClaimType.ClaimTypeTwitter;
          break;
        case Core.Models.ClaimType.ClaimTypeGitHub.toNumber():
          claim = Core.Models.claimGitHub(username);
          claimType = Core.Models.ClaimType.ClaimTypeGitHub;
          break;
        case Core.Models.ClaimType.ClaimTypeDiscord.toNumber():
          claim = Core.Models.claimDiscord(username);
          claimType = Core.Models.ClaimType.ClaimTypeDiscord;
          break;
        case Core.Models.ClaimType.ClaimTypePatreon.toNumber():
          claim = Core.Models.claimPatreon(username);
          claimType = Core.Models.ClaimType.ClaimTypePatreon;
          break;
        case Core.Models.ClaimType.ClaimTypeTwitch.toNumber():
          claim = Core.Models.claimTwitch(username);
          claimType = Core.Models.ClaimType.ClaimTypeTwitch;
          break;
        default:
          throw new Error(`Unsupported claim type: ${claimTypeNum}`);
      }

      const pointer = await processHandle.claim(claim);

      await Core.APIMethods.requestVerification(pointer, claimType, token);

      window.location.href = '/';
    } catch (error) {
      console.error('Failed to create claim:', error);
      setError('Failed to create claim');
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

  if (!username) {
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
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}
