import * as ReactRouterDOM from 'react-router-dom';
import * as React from 'react';

import * as App from './App';
import * as Core from '@polycentric/polycentric-core';

function loadVouchedByState(
    cancelContext: Core.CancelContext.CancelContext,
    processHandle: Core.ProcessHandle.ProcessHandle,
    queryManager: Core.Queries.QueryManager.QueryManager,
    system: Core.Models.PublicKey.PublicKey,
    setProps: (f: (state: VouchedByState) => VouchedByState) => void,
): Core.Queries.Shared.UnregisterCallback {
    const queries: Array<Core.Queries.Shared.UnregisterCallback> = [];

    queries.push(
        queryManager.queryCRDT.query(
            system,
            Core.Models.ContentType.ContentTypeUsername,
            (buffer: Uint8Array) => {
                if (!cancelContext.cancelled()) {
                    setProps((state) => {
                        return {
                            ...state,
                            username: Core.Util.decodeText(buffer),
                        };
                    });
                }
            },
        ),
    );

    const loadAvatar = async (
        cancelContext: Core.CancelContext.CancelContext,
        avatarCancelContext: Core.CancelContext.CancelContext,
        pointer: Core.Models.Pointer.Pointer,
    ): Promise<void> => {
        const link = await App.loadImageFromPointer(processHandle, pointer);

        if (cancelContext.cancelled() || avatarCancelContext.cancelled()) {
            return;
        }

        console.log('setting avatar');

        setProps((state) => {
            return {
                ...state,
                avatar: link,
            };
        });
    };

    let avatarCancelContext: Core.CancelContext.CancelContext | undefined =
        undefined;

    const avatarCallback = (buffer: Uint8Array) => {
        if (cancelContext.cancelled()) {
            return;
        }

        const pointer = Core.Models.Pointer.fromBuffer(buffer);

        if (avatarCancelContext !== undefined) {
            avatarCancelContext.cancel();
        }

        avatarCancelContext = new Core.CancelContext.CancelContext();

        loadAvatar(cancelContext, avatarCancelContext, pointer);
    };

    queries.push(
        queryManager.queryCRDT.query(
            system,
            Core.Models.ContentType.ContentTypeAvatar,
            avatarCallback,
        ),
    );

    (async () => {
        const link = await Core.ProcessHandle.makeSystemLink(
            processHandle,
            system,
        );

        if (cancelContext.cancelled()) {
            return;
        }

        console.log('setting link');

        setProps((state) => {
            return {
                ...state,
                link: link,
            };
        });
    })();

    return () => {
        queries.forEach((f) => f());
    };
}

export type VouchedByProps = {
    processHandle: Core.ProcessHandle.ProcessHandle;
    queryManager: Core.Queries.QueryManager.QueryManager;
    system: Core.Models.PublicKey.PublicKey;
};

export type VouchedByState = {
    avatar: string;
    username: string;
    link: string;
};

function makeInitialState(
    system: Core.Models.PublicKey.PublicKey,
): VouchedByState {
    return {
        avatar: '',
        username: '',
        link: Core.ProcessHandle.makeSystemLinkSync(system, []),
    };
}

export function VouchedBy(props: VouchedByProps) {
    const [state, setState] = React.useState<VouchedByState>(
        makeInitialState(props.system),
    );

    React.useEffect(() => {
        setState(makeInitialState(props.system));

        const cancelContext = new Core.CancelContext.CancelContext();

        const cleanupView = loadVouchedByState(
            cancelContext,
            props.processHandle,
            props.queryManager,
            props.system,
            setState,
        );

        return () => {
            cancelContext.cancel();

            cleanupView();
        };
    }, [props.system, props.queryManager, props.processHandle]);

    return (
        <div>
            <ReactRouterDOM.Link to={'/' + state.link}>
                <img
                    src={state.avatar}
                    alt={state.username}
                    className="border rounded-full w-20 h-20"
                />
            </ReactRouterDOM.Link>
            <p className="leading-4 w-20 text-center py-2">{state.username}</p>
        </div>
    );
}
