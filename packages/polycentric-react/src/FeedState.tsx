import * as Core from 'polycentric-core';
import * as Post from './Post';
import * as Explore from './Explore';
import * as Feed from './Feed';

import { useState, useEffect } from 'react';

export function compareItems(b: FeedItem, a: FeedItem): 0 | 1 | -1 {
    const at = a.post.sortMilliseconds;
    const bt = b.post.sortMilliseconds;

    if (at < bt) {
        return -1;
    } else if (at > bt) {
        return 1;
    } else {
        return 0;
    }
}

export type FeedItem = {
    key: string;
    post: Post.DisplayablePost;
    dependencyContext: Core.DB.DependencyContext;
    generation: number;
};

export async function loadFeedItem(
    state: Core.DB.PolycentricState,
    cancelContext: Core.CancelContext.CancelContext,
    cache: Explore.Cache,
    pointer: Core.Protocol.Pointer,
    generation: number,
    setState: (cb: (feedState: Array<FeedItem>) => Array<FeedItem>) => void,
    mutateNew: (item: FeedItem) => Promise<FeedItem | undefined>,
    handleInsert: (
        feedState: Array<FeedItem>,
        item: FeedItem,
    ) => Array<FeedItem>,
): Promise<boolean> {
    if (cancelContext.cancelled()) {
        return false;
    }

    const dependencyContext = new Core.DB.DependencyContext(state);

    const displayable = await Post.tryLoadDisplayable(
        state,
        pointer,
        dependencyContext,
        cache,
    );

    if (displayable === undefined || cancelContext.cancelled()) {
        dependencyContext.cleanup();

        return false;
    }

    const item = await mutateNew({
        key: Feed.pointerGetKey(pointer),
        post: displayable,
        dependencyContext: dependencyContext,
        generation: generation,
    });

    if (item === undefined || cancelContext.cancelled()) {
        dependencyContext.cleanup();

        return false;
    }

    dependencyContext.setHandler(() => {
        loadFeedItem(
            state,
            cancelContext,
            cache,
            pointer,
            generation + 1,
            setState,
            mutateNew,
            handleInsert,
        );
    });

    setState((previous: Array<FeedItem>): Array<FeedItem> => {
        if (previous.length === 0) {
            return handleInsert(previous, item);
        }

        for (const [index, entry] of previous.entries()) {
            if (entry.key !== item.key) {
                continue;
            }

            if (entry.generation > item.generation) {
                return previous;
            }

            entry.dependencyContext.cleanup();

            const copy = [...previous];

            copy[index] = item;

            return copy;
        }

        return handleInsert(previous, item);
    });

    return true;
}
