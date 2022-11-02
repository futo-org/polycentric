import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import * as Lodash from 'lodash';
import InfiniteScroll from 'react-infinite-scroll-component';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import Post from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';
import ProfileHeader from './ProfileHeader';
import { DispatchCard } from './DispatchCard';

type NotificationsProps = {
    state: Core.DB.PolycentricState;
};

type Item = {
    fromServer: string;
    pointer: Core.Protocol.Pointer;
};

function Notifications(props: NotificationsProps) {
    const [notificationResults, setNotificationResults] = useState<Array<Item>>(
        [],
    );

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);

    const largestIndexByServer = useRef<Map<string, number>>(new Map());

    const masterCancel = useRef<Core.CancelContext.CancelContext>(
        new Core.CancelContext.CancelContext(),
    );

    const handleLoad = async (
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> => {
        setLoading(true);

        const identity = await Core.DB.levelLoadIdentity(props.state);
        const profile = await Core.DB.loadProfile(props.state);
        let progress = false;

        if (cancelContext.cancelled()) {
            return;
        }

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

                let filteredPosts: Array<Item> = [];

                for (const event of response.resultEvents) {
                    filteredPosts.push({
                        fromServer: address,
                        pointer: {
                            publicKey: event.authorPublicKey,
                            writerId: event.writerId,
                            sequenceNumber: event.sequenceNumber,
                        },
                    });
                }

                if (cancelContext.cancelled()) {
                    return;
                }

                if (filteredPosts.length !== 0) {
                    setNotificationResults((old) => {
                        return old.concat(filteredPosts);
                    });
                }

                if (filteredPosts.length !== 0) {
                    progress = true;
                }
            } catch (err) {
                console.log(err);
                progress = true;
            }
        }

        if (cancelContext.cancelled()) {
            return;
        }

        if (progress === false) {
            setComplete(true);
        }

        setLoading(false);
        setInitial(false);
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setNotificationResults([]);
        setLoading(true);
        setInitial(true);
        setComplete(false);

        largestIndexByServer.current = new Map();
        masterCancel.current = cancelContext;

        handleLoad(cancelContext);

        return () => {
            cancelContext.cancel();
        };
    }, [props.state]);

    return (
        <div className="standard_width">
            <InfiniteScroll
                dataLength={notificationResults.length}
                next={() => {
                    handleLoad(masterCancel.current);
                }}
                hasMore={complete === false}
                loader={
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
                }
                endMessage={<div></div>}
            >
                {notificationResults.map((item, index) => {
                    return (
                        <DispatchCard
                            key={index}
                            state={props.state}
                            pointer={item.pointer}
                            fromServer={item.fromServer}
                        />
                    );
                })}
            </InfiniteScroll>

            {initial === false && notificationResults.length === 0 && (
                <Paper
                    elevation={4}
                    style={{
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3>You don't appear to have any notifications.</h3>
                </Paper>
            )}
        </div>
    );
}

export default Notifications;
