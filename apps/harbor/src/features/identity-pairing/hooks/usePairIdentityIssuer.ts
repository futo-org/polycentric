import {
  publicKeyToString,
  stringToPublicKey,
  usePolycentric,
} from '@/src/common/lib/polycentric-hooks';
import type { PairingSession, v2 } from '@polycentric/react-native';
import { IdentityManager, SyncStrategy } from '@polycentric/react-native';
import { useEffect, useRef, useState } from 'react';

/** Pairing session state that we expose to the caller. */
export type IssuerView = {
  /** Immutable pairing data available once the session has been created. */
  info: v2.PairingInfo | null;

  /** The expiration time that we should enforce for the session. */
  expiresAt: Date | null;

  /**
   * Append-only claimer array managed by us.
   * Having this mirror prevents a server from messing with our view of pre-
   * existing claimers.
   */
  claimers: string[];

  /**
   * Contains the error message for a non-recoverable error, if any.
   * When non-null, an error page should be displayed instead of continuing with
   * the pairing process.
   */
  error: string | null;

  /** Indicates which stage of the pairing process we are on. */
  stage: IssuerState['stage'];
};

export type IssuerActions = {
  /**
   * Approve a claimer to be added to the active identity.
   */
  approveClaimer: (claimer: string, asRotation: boolean) => void;
};

export type PairIdentityIssuerHookResult = IssuerView & IssuerActions;

// -- Internal hook state --
type ErrorState = { message: string };
type PollingState = { session: PairingSession; claimers: string[] };
type ApprovingState = PollingState & { approvedClaimer: string };
type DoneState = ApprovingState;

type StageState =
  | ({ stage: 'error' } & ErrorState)
  | { stage: 'creating' }
  | ({ stage: 'polling' } & PollingState)
  | ({ stage: 'approving' } & ApprovingState)
  | ({ stage: 'done' } & DoneState);

type IssuerState = StageState & {
  /**
   * Stores the interval id used for polling so that we can clear it in all
   * exit paths.
   */
  pollingInterval: ReturnType<typeof setInterval> | null;

  /** Async functions will check this after resuming. */
  canceled: boolean;
};

export function usePairIdentityIssuer(): PairIdentityIssuerHookResult {
  const client = usePolycentric();

  const initialState: IssuerState = {
    canceled: false,
    pollingInterval: null,
    stage: 'creating',
  };

  const stateRef = useRef<IssuerState>(initialState);

  const [view, setView] = useState<IssuerView>(() => {
    return viewFromState(initialState);
  });

  useEffect(() => {
    return () => {
      stateRef.current.canceled = true;
    };
  }, []);

  /** Refresh the view that callers see using the latest state. */
  const updateView = () => {
    setView(viewFromState(stateRef.current));
  };

  const onError = (e: unknown) => {
    if (stateRef.current.stage === 'error') return;

    const message = e instanceof Error ? e.message : 'Identity pairing failed';

    stateRef.current = {
      ...stateRef.current,
      stage: 'error',
      message,
    };

    updateView();
  };

  const approve = async (claimer: string, asRotation: boolean) => {
    if (stateRef.current.stage !== 'polling') return;

    stateRef.current = {
      ...stateRef.current,
      stage: 'approving',
      approvedClaimer: claimer,
    };

    updateView();

    await client.sync(SyncStrategy.PARTIAL_PULL);
    if (stateRef.current.canceled) return;

    // Check for prior authorization.
    const identityKey = client.activeIdentityKey;
    if (!identityKey) throw new Error('No active identity');

    const identityState = client.identityManager.resolveIdentity(identityKey);
    if (!identityState)
      throw new Error('No identity chain available for this identity.');

    const key = stringToPublicKey(claimer);

    let alreadyAuthorized = false;
    for (const otherKey of [
      ...identityState.rotationKeys,
      ...identityState.signingKeys,
    ]) {
      if (IdentityManager.keysEqual(key, otherKey)) {
        alreadyAuthorized = true;
        break;
      }
    }

    if (!alreadyAuthorized) {
      if (asRotation) {
        await client.identityManager.addRotationKey(key);
      } else {
        await client.identityManager.addSigningKey(key);
      }
    }

    const session = await client.pairingSessionManager.updatePairingSession(
      stateRef.current.session.pairingInfo.server,
      stateRef.current.session.digestBytes,
      stateRef.current.session.issuerState.sequence + BigInt(1),
    );

    stateRef.current = {
      ...stateRef.current,
      stage: 'done',
      session,
    };

    if (stateRef.current.canceled) return;

    updateView();
  };

  // Begin pairing process
  // biome-ignore lint/correctness/useExhaustiveDependencies: we never want this to run multiple times
  useEffect(() => {
    const poll = async (info: v2.PairingInfo) => {
      if (stateRef.current.canceled || stateRef.current.stage !== 'polling') {
        if (stateRef.current.pollingInterval) {
          clearInterval(stateRef.current.pollingInterval);
          stateRef.current.pollingInterval = null;
        }

        return;
      }

      const latestClaimers =
        await client.pairingSessionManager.pollForClaimers(info);
      if (stateRef.current.canceled) return;
      if (stateRef.current.stage !== 'polling') return;

      const claimers = withLatestClaimers(
        stateRef.current.claimers,
        latestClaimers,
      );

      if (claimers !== stateRef.current.claimers) {
        stateRef.current.claimers = claimers;
        updateView();
      }
    };

    const createAndWatchSession = async () => {
      const server = client.servers.at(0);
      if (!server) {
        throw new Error('No servers configured');
      }

      const session =
        await client.pairingSessionManager.createPairingSession(server);
      if (stateRef.current.canceled) return;
      if (stateRef.current.stage !== 'creating') return;

      stateRef.current = {
        ...stateRef.current,
        stage: 'polling',
        session,
        claimers: [],
      };

      updateView();

      stateRef.current.pollingInterval = setInterval(() => {
        poll(session.pairingInfo).catch((e) => {
          // Polling may fail due to race conditions if we have sent a state
          // update for an approval while we still have an in-flight poll request.
          // We should only error for real if we fail while still in the polling
          // stage.
          if (stateRef.current.stage === 'polling') {
            onError(e);
          } else {
            console.warn(`pairing session polling error: ${e}`);
          }
        });
      }, 2000);
    };

    createAndWatchSession().catch(onError);
  }, []);

  // Return current view
  return {
    ...view,
    approveClaimer: (claimer, asRotation) => {
      approve(claimer, asRotation).catch(onError);
    },
  };
}

function viewFromState(state: IssuerState): IssuerView {
  const stage = state.stage;
  const error = stage === 'error' ? state.message : null;

  let info: v2.PairingInfo | null = null;
  let expiresAt: Date | null = null;
  let claimers: string[] = [];

  if (stage === 'polling' || stage === 'approving' || stage === 'done') {
    info = state.session.pairingInfo;
    expiresAt = state.session.expiresAt;
    claimers = state.claimers;
  }

  return { info, expiresAt, claimers, error, stage };
}

/**
 * Derive the next value for the claimers array.
 * Returns a new array if there are any new claimers.
 * Returns `prev` if there are no new claimers.
 */
function withLatestClaimers(
  prev: string[],
  candidates: v2.PublicKey[],
): string[] {
  const next = [...prev];
  const seen = new Set(prev);

  for (const candidate of candidates) {
    const claimer = publicKeyToString(candidate);
    if (!seen.has(claimer)) {
      next.push(claimer);
      seen.add(claimer);
    }
  }

  if (next.length === prev.length) return prev;
  else return next;
}
