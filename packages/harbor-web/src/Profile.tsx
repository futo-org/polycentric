import * as React from 'react';
import { useInView } from 'react-intersection-observer';

import * as Core from '@polycentric/polycentric-core';
import * as Claim from './Claim';
import { loadImageFromPointer, useIndex, useCRDT, ClaimInfo } from './util';

function loadProfileProps(
    cancelContext: Core.CancelContext.CancelContext,
    processHandle: Core.ProcessHandle.ProcessHandle,
    queryManager: Core.Queries.QueryManager.QueryManager,
    system: Core.Models.PublicKey.PublicKey,
    setProfileProps: (f: (state: State) => State) => void,
): Core.Queries.Shared.UnregisterCallback {
    const queries: Array<Core.Queries.Shared.UnregisterCallback> = [];

    const loadAvatar = async (
        cancelContext: Core.CancelContext.CancelContext,
        avatarCancelContext: Core.CancelContext.CancelContext,
        pointer: Core.Models.Pointer.Pointer,
    ): Promise<void> => {
        const link = await loadImageFromPointer(processHandle, pointer);

        if (cancelContext.cancelled() || avatarCancelContext.cancelled()) {
            return;
        }

        console.log('setting avatar', link);

        setProfileProps((state) => {
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

    return () => {
        queries.forEach((f) => f());
    };
}

export type ProfileProps = {
    processHandle: Core.ProcessHandle.ProcessHandle;
    queryManager: Core.Queries.QueryManager.QueryManager;
    system: Core.Models.PublicKey.PublicKey;
};

type State = {
    avatar: string;
};

const initialState = {
    avatar: '',
};

export function Profile(props: ProfileProps) {
    const username = useCRDT<string>(
        props.queryManager,
        props.system,
        Core.Models.ContentType.ContentTypeUsername,
        Core.Util.decodeText,
    );

    const description = useCRDT<string>(
        props.queryManager,
        props.system,
        Core.Models.ContentType.ContentTypeDescription,
        Core.Util.decodeText,
    );

    const [claims, advanceClaims] = useIndex<Core.Protocol.Claim>(
        props.queryManager,
        props.system,
        Core.Models.ContentType.ContentTypeClaim,
        Core.Protocol.Claim.decode,
    );

    const [state, setState] = React.useState<State>(initialState);
    const [ref, inView] = useInView();

    React.useEffect(() => {
        setState(initialState);

        const cancelContext = new Core.CancelContext.CancelContext();

        const cleanupView = loadProfileProps(
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
    }, [props.processHandle, props.queryManager, props.system]);

    React.useEffect(() => {
        if (inView) {
            advanceClaims();
        }
    }, [inView, advanceClaims]);

    const isSocialProp = (claim: ClaimInfo<Core.Protocol.Claim>) => {
        if (claim.parsedEvent === undefined) {
            return false;
        }

        const claimType = claim.parsedEvent.value.claimType;

        return (
            claimType === Core.Models.ClaimType.Twitter ||
            claimType === Core.Models.ClaimType.YouTube ||
            claimType === Core.Models.ClaimType.Rumble ||
            claimType === Core.Models.ClaimType.Odysee ||
            claimType === Core.Models.ClaimType.Discord ||
            claimType === Core.Models.ClaimType.Instagram ||
            claimType === Core.Models.ClaimType.GitHub ||
            claimType === Core.Models.ClaimType.Minds ||
            claimType === Core.Models.ClaimType.Patreon ||
            claimType === Core.Models.ClaimType.Substack ||
            claimType === Core.Models.ClaimType.Twitch ||
            claimType === Core.Models.ClaimType.HackerNews ||
            claimType === Core.Models.ClaimType.URL ||
            claimType === Core.Models.ClaimType.Website ||
            claimType === Core.Models.ClaimType.Bitcoin
        );
    };

    const socialClaims = claims.filter((claim) => isSocialProp(claim) === true);
    const otherClaims = claims.filter((claim) => isSocialProp(claim) === false);

    return (
        <div className="bg-white dark:bg-zinc-900 px-11 py-20 w-full max-w-3xl dark:text-white">
            <div className="bg-zinc-100 dark:bg-zinc-800 py-28 px-9 rounded-3xl shadow">
                <div className="flex flex-col items-center justify-center text-center gap-5">
                    <img
                        className="rounded-full w-20 h-20"
                        src={
                            state.avatar == '' || state.avatar == null
                                ? '/placeholder.jpg'
                                : state.avatar
                        }
                        alt={`The avatar for ${username}`}
                    />
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white">
                        {username ? username : 'loading'}
                    </h1>

                    {description && (
                        <h2 className="text-2xl font-light px-36">
                            {description}
                        </h2>
                    )}

                    {socialClaims.length > 0 && (
                        <div>
                            <div className="flex flex-row justify-center px-7 gap-5 bg-gray-50 dark:bg-zinc-900 rounded-full py-4">
                                {socialClaims.map((claim, idx) => (
                                    <Claim.SocialClaim
                                        key={idx}
                                        parsedEvent={claim.parsedEvent!}
                                        processHandle={props.processHandle}
                                        queryManager={props.queryManager}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <br />

                <div className="px-6 py-5 bg-gray-50 dark:bg-zinc-900 rounded-lg">
                    <h2 className="text-3xl font-demibold text-gray-800 dark:text-white pb-4">
                        Claims
                    </h2>

                    {otherClaims.map((claim, idx) => {
                        if (claim.parsedEvent !== undefined) {
                            return (
                                <Claim.Claim
                                    key={idx}
                                    parsedEvent={claim.parsedEvent}
                                    processHandle={props.processHandle}
                                    queryManager={props.queryManager}
                                />
                            );
                        } else {
                            return (
                                <h1 ref={ref} key={idx}>
                                    missing
                                </h1>
                            );
                        }
                    })}

                    {otherClaims.length == 0 && (
                        <div className="text-gray-400 dark:text-gray-600">
                            No claims yet!
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
