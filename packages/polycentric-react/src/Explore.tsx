import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, useRef, ReactNode, memo } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import InfiniteScroll from 'react-infinite-scroll-component';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import Post from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';
import ProfileHeader from './ProfileHeader';
import * as Search from './Search';

type ExploreProps = {
    state: Core.DB.PolycentricState;
};

const DispatchCardMemo = memo(Search.DispatchCard);

type ExploreItem = {
    fromServer: string;
    key: string;
    pointer: Core.Protocol.Pointer;
};

function Explore(props: ExploreProps) {
    const { ref, inView } = useInView();

    const [exploreResults, setExploreResults] = useState<Array<ExploreItem>>(
        [],
    );

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);

    const earliestTime = useRef<number | undefined>(undefined);

    const handleLoad = async () => {
        setLoading(true);

        const responses = await Core.DB.explore(
            props.state,
            earliestTime.current,
        );

        for (const response of responses) {
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].relatedEvents,
            );
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].resultEvents,
            );

            for (const event of response[1].resultEvents) {
                if (
                    earliestTime.current === undefined ||
                    earliestTime.current > event.unixMilliseconds
                ) {
                    earliestTime.current = event.unixMilliseconds;
                }
            }
        }

        let filteredPosts: Array<ExploreItem> = [];

        for (const response of responses) {
            for (const event of response[1].resultEvents) {
                filteredPosts.push({
                    fromServer: response[0],
                    key: Base64.encode(
                        Core.DB.makeStorageTypeEventKey(
                            event.authorPublicKey,
                            event.writerId,
                            event.sequenceNumber,
                        ),
                    ),
                    pointer: {
                        publicKey: event.authorPublicKey,
                        writerId: event.writerId,
                        sequenceNumber: event.sequenceNumber,
                    },
                });
            }
        }

        const totalResults = exploreResults.concat(filteredPosts);

        console.log('total', totalResults.length, 'new', filteredPosts.length);

        setExploreResults(totalResults);

        if (filteredPosts.length === 0) {
            setComplete(true);
        }

        setLoading(false);
        setInitial(false);
    };

    useEffect(() => {
        setInitial(true);
        setExploreResults([]);
        setLoading(true);
        setComplete(false);

        earliestTime.current = undefined;

        handleLoad();
    }, []);

    return (
        <div className="standard_width">
            <InfiniteScroll
                dataLength={exploreResults.length}
                next={handleLoad}
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
                endMessage={
                    <div
                        style={{
                            marginTop: '15px',
                        }}
                    ></div>
                }
            >
                {exploreResults.map((item, index) => (
                    <DispatchCardMemo
                        key={index}
                        state={props.state}
                        pointer={item.pointer}
                        fromServer={item.fromServer}
                    />
                ))}
            </InfiniteScroll>

            {initial === false && exploreResults.length === 0 && (
                <Paper
                    elevation={4}
                    style={{
                        marginTop: '15px',
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3> There does not appear to be anything to explore. </h3>
                </Paper>
            )}
        </div>
    );
}

export default Explore;
