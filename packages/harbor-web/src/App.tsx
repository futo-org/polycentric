import * as MUI from '@mui/material';
import YouTubeIcon from '@mui/icons-material/YouTube';
import BitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import TwitterIcon from '@mui/icons-material/Twitter';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import * as React from 'react';
import * as Base64 from '@borderless/base64';
import Long from 'long';

import * as Core from 'polycentric-core';

const avatarFallback = "https://pbs.twimg.com/profile_images/1382846958159663105/ltolfDyQ_400x400.jpg";

type ClaimProps = {
    claim: Core.Protocol.Claim,
}

function Claim(props: ClaimProps) {
    const identifier = Core.Protocol.ClaimIdentifier.decode(
        props.claim.claim,
    ).identifier;

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

    const claimInfo = getClaimInfo(props.claim.claimType, identifier);

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
            <a
                style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingLeft: '10px',
                    color: 'black',
                    textDecoration: 'none',
                }}
                href={claimInfo[2]}
                target={"_blank"}
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
            </a>
        </MUI.Paper>
    );
}

type ProfileProps = {
    name: string,
    description: string,
    claims: Array<Core.Protocol.Claim>,
    avatar: string,
};

function Profile(props: ProfileProps) {
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
                src={props.avatar}
                style={{
                    display: 'block',
                    width: '100px',
                    height: '100px',
                }}
            />

            <p>
                {props.name}
            </p>

            <p>
                {props.description}
            </p>

            {props.claims.map((claim, idx) => (
                <Claim
                    key={idx}
                    claim={claim}
                />
            ))}
        </div>
    );
}

async function createProcessHandle():
    Promise<Core.ProcessHandle.ProcessHandle>
{
    return await Core.ProcessHandle.createProcessHandle(
        await Core.MetaStore.createMetaStore(
            Core.PersistenceDriver.createPersistenceDriverMemory(),
        ),
    );
}

export function App() {
    const [props, setProps] = React.useState<ProfileProps | undefined>(
        undefined
    );

    const load = async (
        cancelContext: Core.CancelContext.CancelContext,
    ) => {
        const system = new Core.Models.PublicKey(
            Long.UONE,
            Base64.decode(document.location.pathname.substr(1)),
        );

        const processHandle = await createProcessHandle();

        await Core.Synchronization.saveBatch(
            processHandle,
            await Core.APIMethods.getQueryIndex(
                'http://localhost:8081',
                system,
                [
                    new Long(Core.Models.ContentType.Description),
                    new Long(Core.Models.ContentType.Username),
                    new Long(Core.Models.ContentType.Avatar),
                ],
                undefined,
            )
        );

        await Core.Synchronization.saveBatch(
            processHandle,
            await Core.APIMethods.getQueryIndex(
                'http://localhost:8081',
                system,
                [
                    new Long(Core.Models.ContentType.Claim),
                ],
                10,
            )
        );

        const systemState = await processHandle.loadSystemState(system);

        const [claimEvents, _] = await processHandle.store().queryClaimIndex(
            system,
            10,
            undefined,
        );

        const claims = [];

        for (const protoSignedEvent of claimEvents) {
            const event = Core.Models.eventFromProtoBuffer(
                Core.Models.signedEventFromProto(protoSignedEvent).event(),
            )

            if (
                !event.contentType().equals(
                    new Long(Core.Models.ContentType.Claim)
                )
            ) {
                throw new Error("event content type was not claim");
            }

            claims.push(
                Core.Protocol.Claim.decode(event.content()),
            );
        }

        const avatar = await (async () => {
            const avatarPointer = systemState.avatar();

            if (avatarPointer) {
                const image = await processHandle.loadBlob(avatarPointer);

                if (image) {
                    const blob = new Blob([image.content()], {
                        type: image.mime(),
                    });

                    return URL.createObjectURL(blob);
                }

                console.log("failed to load blob");
            }

            return avatarFallback;
        })();

        if (cancelContext.cancelled()) { return; }

        setProps({
            description: systemState.description(),
            name: systemState.username(),
            claims: claims,
            avatar: avatar,
        });
    };

    React.useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        try {
            load(cancelContext);
        } catch (err) {
            console.error(err);
        }

        return () => {
            cancelContext.cancel();
        };
    }, []);

    return (
        <div
            style={{
                position: 'absolute',
                left: '0px',
                top: '0px',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
                backgroundColor: '#f9e8d0',
            }}
        >
            { props && (
                <Profile
                    name={props.name}
                    description={props.description}
                    claims={props.claims}
                    avatar={props.avatar}
                />
            )}
        </div>
    );
}
