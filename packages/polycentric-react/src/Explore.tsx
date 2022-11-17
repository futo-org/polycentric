import { Paper, TextField, LinearProgress } from '@mui/material';
import { useState, useEffect, useRef, ReactNode, memo } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';

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
    const [ref, inView] = useInView();

    const [exploreResults, setExploreResults] = useState<Array<ExploreItem>>(
        [],
    );

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);
    const [scrollPercent, setScrollPercent] = useState<number>(0);

    const earliestTime = useRef<number | undefined>(undefined);

    const masterCancel = useRef<Core.CancelContext.CancelContext>(
        new Core.CancelContext.CancelContext(),
    );

    const handleLoad = async (
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> => {
        if (cancelContext.cancelled()) {
            return;
        }

        setLoading(true);

        // const t1 = performance.now();

        const responses = await Core.DB.explore(
            props.state,
            earliestTime.current,
        );

        /*
        console.log(
            'explore: fetching from server took',
            performance.now() - t1,
        );
        */

        if (cancelContext.cancelled()) {
            return;
        }

        // const t2 = performance.now();

        for (const response of responses) {
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].relatedEvents,
            );
            await Core.Synchronization.saveBatch(
                props.state,
                response[1].resultEvents,
            );

            if (cancelContext.cancelled()) {
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

        /*
        console.log(
            'explore: saving from server took', performance.now() - t2
        );
        */

        // const t3 = performance.now();

        let progress = false;

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

                progress = true;

                const exploreItem = {
                    initialPost: displayable,
                    dependencyContext: dependencyContext,
                };

                if (cancelContext.cancelled()) {
                    dependencyContext.cleanup();

                    return;
                }

                setExploreResults((previous) => {
                    return previous.concat([exploreItem]);
                });
            }
        }

        /*
        console.log(
            'explore: loading from storage took',
            performance.now() - t3,
        );
        */

        if (cancelContext.cancelled()) {
            return;
        }

        if (progress === false) {
            setComplete(true);
        }

        setLoading(false);
        setInitial(false);
    };

    const calculateScrollPercentage = (): number => {
        const h = document.documentElement;
        const b = document.body;
        const st = 'scrollTop';
        const sh = 'scrollHeight';

        return ((h[st] || b[st]) / ((h[sh] || b[sh]) - h.clientHeight)) * 100;
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setInitial(true);
        setExploreResults([]);
        setLoading(false);
        setComplete(false);

        earliestTime.current = undefined;
        masterCancel.current = cancelContext;

        const updateScrollPercentage = () => {
            if (cancelContext.cancelled()) {
                return;
            }

            setScrollPercent(calculateScrollPercentage());
        };

        window.addEventListener('scroll', updateScrollPercentage);

        return () => {
            window.removeEventListener('scroll', updateScrollPercentage);

            cancelContext.cancel();

            for (const item of exploreResults) {
                item.dependencyContext.cleanup();
            }
        };
    }, [props.state]);

    useEffect(() => {
        if (loading === true || complete === true) {
            return;
        }

        const scroll = calculateScrollPercentage();

        if (inView === true || initial === true || scroll >= 80) {
            /*
            console.log(
                "calling load",
                "inView", inView,
                "initial", initial,
                "scrollPercent", scroll,
                "loading", loading,
                "complete", complete,
            );
            */

            handleLoad(masterCancel.current);
        }
    }, [props.state, inView, complete, scrollPercent, loading]);

    return (
        <div
            className="standard_width"
            style={{
                position: 'relative',
            }}
        >
            {exploreResults.map((item, index) => (
                <div
                    key={index}
                    ref={index === exploreResults.length - 1 ? ref : undefined}
                >
                    <Post.PostLoaderMemo
                        state={props.state}
                        pointer={item.initialPost.pointer}
                        initialPost={item.initialPost}
                        dependencyContext={item.dependencyContext}
                        showBoost={true}
                        depth={0}
                    />
                </div>
            ))}

            {initial === false && exploreResults.length === 0 && (
                <Paper
                    elevation={4}
                    style={{
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3> There does not appear to be anything to explore. </h3>
                </Paper>
            )}

            {loading === true && (
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

export default Explore;
