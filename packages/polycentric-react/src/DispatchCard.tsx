import { useState, useEffect, memo, ReactNode } from 'react';
import * as Base64 from '@borderless/base64';
import * as Lodash from 'lodash';

import * as Core from 'polycentric-core';
import * as ProfileUtil from './ProfileUtil';
import * as Feed from './Feed';
import Post from './Post';
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
        needPointersListeners: [Core.Protocol.Pointer, () => void][],
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
            const profile = await ProfileUtil.loadProfileOrFallback(
                props.state,
                event.event.authorPublicKey,
                [],
            );

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
                    />
                </div>,
            );
        } else if (body.message !== undefined) {
            const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

            const needPointers = new Array<Core.Protocol.Pointer>();

            const displayable = await Feed.eventToDisplayablePost(
                props.state,
                profiles,
                {
                    event: event.event,
                    mutationPointer: undefined,
                },
                needPointers,
            );

            const cb = Lodash.once(() => {
                loadCard(needPointersListeners);
            });

            for (const needPointer of needPointers) {
                needPointersListeners.push([needPointer, cb]);

                Core.DB.waitOnEvent(props.state, needPointer, cb);
            }

            if (displayable === undefined) {
                return undefined;
            }

            displayable.fromServer = props.fromServer;

            setCard(
                <Post
                    state={props.state}
                    post={displayable}
                    showBoost={true}
                    depth={0}
                />,
            );
        }
    };

    useEffect(() => {
        const needPointersListeners: [Core.Protocol.Pointer, () => void][] = [];

        loadCard(needPointersListeners);

        return () => {
            for (const listener of needPointersListeners) {
                Core.DB.cancelWaitOnEvent(
                    props.state,
                    listener[0],
                    listener[1],
                );
            }
        };
    }, [props.pointer, props.fromServer]);

    return <div>{card}</div>;
}
