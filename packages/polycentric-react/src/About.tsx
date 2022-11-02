import { Paper } from '@mui/material';
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
                <h3>
                    Storage Persistent:{' '}
                    {printOptionalPersistent(state.persistent)}
                </h3>

                <h3>
                    Available Storage:{' '}
                    {printOptionalBytes(state.storageAvailableBytes)}
                </h3>

                <h3>
                    Used Storage: {printOptionalBytes(state.storageUsedBytes)}
                </h3>
            </Paper>
        );
    } else {
        return <Fragment />;
    }
}

export default About;
