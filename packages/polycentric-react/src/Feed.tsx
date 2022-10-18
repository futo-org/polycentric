import React, { useState, useEffect, useRef } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import { Paper, LinearProgress } from '@mui/material';
import * as Lodash from 'lodash';

import * as Core from 'polycentric-core';
import Post from './Post';
import * as PostMod from './Post';
import ProfileCard from './ProfileCard';
import RecommendedProfiles from './RecommendedProfiles';
import * as ProfileUtil from './ProfileUtil';

import './Standard.css';

export async function eventToDisplayablePost(
    state: Core.DB.PolycentricState,
    profiles: Map<string, ProfileUtil.DisplayableProfile>,
    storageEvent: Core.Protocol.StorageTypeEvent,
    needPointersOut: Array<Core.Protocol.Pointer>,
): Promise<PostMod.DisplayablePost | undefined> {
    if (storageEvent.mutationPointer !== undefined) {
        return undefined;
    }

    if (storageEvent.event === undefined) {
        return undefined;
    }

    const event = storageEvent.event;

    const body = Core.Protocol.EventBody.decode(event.content);

    if (body.message === undefined) {
        return undefined;
    }

    let displayableProfile = undefined;

    {
        const authorPublicKey = Base64.encodeUrl(event.authorPublicKey);
        let existing = profiles.get(authorPublicKey);

        if (existing === undefined) {
            displayableProfile = await ProfileUtil.loadProfileOrFallback(
                state,
                event.authorPublicKey,
            );

            profiles.set(authorPublicKey, displayableProfile);
        } else {
            displayableProfile = existing;
        }
    }

    const amAuthor = Core.Util.blobsEqual(
        (await Core.DB.levelLoadIdentity(state)).publicKey,
        event.authorPublicKey,
    );

    let displayable: PostMod.DisplayablePost = {
        pointer: {
            publicKey: event.authorPublicKey,
            writerId: event.writerId,
            sequenceNumber: event.sequenceNumber,
        },
        profile: displayableProfile,
        message: new TextDecoder().decode(body.message.message),
        unixMilliseconds: event.unixMilliseconds,
        author: amAuthor,
        boost: undefined,
    };

    if (body.message.boostPointer !== undefined) {
        const boost = await Core.DB.tryLoadStorageEventByPointer(
            state,
            body.message.boostPointer,
        );

        if (boost === undefined) {
            needPointersOut.push(body.message.boostPointer);
        } else {
            displayable.boost = await eventToDisplayablePost(
                state,
                profiles,
                boost,
                needPointersOut
            );
        }
    }

    if (body.message.image !== undefined) {
        const loaded = await Core.DB.loadBlob(
            state,
            body.message.image,
            needPointersOut,
        );

        if (loaded === undefined) {
            needPointersOut.push(body.message.image);
        } else {
            displayable.image = Core.Util.blobToURL(loaded.kind, loaded.blob);
        }
    }

    return displayable;
}

type LoadPostsResult = {
    filteredPosts: Array<[Core.Protocol.Event, PostMod.DisplayablePost]>;
    belowLimit: boolean;
    isFeedComplete: boolean;
};

async function loadPosts2(
    state: Core.DB.PolycentricState,
    decodedFeed: Core.Protocol.URLInfo | undefined,
    limit: number,
) {
    const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

    let posts: Array<Core.Protocol.StorageTypeEvent> = [];
    let postIndexes: Array<Uint8Array> = [];

    if (decodedFeed === undefined) {
        postIndexes = await state.levelIndexPostByTime
            .values({
                limit: limit,
                reverse: true,
            })
            .all();
    } else if (
        decodedFeed.writerId !== undefined &&
        decodedFeed.sequenceNumber !== undefined
    ) {
        postIndexes = [
            Core.DB.makeStorageTypeEventKey(
                decodedFeed.publicKey,
                decodedFeed.writerId,
                decodedFeed.sequenceNumber,
            ),
        ];
    } else {
        const minKey = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

        const maxKey = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);

        postIndexes = await state.levelIndexPostByAuthorByTime
            .values({
                gte: Core.DB.appendBuffers(decodedFeed.publicKey, minKey),
                lte: Core.DB.appendBuffers(decodedFeed.publicKey, maxKey),
                limit: limit,
                reverse: true,
            })
            .all();
    }

    let filteredPosts: [Core.Protocol.Event, PostMod.DisplayablePost][] = [];

    for (const index of postIndexes) {
        try {
            const post = await Core.DB.tryLoadStorageEventByKey(state, index);

            if (post === undefined) {
                continue;
            }

            if (
                decodedFeed === undefined &&
                post !== undefined &&
                post.event !== undefined
            ) {
                if (
                    state.identity !== undefined &&
                    Core.Util.blobsEqual(
                        state.identity.publicKey,
                        post.event.authorPublicKey,
                    ) === false
                ) {
                    const following = await Core.DB.levelAmFollowing(
                        state,
                        post.event.authorPublicKey,
                    );

                    if (following === false) {
                        continue;
                    }
                }
            }

            const displayable = await eventToDisplayablePost(
                state,
                profiles,
                post,
                []
            );

            if (displayable !== undefined && post.event !== undefined) {
                filteredPosts.push([post.event, displayable]);
            }
        } catch (err) {
            console.log(err);
        }
    }

    let isFeedComplete = true;

    if (decodedFeed !== undefined) {
        isFeedComplete = await Core.DB.isFeedComplete(
            state,
            decodedFeed.publicKey,
        );
    }

    return {
        filteredPosts: filteredPosts,
        belowLimit: postIndexes.length < limit,
        isFeedComplete: isFeedComplete,
    };
}

