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

        nextState.persistent = await props.state.persistenceDriver.persisted();

        const storageEstimate =
            await props.state.persistenceDriver.estimateStorage();

        nextState.storageAvailableBytes = storageEstimate.bytesAvailable;
        nextState.storageUsedBytes = storageEstimate.bytesUsed;

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

    const versionToLink = (version: string) => {
        return (
            <a
                href={
                    'https://gitlab.futo.org/polycentric/polycentric/-/tree/' +
                    version
                }
                target="_blank"
            >
                {version.slice(0, 8)}
            </a>
        );
    };

    const driverName = props.state.persistenceDriver.getImplementationName();

    if (state !== undefined) {
        return (
            <Fragment>
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
                                <TableCell>{driverName}</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell>
                                    Estimated Storage Available
                                </TableCell>
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

                <Paper
                    elevation={4}
                    className="standard_width"
                    style={{
                        marginTop: '10px',
                        padding: '10px',
                    }}
                >
                    <Divider>Client Information</Divider>
                    <Table>
                        <TableBody>
                            <TableRow>
                                <TableCell>Client Context</TableCell>
                                <TableCell>{props.state.client}</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell>Client Build Version</TableCell>
                                <TableCell>
                                    {versionToLink(Core.Version.SHA)}
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </Paper>
            </Fragment>
        );
    } else {
        return <Fragment />;
    }
}

export default About;
