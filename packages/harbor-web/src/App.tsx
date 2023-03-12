import * as MUI from '@mui/material';
import YouTubeIcon from '@mui/icons-material/YouTube';
import BitcoinIcon from '@mui/icons-material/CurrencyBitcoin';
import TwitterIcon from '@mui/icons-material/Twitter';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import * as React from 'react';
import * as Base64 from '@borderless/base64';
import Long from 'long';
import * as ReactRouterDOM from 'react-router-dom';

import * as Core from 'polycentric-core';

const server = 'http://localhost:8081';

type Profile = {
    avatar: string;
    username: string;
    link: string;
}

type ClaimProps = {
    claim: Core.Protocol.Claim,
    vouchedBy: Array<Profile>,
}

function Claim(props: ClaimProps) {
    const navigate = ReactRouterDOM.useNavigate();

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

                { props.vouchedBy.length > 0 && (
                    <React.Fragment>
                        <p> Verified By: </p>

                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'row',
                                gap: '8px',
                            }}
                        >
                            {props.vouchedBy.map((vouchedBy, idx) => (
                                <MUI.Avatar
                                    key={idx}
                                    src={vouchedBy.avatar}
                                    alt={vouchedBy.username}
                                    onClick={() => {
                                        navigate('/' + vouchedBy.link);
                                    }}
                                />
                            ))}
                        </div>
                    </React.Fragment>
                )}
            </div>
        </MUI.Paper>
    );
}

type ProfileProps = {
    name: string,
    description: string,
    claims: Array<ClaimProps>,
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
                    claim={claim.claim}
                    vouchedBy={claim.vouchedBy}
                />
            ))}
        </div>
    );
}

async function loadImageFromPointer(
    processHandle: Core.ProcessHandle.ProcessHandle,
    pointer: Core.Models.Pointer.Pointer,
) {
    await Core.Synchronization.saveBatch(
        processHandle,
        await Core.APIMethods.getEvents(server, pointer.system, {
            rangesForProcesses: [
                {
                    process: pointer.process, 
                    ranges: [
                        {
                            low: pointer.logicalClock,
                            high: pointer.logicalClock.add(Long.UONE),
                        },
                    ],
                },
            ],
        }),
    );

    const image = await processHandle.loadBlob(pointer);

    if (image) {
        const blob = new Blob([image.content()], {
            type: image.mime(),
        });

        return URL.createObjectURL(blob);
    }

    console.log("failed to load blob");

    return '';
}

async function loadMinimalProfile(
    processHandle: Core.ProcessHandle.ProcessHandle,
    system: Core.Models.PublicKey.PublicKey,
): Promise<Profile> {
    await Core.Synchronization.saveBatch(
        processHandle,
        await Core.APIMethods.getQueryIndex(
            server,
            system,
            [
                Core.Models.ContentType.ContentTypeDescription,
                Core.Models.ContentType.ContentTypeUsername,
                Core.Models.ContentType.ContentTypeAvatar,
            ],
            undefined,
        )
    );

    const systemState = await processHandle.loadSystemState(system);

    const avatar = await (async () => {
        const pointer = systemState.avatar();

        if (pointer) {
            return await loadImageFromPointer(
                processHandle,
                pointer,
            );
        }

        return '';
    })();

    return {
        avatar: avatar,
        username: systemState.username(),
        link: Base64.encodeUrl(
            Core.Protocol.PublicKey.encode(
                system,
            ).finish(),
        ),
    };
}

type MainPageProps = {
    processHandle: Core.ProcessHandle.ProcessHandle,
}

export function MainPage(props: MainPageProps) {
    const { system: systemQuery } = ReactRouterDOM.useParams();

    const [profileProps, setProfileProps] =
        React.useState<ProfileProps | undefined>(undefined);

    const load = async (
        cancelContext: Core.CancelContext.CancelContext,
    ) => {
        const system = Core.Models.PublicKey.fromProto(
            Core.Protocol.PublicKey.decode(
                Base64.decode(systemQuery!),
            ),
        );

        await Core.Synchronization.saveBatch(
            props.processHandle,
            await Core.APIMethods.getQueryIndex(
                server,
                system,
                [
                    Core.Models.ContentType.ContentTypeDescription,
                    Core.Models.ContentType.ContentTypeUsername,
                    Core.Models.ContentType.ContentTypeAvatar,
                ],
                undefined,
            )
        );

        await Core.Synchronization.saveBatch(
            props.processHandle,
            await Core.APIMethods.getQueryIndex(
                server,
                system,
                [
                    Core.Models.ContentType.ContentTypeClaim,
                ],
                10,
            )
        );

        const systemState = await props.processHandle.loadSystemState(system);

        const [claimEvents, _] =
            await props.processHandle.store().queryClaimIndex(
                system,
                10,
                undefined,
            );

        const avatar = await (async () => {
            const pointer = systemState.avatar();

            if (pointer) {
                return await loadImageFromPointer(
                    props.processHandle,
                    pointer,
                );
            }

            return '';
        })();

        const claims = [];

        for (const protoSignedEvent of claimEvents) {
            const event = Core.Models.Event.fromBuffer(
                Core.Models.SignedEvent.fromProto(protoSignedEvent).event,
            )

            if (
                !event.contentType.equals(
                    Core.Models.ContentType.ContentTypeClaim,
                )
            ) {
                throw new Error("event content type was not claim");
            }

            const references = await Core.APIMethods.getQueryReferences(
                server,
                system,
                event.process,
                event.logicalClock,
                Core.Models.ContentType.ContentTypeVouch,
            );

            console.log("got references count", references.events.length);

            const vouchedBy = [];

            for (const reference of references.events) {
                const event = Core.Models.Event.fromBuffer(
                    Core.Models.SignedEvent.fromProto(reference).event,
                )

                vouchedBy.push(await loadMinimalProfile(
                    props.processHandle,
                    event.system,
                ));
            };

            claims.push(
                {
                    claim: Core.Protocol.Claim.decode(event.content),
                    vouchedBy: vouchedBy,
                }
            );
        }

        if (cancelContext.cancelled()) { return; }

        setProfileProps({
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
    }, [props.processHandle, systemQuery]);

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
            { profileProps && (
                <Profile
                    {...profileProps}
                />
            )}
        </div>
    );
}

type AppProps = {
    processHandle: Core.ProcessHandle.ProcessHandle,
}

export function App(props: AppProps) {
    const Routes = () => (
        <ReactRouterDOM.Routes>
            <ReactRouterDOM.Route
                path="/:system"
                element={
                    <MainPage
                        processHandle={props.processHandle}
                    />
                }
            />
        </ReactRouterDOM.Routes>
    );

    return (
        <ReactRouterDOM.BrowserRouter>
            <Routes />
        </ReactRouterDOM.BrowserRouter>
    );
}
