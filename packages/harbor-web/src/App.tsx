import * as MUI from '@mui/material';
import YouTubeIcon from '@mui/icons-material/YouTube';
import TwitterIcon from '@mui/icons-material/Twitter';
import * as React from 'react';
import * as Base64 from '@borderless/base64';
import Long from 'long';

import * as Core from 'polycentric-core';

const avatar = "https://pbs.twimg.com/profile_images/1382846958159663105/ltolfDyQ_400x400.jpg";

const system = new Core.Models.PublicKey(
    Long.UONE,
    Base64.decode('3RdWh8zPrK49DYyxBCpuL4M54jAfag0e8I_o8tzceXc'),
);

type ProfileProps = {
    name: string,
    description: string,
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
                src={avatar}
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

            <MUI.Paper
                elevation={3}
                style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: '20px',
                    paddingLeft: '10px',
                }}
            >
                <YouTubeIcon />
                <p
                    style={{
                        flex: '1',
                        textAlign: 'center',
                    }}
                >
                    YouTube
                </p>
            </MUI.Paper>

            <MUI.Paper
                elevation={3}
                style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingLeft: '10px',
                }}
            >
                <TwitterIcon />
                <p
                    style={{
                        flex: '1',
                        textAlign: 'center',
                    }}
                >
                    Twitter
                </p>
            </MUI.Paper>
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

    const load = async () => {
        const processHandle = await createProcessHandle();

        await Core.Synchronization.saveBatch(
            processHandle,
            await Core.APIMethods.getQueryIndex(
                'http://localhost:8081',
                system,
                [
                    new Long(Core.Models.ContentType.Description),
                    new Long(Core.Models.ContentType.Username),
                    new Long(Core.Models.ContentType.Claim),
                ]
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

        setProps({
            description: systemState.description(),
            name: systemState.username(),
        });
    };

    React.useEffect(() => {
        load();
    });

    return (
        <div
            style={{
                position: 'absolute',
                left: '0px',
                top: '0px',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                flexDirection: 'column',
            }}
        >
            { props && (
                <Profile
                    name={props.name}
                    description={props.description}
                />
            )}
        </div>
    );
}
