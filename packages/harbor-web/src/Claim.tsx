import * as MUI from '@mui/material';
import * as ReactRouterDOM from 'react-router-dom';
import * as React from 'react';
import YouTubeIcon from '@mui/icons-material/YouTube';
import BitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import TwitterIcon from '@mui/icons-material/Twitter';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';

import * as App from './App';
import * as Core from '@polycentric/polycentric-core';
import * as VouchedBy from './VouchedBy';

export type ClaimProps = {
    processHandle: Core.ProcessHandle.ProcessHandle,
    parsedEvent: App.ParsedEvent<Core.Protocol.Claim>,
    view: Core.View.View,
}

export function Claim(props: ClaimProps) {
    const navigate = ReactRouterDOM.useNavigate();

    const [vouchedBy, setVouchedBy] =
        React.useState<Array<Core.Models.PublicKey.PublicKey>>([]);

    const identifier = Core.Protocol.ClaimIdentifier.decode(
        props.parsedEvent.value.claim,
    ).identifier;

    React.useEffect(() => {
        setVouchedBy([]);

        const cancelContext = new Core.CancelContext.CancelContext();

        (async () => {
            const pointer = await Core.Models.signedEventToPointer(props.parsedEvent.signedEvent);
            const reference = Core.Models.pointerToReference(pointer);

            const references = await Core.APIMethods.getQueryReferences(
                App.server,
                reference,
                Core.Models.ContentType.ContentTypeVouch,
            );

            console.log("got references count", references.items.length);

            const vouchedBy = references.items
                .filter((reference: Core.Protocol.QueryReferencesResponseItem) => {
                    if (reference.event == undefined) {
                        throw new Error("reference query event is undefined");
                    }
                    return true;
                })
                .map((reference: Core.Protocol.QueryReferencesResponseItem) => {
                    return Core.Models.Event.fromBuffer(
                        Core.Models.SignedEvent.fromProto(reference.event!).event,
                    ).system;
                });

            if (cancelContext.cancelled()) { return; }

            setVouchedBy(vouchedBy);
        })();

        return () => {
            cancelContext.cancel();
        };
    }, [props.processHandle, props.view, props.parsedEvent]);

    function getClaimInfo(
        claimType: string,
        identifier: string,
    ): [React.ReactElement, string, string] | undefined {
        if (
            claimType == Core.Models.ClaimType.Twitter
        ) {
            return [
                (<TwitterIcon />),
                "Twitter",
                `https://twitter.com/${identifier}`,
            ];
        } else if (
            claimType == Core.Models.ClaimType.YouTube
        ) {
            return [
                (<YouTubeIcon />),
                "YouTube",
                `https://youtube.com/${identifier}`,
            ];
        } else if (
            claimType == Core.Models.ClaimType.Rumble
        ) {
            return [
                (<YouTubeIcon />),
                "Rumble",
                `https://youtube.com/${identifier}`,
            ];
        } else if (
            claimType == Core.Models.ClaimType.Bitcoin
        ) {
            return [
                (<BitcoinIcon />),
                "Bitcoin",
                'https://www.blockchain.com/explorer/addresses/btc/' +
                `${identifier}`,
            ];
        } else if (
            claimType == Core.Models.ClaimType.Generic
        ) {
            return [
                (<FormatQuoteIcon />),
                identifier,
                '/',
            ];
        } else {
            return undefined;
        }
    }

    const claimInfo = getClaimInfo(
        props.parsedEvent.value.claimType,
        identifier,
    );

    if (!claimInfo) {
        return (<div />);
    }

    const [icon, claimType, url] = claimInfo;

    return (

        <div
        // Slightly rounded rectangle with logo on left and claim type in center of remaining space
        // Slim blue border around the whole thing (not just the icon)
        // Using tailwind
        >
            <div className="flex flex-row justify-around w-full border border-gray-200 rounded-md my-2 py-1.5">
                <div className="flex flex-row items-center justify-center w-1/6">
                    {icon}
                </div>
                <div className="flex flex-col items-center justify-center w-5/6">
                    <p className="text-lg font-bold">{claimType}</p>
                    <p className="text-sm">{identifier}</p>
                </div>
            </div>

            {vouchedBy.length > 0 && (
                <React.Fragment>
                    <p> Verified By: </p>

                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'row',
                            gap: '8px',
                        }}
                    >
                        {vouchedBy.map((system, idx) => (
                            <VouchedBy.VouchedBy
                                key={idx}
                                processHandle={props.processHandle}
                                system={system}
                                view={props.view}
                            />
                        ))}
                    </div>
                </React.Fragment>
            )}
        </div>
    );
}


