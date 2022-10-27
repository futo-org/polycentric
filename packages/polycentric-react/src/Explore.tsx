import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, useRef, ReactNode, memo } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import InfiniteScroll from 'react-infinite-scroll-component';

import * as Core from 'polycentric-core';
import * as Feed from './Feed';
import * as PostMod from './Post';
import './Standard.css';
import * as ProfileUtil from './ProfileUtil';
import ProfileHeader from './ProfileHeader';
import * as Search from './Search';
import { DispatchCardMemo } from './DispatchCard';
import * as Post from './Post';

type ExploreProps = {
    state: Core.DB.PolycentricState;
};

type ExploreItem = {
    initialPost: Post.DisplayablePost;
    dependencyContext: Core.DB.DependencyContext;
};

export const ExploreMemo = memo(Explore);

function Explore(props: ExploreProps) {
    const { ref, inView } = useInView();

    const [exploreResults, setExploreResults] = useState<Array<ExploreItem>>(
        [],
    );

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);

    const earliestTime = useRef<number | undefined>(undefined);
    const masterCancel = useRef<Core.Util.PromiseCancelControl>({
        cancelled: false,
    });

    const handleLoad = async (
        cancelControl: Core.Util.PromiseCancelControl,
    ) => {
        if (cancelControl.cancelled) {
            return;
        }

        setLoading(true);

        const responses = await Core.DB.explore(
            props.state,
            earliestTime.current,
        );

        if (cancelControl.cancelled) {
            return;
        }

        for (const response of responses) {
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].relatedEvents,
            );
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].resultEvents,
            );

            if (cancelControl.cancelled) {
                return;
            }

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
                const dependencyContext = new Core.DB.DependencyContext(
                    props.state,
                );

                const displayable = await Post.tryLoadDisplayable(
                    props.state,
                    {
                        publicKey: event.authorPublicKey,
                        writerId: event.writerId,
                        sequenceNumber: event.sequenceNumber,
                    },
                    dependencyContext,
                );

                if (displayable === undefined) {
                    dependencyContext.cleanup();

                    continue;
                }

                displayable.fromServer = response[0];

                filteredPosts.push({
                    initialPost: displayable,
                    dependencyContext: dependencyContext,
                });
            }
        }

        if (cancelControl.cancelled) {
            for (const item of filteredPosts) {
                item.dependencyContext.cleanup();
            }

            return;
        }

        setExploreResults((previous) => {
            const totalResults = previous.concat(filteredPosts);

            console.log(
                'total',
                totalResults.length,
                'new',
                filteredPosts.length,
            );

            return totalResults;
        });

        if (filteredPosts.length === 0) {
            setComplete(true);
        }

        setLoading(false);
        setInitial(false);
    };

    useEffect(() => {
        const cancelControl = {
            cancelled: false,
        };

        setInitial(true);
        setExploreResults([]);
        setLoading(true);
        setComplete(false);

        earliestTime.current = undefined;
        masterCancel.current = cancelControl;

        handleLoad(cancelControl);

        return () => {
            cancelControl.cancelled = true;

            for (const item of exploreResults) {
                item.dependencyContext.cleanup();
            }
        };
    }, [props.state]);

    return (
        <div className="standard_width">
            <InfiniteScroll
                dataLength={exploreResults.length}
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
                endMessage={
                    <div
                        style={{
                            marginTop: '15px',
                        }}
                    ></div>
                }
            >
                {exploreResults.map((item, index) => (
                    <Post.PostLoaderMemo
                        key={index}
                        state={props.state}
                        initialPost={item.initialPost}
                        dependencyContext={item.dependencyContext}
                        showBoost={true}
                        depth={0}
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
