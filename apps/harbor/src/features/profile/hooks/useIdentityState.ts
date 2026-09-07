import {
  useCurrentIdentity,
  usePolycentric,
} from '@/src/common/lib/polycentric-hooks';
import { COLLECTION, type IdentityState } from '@polycentric/react-native';
import { useEffect, useState } from 'react';

export interface IdentityStateHookResult {
  state: IdentityState | null;
  isLoading: boolean;
}

export function useIdentityState(
  identityKey: string | null | undefined,
): IdentityStateHookResult {
  const client = usePolycentric();
  const { identity: self } = useCurrentIdentity();

  const [state, setState] = useState<IdentityState | null>(() =>
    identityKey ? client.identityManager.resolveIdentity(identityKey) : null,
  );
  const [isLoading, setIsLoading] = useState(!!identityKey);

  useEffect(() => {
    if (!identityKey) {
      setState(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setState(client.identityManager.resolveIdentity(identityKey));
    setIsLoading(true);
    void client
      .listEvents({ identity: identityKey, collection: COLLECTION.IDENTITY })
      .then(() => {
        if (cancelled) return;
        setState(client.identityManager.resolveIdentity(identityKey));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, identityKey]);

  const resolved =
    self && identityKey && self.identityKey === identityKey ? self : state;

  return { state: resolved, isLoading: isLoading && !resolved };
}
