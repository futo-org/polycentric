import React, { useState, useEffect, useRef, memo } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { Paper, LinearProgress } from '@mui/material';
import * as Lodash from 'lodash';
import InfiniteScroll from 'react-infinite-scroll-component';
import Long from 'long';
import { useInView } from 'react-intersection-observer';
import * as SortedArrayFunctions from 'sorted-array-functions';

import * as Core from 'polycentric-core';
import * as Post from './Post';
import ProfileCard from './ProfileCard';
import RecommendedProfiles from './RecommendedProfiles';
import * as ProfileUtil from './ProfileUtil';
import * as FeedForThread from './FeedForThread';
import * as FeedForProfile from './FeedForProfile';
import * as FeedForTimeline from './FeedForTimeline';
import * as Explore from './Explore';

import './Standard.css';

type ExploreItem = {
    initialPost: Post.DisplayablePost;
    dependencyContext: Core.DB.DependencyContext;
    key: string;
};

type KeyByAuthorByTime = {
    publicKey: Uint8Array;
    time: Number;
};

export function parseKeyByAuthorByTime(buffer: Uint8Array): KeyByAuthorByTime {
    if (buffer.byteLength !== 32 + 8) {
        throw new Error('buffer was not correct size');
    }

    const result: KeyByAuthorByTime = {
        publicKey: buffer.slice(0, 32),
        time: Long.fromBytesBE(
            Array.from(buffer.slice(32, 40)),
            true,
        ).toNumber(),
    };

    return result;
}

export function eventGetKey(event: Core.Protocol.Event): string {
    return Base64.encode(
        Core.Keys.pointerToKey({
            publicKey: event.authorPublicKey,
            writerId: event.writerId,
            sequenceNumber: event.sequenceNumber,
        }),
    );
}

export function pointerGetKey(pointer: Core.Protocol.Pointer): string {
    return Base64.encode(Core.Keys.pointerToKey(pointer));
}

export type FeedProps = {
    state: Core.DB.PolycentricState;
};

export function Feed(props: FeedProps) {
    const { feed } = useParams();

    const [decodedFeed, setDecodedFeed] = useState<
        Core.Protocol.URLInfo | undefined
    >(undefined);

    useEffect(() => {
        window.scrollTo(0, 0);

        if (feed) {
            try {
                const decoded = Core.Protocol.URLInfo.decode(
                    new Uint8Array(Base64.decode(feed)),
                );

                setDecodedFeed(decoded);
            } catch (err) {
                console.log('failed to decode url');
            }
        } else {
            setDecodedFeed(undefined);
        }
    }, [feed]);

    return (
        <div
            className="standard_width"
            style={{
                position: 'relative',
            }}
        >
            {decodedFeed !== undefined && decodedFeed.writerId === undefined && (
                <div className="profilecard_position">
                    <ProfileCard
                        publicKey={decodedFeed.publicKey}
                        state={props.state}
                    />
                </div>
            )}

            {decodedFeed !== undefined && decodedFeed.writerId === undefined && (
                <div className="recommendedcard_position">
                    <RecommendedProfiles state={props.state} />
                </div>
            )}

            {decodedFeed === undefined && (
                <FeedForTimeline.FeedForTimelineMemo state={props.state} />
            )}

            {decodedFeed !== undefined &&
                decodedFeed.writerId === undefined && (
                    <FeedForProfile.FeedForProfileMemo
                        state={props.state}
                        feed={decodedFeed}
                    />
                )}

            {decodedFeed !== undefined &&
                decodedFeed.writerId !== undefined && (
                    <FeedForThread.FeedForThread
                        state={props.state}
                        feed={decodedFeed}
                    />
                )}
        </div>
    );
}

export default Feed;
