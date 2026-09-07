import type { v2 } from '@polycentric/react-native';
import type { ReactNode } from 'react';

export type PairIdentityCameraProps = {
  onCodeScanned: (pairingInfo: v2.PairingInfo | null) => void;
};

/**
 * `PairIdentityCamera` should conform to this type definition on both web and
 * native.
 */
export type PairIdentityCameraComponent = (
  props: PairIdentityCameraProps,
) => ReactNode;
