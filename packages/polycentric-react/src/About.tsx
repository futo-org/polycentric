import {
    Paper,
    Table,
    TableBody,
    TableRow,
    TableCell,
    Divider,
} from '@mui/material';
import { useEffect, useState, Fragment } from 'react';
import prettyBytes from 'pretty-bytes';

import * as Core from 'polycentric-core';

export type AboutProps = {
    state: Core.DB.PolycentricState;
};

type State = {
    persistent: boolean | undefined;
    storageAvailableBytes: number | undefined;
    storageUsedBytes: number | undefined;
};

export function About(props: AboutProps) {
    const [state, setState] = useState<State | undefined>();

    const load = async (
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> => {
        const nextState: State = {
            persistent: undefined,
            storageAvailableBytes: undefined,
            storageUsedBytes: undefined,
        };

        try {
            nextState.persistent = await navigator.storage.persisted();
        } catch (err) {
            console.log(err);
        }

        try {
            const storageEstimate = await navigator.storage.estimate();

            nextState.storageAvailableBytes = storageEstimate.quota;

            nextState.storageUsedBytes = storageEstimate.usage;
        } catch (err) {
            console.log(err);
        }

        if (cancelContext.cancelled()) {
            return;
        }

        setState(nextState);
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        load(cancelContext);

        return () => {
            cancelContext.cancel();
        };
    }, [props.state]);

    const printOptionalPersistent = (
        persistent: boolean | undefined,
    ): string => {
        if (persistent === undefined) {
            return 'unknown';
        } else {
            return persistent.toString();
        }
    };

    const printOptionalBytes = (bytes: number | undefined): string => {
        if (bytes === undefined) {
            return 'unknown';
        } else {
            return prettyBytes(bytes);
        }
    };

    if (state !== undefined) {
        return (
            <Paper
                elevation={4}
                className="standard_width"
                style={{
                    marginTop: '10px',
                    padding: '10px',
                }}
            >
                <Divider>Persistence Information</Divider>
                <Table>
                    <TableBody>
                        <TableRow>
                            <TableCell>Storage Persistent</TableCell>
                            <TableCell>
                                {printOptionalPersistent(state.persistent)}
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>Storage Driver</TableCell>
                            <TableCell>{props.state.storageDriver}</TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>Estimated Storage Available</TableCell>
                            <TableCell>
                                {printOptionalBytes(
                                    state.storageAvailableBytes,
                                )}
                            </TableCell>
                        </TableRow>
                        <TableRow>
                            <TableCell>Estimated Storage Used</TableCell>
                            <TableCell>
                                {printOptionalBytes(state.storageUsedBytes)}
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </Paper>
        );
    } else {
        return <Fragment />;
    }
}

export default About;
