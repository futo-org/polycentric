import * as React from 'react';
import * as Core from '@polycentric/polycentric-core';
import * as App from './App';
import * as Claim from './Claim';

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

        if (avatarCancelContext !== undefined) {
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

        const [claimEvents] =
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

const initialState = {
    name: "loading",
    description: "loading",
    claims: [],
    avatar: "",
};

export function Profile(props: ProfileProps) {
    

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
        <div className="bg-white rounded-lg shadow-lg p-4 max-w-screen w-96 h-[38.4rem]"
        >
            <div className="flex justify-between items-center w-full">
                <img
                    className="rounded-full w-32 h-32"
                    src={state.avatar} 
                    alt={`The avatar for ${state.name}`}/>
                <div className='flex flex-col pl-3'>
                    <h1 className="text-4xl font-bold text-gray-800">
                        {state.name}
                    </h1>

                    <h2 className="">
                        {state.description}
                    </h2> 
                </div>
            </div>
            <br/>

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


