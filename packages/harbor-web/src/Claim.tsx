import * as React from 'react';
import * as Core from '@polycentric/polycentric-core';
import * as VouchedBy from './VouchedBy';
import { server } from './util';
import { ParsedEvent } from './util';

import YouTubeIcon from '../icons/rendered/youtube.svg.png';
import TwitterIcon from '../icons/rendered/twitter.svg.png';
import RumbleIcon from '../icons/rendered/rumble.svg.png';
import OdyseeIcon from '../icons/rendered/odysee.svg.png';
import DiscordIcon from '../icons/rendered/discord.svg.png';
import InstagramIcon from '../icons/rendered/instagram.svg.png';
import GitHubIcon from '../icons/rendered/github.svg.png';
import MindsIcon from '../icons/rendered/minds.svg.png';
import PatreonIcon from '../icons/rendered/patreon.svg.png';
import SubstackIcon from '../icons/rendered/substack.svg.png';
import TwitchIcon from '../icons/rendered/twitch.svg.png';
import BitcoinIcon from '../icons/rendered/bitcoin.svg.png';
import HackerNewsIcon from '../icons/rendered/hackernews.svg.png';
import URLIcon from '../icons/rendered/url.svg.png';
import WebsiteIcon from '../icons/rendered/website.svg.png';

export type ClaimProps = {
    processHandle: Core.ProcessHandle.ProcessHandle;
    queryManager: Core.Queries.QueryManager.QueryManager;
    parsedEvent: ParsedEvent<Core.Protocol.Claim>;
};

type ClaimInfo = {
    Icon: string;
    name: string;
    URL: string;
};

function getClaimInfo(
    claimType: string,
    identifier: string,
): ClaimInfo | undefined {
    if (claimType === Core.Models.ClaimType.Twitter) {
        return {
            Icon: TwitterIcon,
            name: 'Twitter',
            URL: `https://twitter.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.YouTube) {
        return {
            Icon: YouTubeIcon,
            name: 'YouTube',
            URL: `https://youtube.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Rumble) {
        return {
            Icon: RumbleIcon,
            name: 'Rumble',
            URL: `https://rumble.com/user/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Odysee) {
        return {
            Icon: OdyseeIcon,
            name: 'Odysee',
            URL: `https://odysee.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Discord) {
        return {
            Icon: DiscordIcon,
            name: 'Discord',
            URL: `https://discordapp.com/users/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Instagram) {
        return {
            Icon: InstagramIcon,
            name: 'Instagram',
            URL: `https://instagram.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.GitHub) {
        return {
            Icon: GitHubIcon,
            name: 'GitHub',
            URL: `https://github.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Minds) {
        return {
            Icon: MindsIcon,
            name: 'Minds',
            URL: `https://minds.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Patreon) {
        return {
            Icon: PatreonIcon,
            name: 'Patreon',
            URL: `https://patreon.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Substack) {
        return {
            Icon: SubstackIcon,
            name: 'Substack',
            URL: `https://${identifier}.substack.com`,
        };
    } else if (claimType === Core.Models.ClaimType.Twitch) {
        return {
            Icon: TwitchIcon,
            name: 'Twitch',
            URL: `https://twitch.tv/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.HackerNews) {
        return {
            Icon: HackerNewsIcon,
            name: 'HackerNews',
            URL: `https://news.ycombinator.com/user?id=${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.URL) {
        return {
            Icon: URLIcon,
            name: 'URL',
            URL: `${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Website) {
        return {
            Icon: WebsiteIcon,
            name: 'Website',
            URL: `https://${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Bitcoin) {
        return {
            Icon: BitcoinIcon,
            name: 'Bitcoin',
            URL:
                'https://www.blockchain.com/explorer/addresses/btc/' +
                `${identifier}`,
        };
    } else {
        return undefined;
    }
}

export function SocialClaim(props: ClaimProps) {
    const identifier = Core.Protocol.ClaimIdentifier.decode(
        props.parsedEvent.value.claim,
    ).identifier;

    const claimInfo = getClaimInfo(
        props.parsedEvent.value.claimType,
        identifier,
    );

    if (!claimInfo) {
        return <></>;
    }

    const { Icon, URL } = claimInfo;

    return (
        <a href={URL} target="_blank" rel="noreferrer">
            <img src={Icon} />
        </a>
    );
}

export function Claim(props: ClaimProps) {
    const [vouchedBy, setVouchedBy] = React.useState<
        Array<Core.Models.PublicKey.PublicKey>
    >([]);

    React.useEffect(() => {
        setVouchedBy([]);

        const cancelContext = new Core.CancelContext.CancelContext();

        (async () => {
            const pointer = await Core.Models.signedEventToPointer(
                props.parsedEvent.signedEvent,
            );
            const reference = Core.Models.pointerToReference(pointer);

            const references = await Core.APIMethods.getQueryReferences(
                server,
                reference,
                undefined,
                {
                    fromType: Core.Models.ContentType.ContentTypeVouch,
                    countLwwElementReferences: [],
                    countReferences: [],
                },
            );

            console.log('got references count', references.items.length);

            const vouchedBy = references.items
                .filter(
                    (
                        reference: Core.Protocol.QueryReferencesResponseEventItem,
                    ) => {
                        if (reference.event === undefined) {
                            throw new Error(
                                'reference query event is undefined',
                            );
                        }
                        return true;
                    },
                )
                .map(
                    (
                        reference: Core.Protocol.QueryReferencesResponseEventItem,
                    ) => {
                        return Core.Models.Event.fromBuffer(
                            Core.Models.SignedEvent.fromProto(reference.event!)
                                .event,
                        ).system;
                    },
                );

            if (cancelContext.cancelled()) {
                return;
            }

            setVouchedBy(vouchedBy);
        })();

        return () => {
            cancelContext.cancel();
        };
    }, [props.processHandle, props.queryManager, props.parsedEvent]);

    const renderClaim = () => {
        const h3Theme = 'text-lg semi-bold text-gray-900 dark:text-white';
        const h2Theme = 'text-1xl font-bold text-gray-900 dark:text-white';

        if (
            props.parsedEvent.value.claimType ===
            Core.Models.ClaimType.Occupation
        ) {
            const occupation = Core.Protocol.ClaimOccupation.decode(
                props.parsedEvent.value.claim,
            );

            return (
                <>
                    <h3 className={h3Theme}>Occupation</h3>

                    <h2 className={h2Theme}>
                        Organization: {occupation.organization}, Role:{' '}
                        {occupation.role}, Location: {occupation.location}
                    </h2>
                </>
            );
        } else {
            const identifier = Core.Protocol.ClaimIdentifier.decode(
                props.parsedEvent.value.claim,
            ).identifier;

            return (
                <>
                    <h3 className={h3Theme}>
                        {props.parsedEvent.value.claimType}
                    </h3>

                    <h2 className={h2Theme}>{identifier}</h2>
                </>
            );
        }
    };

    return (
        <div className="flex">
            <div className="flex flex-col px-4">
                {renderClaim()}
                <p className="italic">
                    {vouchedBy.length > 0 ? 'Verified by:' : 'Not verified'}
                </p>
                <div className="flex flex-row gap-5 pt-3">
                    {vouchedBy.map((system, idx) => {
                        return (
                            <VouchedBy.VouchedBy
                                key={idx}
                                processHandle={props.processHandle}
                                queryManager={props.queryManager}
                                system={system}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