type FeedProps = {
    state: Core.DB.PolycentricState;
};

export function Feed(props: FeedProps) {
    const { feed } = useParams();
    const { ref, inView } = useInView();

    const decodedFeed = useRef<Core.Protocol.URLInfo | undefined>(undefined);
    const queryActive = useRef<boolean>(false);
    const limit = useRef<number>(10);

    const [queryResult, setQueryResult] = useState<LoadPostsResult | undefined>(
        undefined,
    );

    async function loadState(cancelControl: Core.Util.PromiseCancelControl) {
        const result = await loadPosts2(
            props.state,
            decodedFeed.current,
            limit.current,
        );

        if (cancelControl.cancelled === false) {
            setQueryResult(result);
        } else {
            console.log('Feed loadPosts was cancelled');
        }
    }

    useEffect(() => {
        const cancelControl = {
            cancelled: false,
        };

        window.scrollTo(0, 0);

        if (feed) {
            try {
                const decoded = Core.Protocol.URLInfo.decode(
                    new Uint8Array(Base64.decode(feed)),
                );

                decodedFeed.current = decoded;

                Core.Synchronization.loadServerHead(
                    props.state,
                    decodedFeed.current,
                );
            } catch (err) {
                console.log('failed to decode url');
            }
        } else {
            decodedFeed.current = undefined;
        }

        limit.current = 10;
        queryActive.current = false;

        const loadStateDebounce = Lodash.debounce(() => {
            console.log('calling debounce');
            loadState(cancelControl);
        }, 500);

        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            loadStateDebounce();
        };

        props.state.levelEvents.on('put', handlePut);

        loadState(cancelControl);

        return () => {
            cancelControl.cancelled = true;
            props.state.levelEvents.removeListener('put', handlePut);
        };
    }, [feed]);

    useEffect(() => {
        const cancelControl = {
            cancelled: false,
        };

        if (
            queryResult !== undefined &&
            queryResult.belowLimit === false &&
            inView === true
        ) {
            limit.current = limit.current + 10;

            loadState(cancelControl);
        }

        if (
            queryResult !== undefined &&
            queryResult.belowLimit === true &&
            inView === true &&
            queryResult.isFeedComplete === false &&
            decodedFeed.current !== undefined &&
            queryActive.current === false
        ) {
            queryActive.current = true;
            (async () => {
                // console.log('feed was incomplete fetching more');
                await Core.Synchronization.backfillClient(
                    props.state,
                    decodedFeed.current!,
                );
                // console.log('feed was incomplete finished fetch');
                queryActive.current = false;
                loadState(cancelControl);
            })();
        }

        return () => {
            cancelControl.cancelled = true;
        };
    }, [inView, feed, queryResult]);

    return (
        <div
            className="standard_width"
            style={{
                marginLeft: 'auto',
                marginRight: 'auto',
                marginTop: '15px',
                maxHeight: '100%',
                position: 'relative',
            }}
        >
            <>
                {decodedFeed.current !== undefined &&
                    decodedFeed.current.writerId === undefined && (
                        <div className="profilecard_position">
                            <ProfileCard
                                publicKey={decodedFeed.current.publicKey}
                                state={props.state}
                            />
                        </div>
                    )}

                {(decodedFeed.current == undefined ||
                    (decodedFeed.current !== undefined &&
                        decodedFeed.current.writerId === undefined)) && (
                    <div className="recommendedcard_position">
                        <RecommendedProfiles state={props.state} />
                    </div>
                )}

                {queryResult &&
                    queryResult.filteredPosts?.map((post) => {
                        const raw = post[0];
                        const item = post[1];

                        return (
                            <Post
                                key={Base64.encode(
                                    Core.DB.makeStorageTypeEventKey(
                                        raw.authorPublicKey,
                                        raw.writerId,
                                        raw.sequenceNumber,
                                    ),
                                )}
                                state={props.state}
                                post={item}
                                showBoost={true}
                                depth={0}
                            />
                        );
                    })}

                {queryResult && queryResult.filteredPosts.length === 0 && (
                    <Paper
                        elevation={4}
                        style={{
                            marginTop: '15px',
                            padding: '15px',
                            textAlign: 'center',
                            height: '100%',
                        }}
                    >
                        <h3> There does not appear to be anything here </h3>
                    </Paper>
                )}

                <div ref={ref} style={{ visibility: 'hidden' }}>
                    ..
                </div>

                {queryResult &&
                    (queryResult.belowLimit === false ||
                        queryResult.isFeedComplete === false) && (
                        <div
                            style={{
                                width: '80%',
                                marginBottom: '15px',
                                marginLeft: 'auto',
                                marginRight: 'auto',
                            }}
                        >
                            <LinearProgress />
                        </div>
                    )}
            </>
        </div>
    );
}

export default Feed;
