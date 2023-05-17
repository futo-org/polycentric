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
            const references = await Core.APIMethods.getQueryReferences(
                App.server,
                props.parsedEvent.event.system,
                props.parsedEvent.event.process,
                props.parsedEvent.event.logicalClock,
                Core.Models.ContentType.ContentTypeVouch,
            );

            console.log("got references count", references.events.length);

            const vouchedBy = references.events.map((reference) => {
                return Core.Models.Event.fromBuffer(
                    Core.Models.SignedEvent.fromProto(reference).event,
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

    return (
        <MUI.Paper
            elevation={3}
            style={{
                width: '100%',
                marginBottom: '10px',
           }}
           sx={{
                backgroundColor: '#eeca97',
                ':hover': {
                    backgroundColor: '#eec385',
                },
            }}
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    paddingLeft: '10px',
                    paddingBottom: '10px',
                    color: 'black',
                    textDecoration: 'none',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                    }}
                >
                    {claimInfo[0]}
                    <p
                        style={{
                            flex: '1',
                            textAlign: 'center',
                        }}
                    >
                        {claimInfo[1]}
                    </p>
                </div>

                { vouchedBy.length > 0 && (
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
        </MUI.Paper>
    );
}


