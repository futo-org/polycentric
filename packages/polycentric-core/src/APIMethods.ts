import fetch, { Headers } from 'cross-fetch';
import * as Base64 from '@borderless/base64';

import * as Protocol from './protocol';

export async function fetchPostHead(
    address: string,
    event: Protocol.RequestEventsHead,
): Promise<Protocol.Events> {
    const response = await fetch(address + '/head', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        body: Protocol.RequestEventsHead.encode(event).finish(),
    });
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return Protocol.Events.decode(rawBody);
}

export async function fetchPostKnownRanges(
    address: string,
    event: Protocol.RequestKnownRanges,
): Promise<Protocol.KnownRanges> {
    const response = await fetch(address + '/known_ranges', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        body: Protocol.RequestKnownRanges.encode(event).finish(),
    });
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return Protocol.KnownRanges.decode(rawBody);
}

export async function fetchPostKnownRangesForFeed(
    address: string,
    event: Protocol.RequestKnownRangesForFeed,
): Promise<Protocol.ResponseKnownRangesForFeed> {
    const path =
        '/known_ranges_for_feed?query=' +
        Base64.encodeUrl(
            Protocol.RequestKnownRangesForFeed.encode(event).finish(),
        );

    const response = await fetch(address + path, {
        method: 'GET',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
    });

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.ResponseKnownRangesForFeed.decode(rawBody);
}

export async function fetchPostRequestEventRanges(
    address: string,
    event: Protocol.RequestEventRanges,
): Promise<Protocol.Events> {
    const path =
        '/request_event_ranges?query=' +
        Base64.encodeUrl(Protocol.RequestEventRanges.encode(event).finish());

    const response = await fetch(address + path, {
        method: 'GET',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
    });

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

export async function fetchPostEvents(
    address: string,
    event: Protocol.Events,
): Promise<void> {
    await fetch(address + '/post_events', {
        method: 'POST',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
        body: Protocol.Events.encode(event).finish(),
    });
}

export async function fetchPostSearch(
    address: string,
    event: Protocol.Search,
): Promise<Protocol.ResponseSearch> {
    const response = await fetch(address + '/search', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        body: Protocol.Search.encode(event).finish(),
    });
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return Protocol.ResponseSearch.decode(rawBody);
}

export async function fetchGetRecommendProfiles(
    address: string,
): Promise<Protocol.Events> {
    const response = await fetch(address + '/recommended_profiles', {
        method: 'GET',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
    });
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return Protocol.Events.decode(rawBody);
}

export async function fetchPostExplore(
    address: string,
    event: Protocol.RequestExplore,
): Promise<Protocol.ResponseSearch> {
    const response = await fetch(address + '/explore', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        body: Protocol.RequestExplore.encode(event).finish(),
    });
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return Protocol.ResponseSearch.decode(rawBody);
}

export async function fetchPostNotifications(
    address: string,
    event: Protocol.RequestNotifications,
): Promise<Protocol.ResponseNotifications> {
    const response = await fetch(address + '/notifications', {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        body: Protocol.RequestNotifications.encode(event).finish(),
    });
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return Protocol.ResponseNotifications.decode(rawBody);
}

export async function loadReplies(
    address: string,
    pointer: Protocol.Pointer,
): Promise<Protocol.ResultEventsAndRelatedEventsAndCursor> {
    const path = '/replies' +
        `?identity=${Base64.encodeUrl(pointer.publicKey)}` +
        `&writer_id=${Base64.encodeUrl(pointer.writerId)}` +
        `&sequence_number=${pointer.sequenceNumber.toString()}`;

    const response = await fetch(address + path, {
        method: 'GET',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
    });
    const rawBody = new Uint8Array(await response.arrayBuffer());
    return Protocol.ResultEventsAndRelatedEventsAndCursor.decode(rawBody);
}

