import { usePolycentric } from '@/src/common/lib/polycentric-hooks';
import { decodeBundle } from '@/src/common/lib/polycentric-hooks/helpers';
import type { PairingSession, v2 } from '@polycentric/react-native';
import { useEffect, useState } from 'react';

export type PairIdentityClaimerHookResult = {
  error: string | null;
  approved: boolean;
  claimInProgress: boolean;
};

/** `useEffect()` return type */
type StageResult = (() => void) | undefined;

type ErrorState = { message: string };
type JoiningState = { info: v2.PairingInfo };
type PollingState = JoiningState & { session: PairingSession };
type ClaimingState = PollingState;

type ClaimerState =
  | { stage: 'unstarted' }
  | ({ stage: 'error' } & ErrorState)
  | ({ stage: 'joining' } & JoiningState)
  | ({ stage: 'polling' } & PollingState)
  | ({ stage: 'claiming' } & ClaimingState)
  | { stage: 'done' };

export function usePairIdentityClaimer(
  info: v2.PairingInfo | null | undefined,
): PairIdentityClaimerHookResult {
  const client = usePolycentric();
  const [state, setState] = useState<ClaimerState>({ stage: 'unstarted' });

  useEffect(() => {
    const error = (message: string): void => {
      setState({ stage: 'error', message });
    };

    const onError = (e: unknown, fallback?: string): void => {
      if (e instanceof Error) {
        error(e.message);
      } else if (fallback) {
        error(fallback);
      } else {
        error('Pairing failed.');
      }
    };

    // ---  Define handlers for each stage ---
    const whenUnstarted = (): StageResult => {
      if (info) {
        setState({ stage: 'joining', info });
      } else if (info === null) {
        error('Invalid pairing code.');
      }

      return undefined;
    };

    const whenError = (): StageResult => {
      if (info === undefined) {
        setState({ stage: 'unstarted' });
      }

      return undefined;
    };

    const whenJoining = ({ info }: JoiningState): StageResult => {
      let canceled = false;

      const join = async () => {
        try {
          const session =
            await client.pairingSessionManager.getPairingSession(info);
          if (canceled) return;

          await client.pairingSessionManager.joinPairingSession(info);
          if (canceled) return;

          setState({ stage: 'polling', info, session });
        } catch (err) {
          if (canceled) return;
          onError(err, 'Failed to join pairing session.');
        }
      };

      join();
      return () => {
        canceled = true;
      };
    };

    const whenPolling = ({ info, session }: PollingState): StageResult => {
      let canceled = false;

      // Poll until we get a different marker and then try claiming
      const pollForRemoteChange = async () => {
        try {
          const isAuthorized =
            await client.pairingSessionManager.pollForAuthorization(info);

          if (canceled || !isAuthorized) return;

          setState({ stage: 'claiming', info, session });
        } catch (e) {
          // polling failed, will retry on next interval
          console.warn(`pairing session polling error: ${e}`);
        }
      };

      void pollForRemoteChange();
      const interval = setInterval(() => {
        void pollForRemoteChange();
      }, 2000);

      return () => {
        canceled = true;
        clearInterval(interval);
      };
    };

    const whenClaiming = ({ info, session }: ClaimingState): StageResult => {
      let canceled = false;

      void (async () => {
        try {
          const identityKey = session.digest.issuerIdentity;
          const claimServers = serversForClaim(session, info, client.servers);
          await client.identityManager.claim(identityKey, claimServers);
          if (canceled) return;

          setState({ stage: 'done' });
        } catch (err) {
          if (!canceled) {
            onError(err, 'Failed to claim identity');
          }
        }
      })();

      return () => {
        canceled = true;
      };
    };

    // Run the correct handler
    switch (state.stage) {
      case 'unstarted':
        return whenUnstarted();
      case 'error':
        return whenError();
      case 'joining':
        return whenJoining(state);
      case 'polling':
        return whenPolling(state);
      case 'claiming':
        return whenClaiming(state);
      case 'done':
        return;
    }
  }, [info, state, client]);

  // Derive return value
  return {
    error: state.stage === 'error' ? state.message : null,
    approved: state.stage === 'done',
    claimInProgress: state.stage === 'joining',
  };
}

/** Servers to query identity events from while claiming the paired identity. */
function serversForClaim(
  session: PairingSession,
  info: v2.PairingInfo,
  currentServers: string[],
): string[] {
  const bundle = session.issuerState.identityState;
  if (!bundle) {
    throw new Error('Pairing session has no issuer identity state.');
  }

  const decoded = decodeBundle(bundle, 'identity');
  if (!decoded) {
    throw new Error('Pairing session issuer identity state is invalid.');
  }

  const declared = decoded.content.servers;
  if (declared) return declared.urls;

  return [...new Set([...currentServers, info.server])];
}
