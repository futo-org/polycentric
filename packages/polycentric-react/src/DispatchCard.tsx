import { useState, useEffect, memo, ReactNode } from 'react';
import * as Base64 from '@borderless/base64';
import * as Lodash from 'lodash';

import * as Core from 'polycentric-core';
import * as ProfileUtil from './ProfileUtil';
import * as Feed from './Feed';
import * as Post from './Post';
import * as Explore from './Explore';
import ProfileHeader from './ProfileHeader';

export type DispatchCardProps = {
    state: Core.DB.PolycentricState;
    pointer: Core.Protocol.Pointer;
    fromServer: string;
};

export const DispatchCardMemo = memo(DispatchCard);

export function DispatchCard(props: DispatchCardProps) {
    const [card, setCard] = useState<ReactNode | undefined>(undefined);

    const loadCard = async (
        dependencyContext: Core.DB.DependencyContext,
        cache: Explore.Cache,
    ) => {
        const event = await Core.DB.tryLoadStorageEventByPointer(
            props.state,
            props.pointer,
        );

        if (event === undefined || event.event === undefined) {
            return undefined;
        }

        const body = Core.Protocol.EventBody.decode(event.event.content);

        if (body.profile !== undefined) {
            const nextDependencyContext = new Core.DB.DependencyContext(
                props.state,
            );

            const profile = await ProfileUtil.loadProfileOrFallback(
                props.state,
                event.event.authorPublicKey,
                nextDependencyContext,
            );

            nextDependencyContext.cleanup();

            setCard(
                <div
                    style={{
                        marginTop: '15px',
                    }}
                >
                    <ProfileHeader
                        key={Base64.encodeUrl(event.event.authorPublicKey)}
                        publicKey={event.event.authorPublicKey}
                        state={props.state}
                        fromServer={props.fromServer}
                        profilePageProps={undefined}
                    />
                </div>,
            );
        } else if (body.message !== undefined) {
            const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

            const nextDependencyContext = new Core.DB.DependencyContext(
                props.state,
            );

            const displayable = await Post.eventToDisplayablePost(
                props.state,
                profiles,
                {
                    event: event.event,
                    mutationPointer: undefined,
                },
                nextDependencyContext,
                cache,
            );

            nextDependencyContext.cleanup();

            /*
            const cb = Lodash.once(() => {
                loadCard(needPointersListeners);
            });

            for (const needPointer of needPointers) {
                needPointersListeners.push([needPointer, cb]);

                Core.DB.waitOnEvent(props.state, needPointer, cb);
            }
            */

            if (displayable === undefined) {
                return undefined;
            }

            displayable.fromServer = props.fromServer;

            setCard(
                <Post.Post
                    state={props.state}
                    post={displayable}
                    showBoost={true}
                    depth={0}
                />,
            );
        }
    };

    useEffect(() => {
        const dependencyContext = new Core.DB.DependencyContext(props.state);
        const cache = new Explore.Cache();

        loadCard(dependencyContext, cache);

        return () => {
            dependencyContext.cleanup();
            cache.free();
        };
    }, [props.pointer, props.fromServer]);

    return <div>{card}</div>;
}
