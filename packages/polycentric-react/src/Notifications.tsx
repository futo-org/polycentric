import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import * as Lodash from 'lodash';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import Post from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';
import ProfileHeader from './ProfileHeader';
import * as Search from './Search';

type NotificationsProps = {
    state: Core.DB.PolycentricState;
};

function Notifications(props: NotificationsProps) {
    const { ref, inView } = useInView();

    const [notificationResults, setNotificationResults] = useState<
        [string, Core.Protocol.Pointer][]
    >([]);

    const [loading, setLoading] = useState<boolean>(true);

    const largestIndexByServer = useRef<Map<string, number>>(new Map());
    const complete = useRef<boolean>(false);

    const handleLoad = async () => {
        setLoading(true);

        const identity = await Core.DB.levelLoadIdentity(props.state);
        const profile = await Core.DB.loadProfile(props.state);
        let progress = false;

        for (const server of profile.servers) {
            try {
                const address = new TextDecoder().decode(server);
                let largestIndex = largestIndexByServer.current.get(address);

                const response = await Core.APIMethods.fetchPostNotifications(
                    address,
                    {
                        publicKey: identity.publicKey,
                        afterIndex: largestIndex,
                    },
                );

                await Core.Synchronization.saveBatch(
                    props.state,
                    response.relatedEvents,
                );

                await Core.Synchronization.saveBatch(
                    props.state,
                    response.resultEvents,
                );

                if (
                    response.largestIndex !== undefined &&
                    (largestIndex == undefined ||
                        largestIndex < response.largestIndex)
                ) {
                    largestIndexByServer.current.set(
                        address,
                        response.largestIndex,
                    );
                }

                let filteredPosts: [string, Core.Protocol.Pointer][] = [];

                for (const event of response.resultEvents) {
                    filteredPosts.push([
                        address,
                        {
                            publicKey: event.authorPublicKey,
                            writerId: event.writerId,
                            sequenceNumber: event.sequenceNumber,
                        },
                    ]);
                }

                setNotificationResults(
                    notificationResults.concat(filteredPosts),
                );

                if (filteredPosts.length !== 0) {
                    progress = true;
                }
            } catch (err) {
                console.log(err);
                progress = true;
            }
        }

        if (progress === false) {
            complete.current = true;
        }

        setLoading(false);
    };

    const handleLoadDebounce = useCallback(
        Lodash.debounce(() => {
            console.log('calling debounce');
            handleLoad();
        }, 5000, { leading: true })
    , []);

    useEffect(() => {
        largestIndexByServer.current = new Map();
        complete.current = false;

        handleLoadDebounce();
    }, []);

    useEffect(() => {
        if (
            loading === false &&
            inView === true &&
            complete.current === false
        ) {
            handleLoadDebounce();
        }
    }, [loading, inView]);

    return (
        <div className="standard_width">
            {notificationResults.map((post) => {
                const raw = post[0];
                const item = post[1];

                return (
                    <Search.DispatchCard
                        key={Base64.encode(
                            Core.DB.makeStorageTypeEventKey(
                                item.publicKey,
                                item.writerId,
                                item.sequenceNumber,
                            ),
                        )}
                        state={props.state}
                        pointer={item}
                        fromServer={raw}
                    />
                );
            })}

            {notificationResults.length === 0 && (
                <Paper
                    elevation={4}
                    style={{
                        marginTop: '15px',
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3>
                        You don't appear to have any notifications.
                    </h3>
                </Paper>
            )}

            <div ref={ref} style={{ visibility: 'hidden' }}>
                ..
            </div>

            {loading && (
                <div
                    style={{
                        width: '80%',
                        marginTop: '15px',
                        marginBottom: '15px',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                    }}
                >
                    <LinearProgress />
                </div>
            )}
        </div>
    );
}

export default Notifications;
