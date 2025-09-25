/**
 * @fileoverview Following list components for managing followed users.
 */

import { Models, Protocol } from '@polycentric/polycentric-core';
import { useEffect, useMemo } from 'react';
import { useQueryCRDTSet } from '../../../hooks/queryHooks';
import { AccountListModal } from '../AccountList';

// Following list modal with CRDT query and system conversion
const OpenFollowingList = ({
  system,
  open,
  setOpen,
}: {
  system: Models.PublicKey.PublicKey;
  open: boolean;
  setOpen: (open: boolean) => void;
}) => {
  const [cells, advance] = useQueryCRDTSet(
    system,
    Models.ContentType.ContentTypeFollow,
  );

  useEffect(() => {
    advance();
  }, [advance]);

  // TODO: This runs every time the data changes, which is a lot. We should probably memoize this the actual way.
  const systems = useMemo(
    () =>
      cells
        .filter((e) => e.lwwElementSet?.value !== undefined)
        // @ts-ignore
        .map((e) => Protocol.PublicKey.decode(e.lwwElementSet.value))
        .map((p) => Models.PublicKey.fromProto(p)),
    [cells],
  );

  return (
    <AccountListModal
      title="Following"
      systems={systems}
      advance={advance}
      open={open}
      setOpen={setOpen}
    />
  );
};

// Conditional following list component that only renders when open
export const FollowingList = ({
  system,
  open,
  setOpen,
}: {
  system: Models.PublicKey.PublicKey;
  open: boolean;
  setOpen: (open: boolean) => void;
}) => {
  return open ? (
    <OpenFollowingList system={system} open={open} setOpen={setOpen} />
  ) : (
    <></>
  );
};
