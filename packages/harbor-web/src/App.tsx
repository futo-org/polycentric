import * as MUI from '@mui/material';
import * as React from 'react';
import * as Base64 from '@borderless/base64';
import Long from 'long';
import * as ReactRouterDOM from 'react-router-dom';

import * as Core from 'polycentric-core';

import * as Profile from './Profile';
import * as VouchedBy from './VouchedBy';
import * as Claim from './Claim';

// export const server = 'http://localhost:8081';
export const server = 'https://srv1-stg.polycentric.io';

export class ParsedEvent<T> {
    signedEvent: Core.Models.SignedEvent.SignedEvent;
    event: Core.Models.Event.Event;
    value: T;

    constructor(
        signedEvent: Core.Models.SignedEvent.SignedEvent,
        event: Core.Models.Event.Event,
        value: T,
    ) {
        this.signedEvent = signedEvent;
        this.event = event;
        this.value = value;
    }
}

export async function loadImageFromPointer(
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

type MainPageProps = {
    processHandle: Core.ProcessHandle.ProcessHandle,
    view: Core.View.View,
}

const decodeSystemQuery = (raw: string) => {
    return Core.Models.PublicKey.fromProto(
        Core.Protocol.PublicKey.decode(
            Base64.decode(raw),
        ),
    );
};

export function MainPage(props: MainPageProps) {
    const { system: systemQuery } = ReactRouterDOM.useParams();

    const [system, setSystem] =
        React.useState<Core.Models.PublicKey.PublicKey | undefined>();

    React.useEffect(() => {
        if (systemQuery) {
            try {
                setSystem(decodeSystemQuery(systemQuery));
            } catch (_) {
                setSystem(undefined);
            }
        } else {
            setSystem(undefined);
        }
    }, [systemQuery]);

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
            { system
                ? 
                    <Profile.Profile
                        processHandle={props.processHandle}
                        view={props.view}
                        system={system}
                    />
                :
                    <h1>Failed to decode URL</h1>
            }
        </div>
    );
}

type AppProps = {
    processHandle: Core.ProcessHandle.ProcessHandle,
    view: Core.View.View,
}

export function App(props: AppProps) {
    const Routes = () => (
        <ReactRouterDOM.Routes>
            <ReactRouterDOM.Route
                path="/:system"
                element={
                    <MainPage
                        processHandle={props.processHandle}
                        view={props.view}
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
