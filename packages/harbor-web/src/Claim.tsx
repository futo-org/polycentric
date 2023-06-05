import * as React from 'react';
import YouTubeIcon from '@mui/icons-material/YouTube';
import BitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import TwitterIcon from '@mui/icons-material/Twitter';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import * as App from './App';
import * as Core from '@polycentric/polycentric-core';
import * as VouchedBy from './VouchedBy';

export type ClaimProps = {
    processHandle: Core.ProcessHandle.ProcessHandle;
    parsedEvent: App.ParsedEvent<Core.Protocol.Claim>;
    view: Core.View.View;
};

type ImplementsFontSxProp = {
    sx?: any;
};

type ClaimInfo = {
    Icon: React.ComponentType<ImplementsFontSxProp>;
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
            Icon: YouTubeIcon,
            name: 'Rumble',
            URL: `https://youtube.com/${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Bitcoin) {
        return {
            Icon: BitcoinIcon,
            name: 'Bitcoin',
            URL:
                'https://www.blockchain.com/explorer/addresses/btc/' +
                `${identifier}`,
        };
    } else if (claimType === Core.Models.ClaimType.Generic) {
        return {
            Icon: FormatQuoteIcon,
            name: 'Generic',
            URL: identifier,
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

    const { Icon, name, URL } = claimInfo;

    return (
        <a href={URL} target="_blank" rel="noreferrer">
            <Icon
                sx={{
                    // size
                    width: '2em',
                    height: '2em',
                }}
            />
        </a>
    );
}

export function Claim(props: ClaimProps) {
    const [vouchedBy, setVouchedBy] = React.useState<
        Array<Core.Models.PublicKey.PublicKey>
    >([]);

    const identifier = Core.Protocol.ClaimIdentifier.decode(
        props.parsedEvent.value.claim,
    ).identifier;

    React.useEffect(() => {
        setVouchedBy([]);

        const cancelContext = new Core.CancelContext.CancelContext();

        (async () => {
            const pointer = await Core.Models.signedEventToPointer(
                props.parsedEvent.signedEvent,
            );
            const reference = Core.Models.pointerToReference(pointer);

            const references = await Core.APIMethods.getQueryReferences(
                App.server,
                reference,
                Core.Models.ContentType.ContentTypeVouch,
            );

            console.log('got references count', references.items.length);

            const vouchedBy = references.items
                .filter(
                    (reference: Core.Protocol.QueryReferencesResponseItem) => {
                        if (reference.event === undefined) {
                            throw new Error(
                                'reference query event is undefined',
                            );
                        }
                        return true;
                    },
                )
                .map((reference: Core.Protocol.QueryReferencesResponseItem) => {
                    return Core.Models.Event.fromBuffer(
                        Core.Models.SignedEvent.fromProto(reference.event!)
                            .event,
                    ).system;
                });

            if (cancelContext.cancelled()) {
                return;
            }

            setVouchedBy(vouchedBy);
        })();

        return () => {
            cancelContext.cancel();
        };
    }, [props.processHandle, props.view, props.parsedEvent]);

    const claimInfo = getClaimInfo(
        props.parsedEvent.value.claimType,
        identifier,
    );

    if (!claimInfo) {
        return <></>;
    }

    const { Icon, name } = claimInfo;

    return (
        <div className="flex">
            <img
                className="h-24 w-24 object-cover mt-0"
                alt="image here"
                src={'/placeholder.jpg'}
            ></img>
            <div className="flex flex-col px-4">
                <h3 className="text-3xl font-bold text-gray-900 dark:text-white">
                    {identifier}
                </h3>
                <p className="italic">Verified by:</p>
                <div className="flex flex-row gap-5 pt-3">
                    {vouchedBy.map(
                        (vouchedBy: Core.Models.PublicKey.PublicKey) => {
                            return (
                                <VouchedBy.VouchedBy
                                    key={vouchedBy.toString()}
                                    processHandle={props.processHandle}
                                    view={props.view}
                                    system={vouchedBy}
                                />
                            );
                        },
                    )}
                </div>
            </div>
        </div>
    );
}
