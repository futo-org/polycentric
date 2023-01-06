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
import * as FeedState from './FeedState';
import * as Scroll from './scroll';

type BlobWithLink = {
    blob: Blob;
    link: string;
};

export class Cache {
    private _images: Map<string, BlobWithLink>;

    public constructor() {
        this._images = new Map();
    }

    public getImageLink(pointer: Core.Protocol.Pointer): string | undefined {
        const key = Feed.pointerGetKey(pointer);

        const item = this._images.get(key);

        if (item === undefined) {
            return undefined;
        }

        return item.link;
    }

    public addImage(pointer: Core.Protocol.Pointer, blob: Blob): string {
        const key = Feed.pointerGetKey(pointer);

        const item = this._images.get(key);

        if (item !== undefined) {
            return item.link;
        }

        const link = URL.createObjectURL(blob);

        this._images.set(key, {
            blob: blob,
            link: link,
        });

        return link;
    }

    public free(): void {
        for (const item of this._images.values()) {
            URL.revokeObjectURL(item.link);
        }

        this._images = new Map();
    }
}

type ExploreProps = {
    state: Core.DB.PolycentricState;
};

type ExploreItem = {
    key: string;
    initialPost: Post.DisplayablePost;
    dependencyContext: Core.DB.DependencyContext;
    generation: number;
};

export const ExploreMemo = memo(Explore);

function Explore(props: ExploreProps) {
    const [ref, inView] = useInView();

    const [exploreResults, setExploreResults] = useState<
        Array<FeedState.FeedItem>
    >(new Array());

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);
    const scrollPercent = Scroll.useScrollPercentage();

    const earliestTime = useRef<number | undefined>(undefined);

    const cache = useRef<Cache>(new Cache());

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
                const pointer = {
                    publicKey: event.authorPublicKey,
                    writerId: event.writerId,
                    sequenceNumber: event.sequenceNumber,
                };

                await FeedState.loadFeedItem(
                    props.state,
                    cancelContext,
                    cache.current,
                    pointer,
                    0,
                    (cb) => {
                        setExploreResults((previous) => {
                            return cb(previous);
                        });
                    },
                    async (item) => {
                        item.fromServer = response[0];
                        return item;
                    },
                    (previous, item) => {
                        return previous.concat([item]);
                    },
                );

                progress = true;
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

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setInitial(true);
        setExploreResults([]);
        setLoading(false);
        setComplete(false);

        earliestTime.current = undefined;
        masterCancel.current = cancelContext;
        cache.current = new Cache();

        return () => {
            cancelContext.cancel();

            for (const item of exploreResults) {
                item.dependencyContext.cleanup();
            }

            cache.current.free();
        };
    }, [props.state]);

    useEffect(() => {
        if (loading === true || complete === true) {
            return;
        }

        const scroll = Scroll.calculateScrollPercentage();

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
                    key={item.key}
                    ref={index === exploreResults.length - 1 ? ref : undefined}
                >
                    { item.post && (
                        <Post.PostMemo
                            state={props.state}
                            post={item.post}
                            showBoost={true}
                            depth={0}
                        />
                    )}
                </div>
            ))}

            {initial === false && FeedState.noneVisible(exploreResults) && (
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
