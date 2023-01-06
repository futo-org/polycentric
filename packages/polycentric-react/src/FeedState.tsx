import * as Core from 'polycentric-core';
import * as Post from './Post';
import * as Explore from './Explore';
import * as Feed from './Feed';

import { useState, useEffect } from 'react';

export function compareItems(b: FeedItem, a: FeedItem): 0 | 1 | -1 {
    if (a.post == undefined || b.post == undefined) {
        return 0;
    }

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
    post: Post.DisplayablePost | undefined;
    dependencyContext: Core.DB.DependencyContext;
    generation: number;
};

export function noneVisible(items: Array<FeedItem>): boolean {
    if (items.length === 0) {
        return true;
    }

    for (const item of items) {
        if (item.post !== undefined) {
            return false;
        }
    }

    return true;
}

export async function loadFeedItem(
    state: Core.DB.PolycentricState,
    cancelContext: Core.CancelContext.CancelContext,
    cache: Explore.Cache,
    pointer: Core.Protocol.Pointer,
    generation: number,
    setState: (cb: (feedState: Array<FeedItem>) => Array<FeedItem>) => void,
    mutateNew: (item: Post.DisplayablePost) => Promise<Post.DisplayablePost | undefined>,
    handleInsert: (
        feedState: Array<FeedItem>,
        item: FeedItem,
    ) => Array<FeedItem>,
): Promise<boolean> {
    if (cancelContext.cancelled()) {
        return false;
    }

    const dependencyContext = new Core.DB.DependencyContext(state);

    let post: Post.DisplayablePost | undefined = undefined;

    const displayable = await Post.tryLoadDisplayable(
        state,
        pointer,
        dependencyContext,
        cache,
    );

    if (cancelContext.cancelled()) {
        dependencyContext.cleanup();

        return false;
    }

    let progress = true;

    if (displayable !== undefined) {
        post = await mutateNew(displayable);

        if (cancelContext.cancelled()) {
            dependencyContext.cleanup();

            return false;
        }
    }

    if (displayable === undefined || post === undefined) {
        progress = false;
    }

    const item = {
        key: Feed.pointerGetKey(pointer),
        post: post,
        dependencyContext: dependencyContext,
        generation: generation,
    };

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

    return progress;
}
