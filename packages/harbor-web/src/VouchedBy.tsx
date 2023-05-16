import * as MUI from '@mui/material';
import * as ReactRouterDOM from 'react-router-dom';
import * as React from 'react';
import * as Base64 from '@borderless/base64';

import * as App from './App';
import * as Core from 'polycentric-core';

function loadVouchedByState(
    cancelContext: Core.CancelContext.CancelContext,
    processHandle: Core.ProcessHandle.ProcessHandle,
    view: Core.View.View,
    system: Core.Models.PublicKey.PublicKey,
    setProps: (f: ((state: VouchedByState) => VouchedByState)) => void,
): Core.View.UnregisterCallback {
    const queries: Array<Core.View.UnregisterCallback> = [];

    queries.push(
        view.registerCRDTQuery(
            system,
            Core.Models.ContentType.ContentTypeUsername,
            (buffer: Uint8Array) => {
                if (!cancelContext.cancelled()) {
                    setProps((state) => {
                        return {
                            ...state,
                            name: Core.Util.decodeText(buffer),
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
        const link = await App.loadImageFromPointer(
            processHandle,
            pointer,
        );

        if (cancelContext.cancelled() || avatarCancelContext.cancelled()) {
            return;
        }

        console.log("setting avatar");

        setProps((state) => {
            return {
                ...state,
                avatar: link, 
            };
        });
    };

    let avatarCancelContext: Core.CancelContext.CancelContext | undefined
        = undefined;

    const avatarCallback = (buffer: Uint8Array) => {
        if (cancelContext.cancelled()) {
            return;
        }

        const pointer = Core.Models.Pointer.fromBuffer(buffer);

        if (avatarCancelContext!= undefined) {
            avatarCancelContext.cancel();
        }

        avatarCancelContext = new Core.CancelContext.CancelContext();

        loadAvatar(cancelContext, avatarCancelContext, pointer);
    };

    queries.push(
        view.registerCRDTQuery(
            system,
            Core.Models.ContentType.ContentTypeAvatar,
            avatarCallback,
        )
    );

    (async () => {
        await Core.Synchronization.saveBatch(
            processHandle,
            await Core.APIMethods.getQueryIndex(
                App.server,
                system,
                [
                    Core.Models.ContentType.ContentTypeAvatar,
                    Core.Models.ContentType.ContentTypeUsername,
                ],
                undefined,
            )
        );
    })();

    return () => {
        queries.forEach(f => f());
    };
}

export type VouchedByProps = {
    processHandle: Core.ProcessHandle.ProcessHandle,
    view: Core.View.View,
    system: Core.Models.PublicKey.PublicKey,
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
        avatar: "",
        username: "",
        link: Base64.encodeUrl(Core.Protocol.PublicKey.encode(
            system
        ).finish()),
    };
}

export function VouchedBy(props: VouchedByProps) {
    const navigate = ReactRouterDOM.useNavigate();

    const [state, setState] = React.useState<VouchedByState>(
        makeInitialState(props.system),
    );

    React.useEffect(() => {
        setState(makeInitialState(props.system));

        const cancelContext = new Core.CancelContext.CancelContext();

        const cleanupView = loadVouchedByState(
            cancelContext,
            props.processHandle,
            props.view,
            props.system,
            setState,
        );

        return () => {
            cancelContext.cancel();

            cleanupView();
        };
    }, [props.system, props.view, props.processHandle]);

    return (
        <MUI.Avatar
            src={state.avatar}
            alt={state.username}
            onClick={() => {
                navigate('/' + state.link);
            }}
        />
    );
}

