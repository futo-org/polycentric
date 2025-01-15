import { Models, Protocol } from '@polycentric/polycentric-core';
import { useEffect, useMemo } from 'react';
import { useQueryCRDTSet } from '../../../hooks/queryHooks';
import { AccountListModal } from '../AccountList';

const OpenBlockedList = ({
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
        Models.ContentType.ContentTypeBlock,
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
            title="Blocked"
            systems={systems}
            advance={advance}
            open={open}
            setOpen={setOpen}
        />
    );
};

export const BlockedList = ({
    system,
    open,
    setOpen,
}: {
    system: Models.PublicKey.PublicKey;
    open: boolean;
    setOpen: (open: boolean) => void;
}) => {
    return open ? (
        <OpenBlockedList system={system} open={open} setOpen={setOpen} />
    ) : (
        <></>
    );
};
