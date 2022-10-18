import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, useRef, ReactNode } from 'react';
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

function Explore(props: ExploreProps) {
    const { ref, inView } = useInView();

    const [exploreResults, setExploreResults] = useState<
        [string, Core.Protocol.Pointer][]
    >([]);

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);

    const earliestTime = useRef<number | undefined>(undefined);
    const complete = useRef<boolean>(false);

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

        let filteredPosts: [string, Core.Protocol.Pointer][] = [];

        for (const response of responses) {
            for (const event of response[1].resultEvents) {
                filteredPosts.push([
                    response[0],
                    {
                        publicKey: event.authorPublicKey,
                        writerId: event.writerId,
                        sequenceNumber: event.sequenceNumber,
                    },
                ]);
            }
        }

        setExploreResults(exploreResults.concat(filteredPosts));

        if (filteredPosts.length === 0) {
            complete.current = true;
        }

        setLoading(false);
        setInitial(false);
    };

    useEffect(() => {
        setInitial(true);
        setExploreResults([]);
        setLoading(true);

        earliestTime.current = undefined;
        complete.current = false;

        handleLoad();
    }, []);

    return (
        <div className="standard_width">
            <InfiniteScroll
                dataLength={exploreResults.length}
                next={handleLoad}
                hasMore={complete.current === false}
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
                {exploreResults.map((post) => {
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
