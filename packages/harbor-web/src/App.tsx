import * as React from 'react';
import * as Base64 from '@borderless/base64';
import Long from 'long';
import * as ReactRouterDOM from 'react-router-dom';
import * as Core from '@polycentric/polycentric-core';
import * as Profile from './Profile';

export const server = 'http://localhost:8081';
// export const server = 'https://srv1-stg.polycentric.io';

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
        className="flex justify-center bg-gray min-h-screen dark:bg-zinc-800"
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
