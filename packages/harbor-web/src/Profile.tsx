import * as MUI from '@mui/material';
import * as React from 'react';
import * as Core from 'polycentric-core';

import * as App from './App';
import * as VouchedBy from './VouchedBy';
import * as Claim from './Claim';

type Profile = {
    avatar: string;
    username: string;
    link: string;
}

export function loadProfileProps(
    cancelContext: Core.CancelContext.CancelContext,
    processHandle: Core.ProcessHandle.ProcessHandle,
    view: Core.View.View,
    system: Core.Models.PublicKey.PublicKey,
    setProfileProps: (f: ((state: State) => State)) => void,
): Core.View.UnregisterCallback {
    const queries: Array<Core.View.UnregisterCallback> = [];

    queries.push(
        view.registerCRDTQuery(
            system,
            Core.Models.ContentType.ContentTypeUsername,
            (buffer: Uint8Array) => {
                if (!cancelContext.cancelled()) {
                    console.log("setting username");
                    setProfileProps((state) => {
                        return {
                            ...state,
                            name: Core.Util.decodeText(buffer),
                        };
                    });
                }
            },
        ),
    );

    queries.push(
        view.registerCRDTQuery(
            system,
            Core.Models.ContentType.ContentTypeDescription,
            (buffer: Uint8Array) => {
                if (!cancelContext.cancelled()) {
                    console.log("setting description");
                    setProfileProps((state) => {
                        return {
                            ...state,
                            description: Core.Util.decodeText(buffer),
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

        setProfileProps((state) => {
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
                    Core.Models.ContentType.ContentTypeDescription,
                    Core.Models.ContentType.ContentTypeUsername,
                    Core.Models.ContentType.ContentTypeAvatar,
                ],
                undefined,
            )
        );
    })();

    (async () => {
        await Core.Synchronization.saveBatch(
            processHandle,
            await Core.APIMethods.getQueryIndex(
                App.server,
                system,
                [
                    Core.Models.ContentType.ContentTypeClaim,
                ],
                10,
            )
        );

        const [claimEvents, _] =
            await processHandle.store().queryClaimIndex(
                system,
                10,
                undefined,
            );

        const parsedEvents = claimEvents.map((raw) => {
            const signedEvent = Core.Models.SignedEvent.fromProto(raw);
            const event = Core.Models.Event.fromBuffer(signedEvent.event);

            if (
                !event.contentType.equals(
                    Core.Models.ContentType.ContentTypeClaim,
                )
            ) {
                throw new Error("event content type was not claim");
            }

            const claim = Core.Protocol.Claim.decode(event.content);

            return new App.ParsedEvent<Core.Protocol.Claim>(
                signedEvent, event, claim
            );
        });

        if (cancelContext.cancelled()) { return; }

        console.log("setting claims");

        setProfileProps((state) => {
            return {
                ...state,
                claims: parsedEvents, 
            };
        });
    })();

    return () => {
        queries.forEach(f => f());
    };
}

export type ProfileProps = {
    processHandle: Core.ProcessHandle.ProcessHandle,
    view: Core.View.View,
    system: Core.Models.PublicKey.PublicKey,
};

type State = {
    name: string,
    description: string,
    avatar: string,
    claims: Array<App.ParsedEvent<Core.Protocol.Claim>>,
};

export function Profile(props: ProfileProps) {
    const initialState = {
        name: "loading",
        description: "loading",
        claims: [],
        avatar: "",
    };

    const [state, setState] = React.useState<State>(initialState);

    React.useEffect(() => {
        setState(initialState);

        const cancelContext = new Core.CancelContext.CancelContext();

        const cleanupView = loadProfileProps(
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
    }, [props.processHandle, props.view, props.system]);


    return (
        <div
            style={{
                marginTop: '20px',
                width: '33%',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
            }}
        >
            <MUI.Avatar
                src={state.avatar}
                style={{
                    display: 'block',
                    width: '100px',
                    height: '100px',
                }}
            />

            <p>
                {state.name}
            </p>

            <p>
                {state.description}
            </p>

            {state.claims.map((claim, idx) => (
                <Claim.Claim
                    key={idx}
                    parsedEvent={claim}
                    processHandle={props.processHandle}
                    view={props.view}
                />
            ))}
        </div>
    );
}


