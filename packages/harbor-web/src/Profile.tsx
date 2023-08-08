import * as React from 'react';
import { useInView } from 'react-intersection-observer';

import * as Core from '@polycentric/polycentric-core';
import * as Claim from './Claim';
import * as Util from './util';

export type ProfileProps = {
    processHandle: Core.ProcessHandle.ProcessHandle;
    queryManager: Core.Queries.QueryManager.QueryManager;
    system: Core.Models.PublicKey.PublicKey;
};

export function Profile(props: ProfileProps) {
    const avatar = Util.useAvatar(props.queryManager, props.system);

    const username = Util.useCRDT<string>(
        props.queryManager,
        props.system,
        Core.Models.ContentType.ContentTypeUsername,
        Core.Util.decodeText,
    );

    const description = Util.useCRDT<string>(
        props.queryManager,
        props.system,
        Core.Models.ContentType.ContentTypeDescription,
        Core.Util.decodeText,
    );

    const [claims, advanceClaims] = Util.useIndex<Core.Protocol.Claim>(
        props.queryManager,
        props.system,
        Core.Models.ContentType.ContentTypeClaim,
        Core.Protocol.Claim.decode,
    );

    const [ref, inView] = useInView();

    React.useEffect(() => {
        if (inView) {
            advanceClaims();
        }
    }, [inView, advanceClaims]);

    const isSocialProp = (claim: Util.ClaimInfo<Core.Protocol.Claim>) => {
        if (claim.parsedEvent === undefined) {
            return false;
        }

        const claimType = claim.parsedEvent.value.claimType;

        return (
            claimType.equals(Core.Models.ClaimType.ClaimTypeTwitter) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeYouTube) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeRumble) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeOdysee) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeDiscord) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeInstagram) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeGitHub) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeMinds) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypePatreon) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeSubstack) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeTwitch) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeHackerNews) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeURL) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeWebsite) ||
            claimType.equals(Core.Models.ClaimType.ClaimTypeBitcoin)
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
                        src={avatar === '' ? '/placeholder.jpg' : avatar}
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
