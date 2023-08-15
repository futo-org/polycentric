import fetch, { Headers } from 'cross-fetch';
import * as Base64 from '@borderless/base64';
import * as Protocol from './protocol';
import * as Models from './models';
import Long from 'long';

async function checkResponse(name: string, response: Response): Promise<void> {
    if (!response.ok) {
        console.warn(name, response.status, await response.text());
        throw new Error(name + ' !ok');
    }
}

export async function postEvents(
    server: string,
    events: Protocol.Events,
): Promise<void> {
    const response = await fetch(server + '/events', {
        method: 'POST',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
        body: Protocol.Events.encode(events).finish(),
    });

    await checkResponse('postEvents', response);
}

export async function postCensor(
    server: string,
    censorshipType: string,
    urlInfo: string,
    authorization: string,
): Promise<void> {
    const response = await fetch(
        `${server}/censor?censorship_type=${censorshipType}`,
        {
            method: 'POST',
            headers: new Headers({
                'content-type': 'application/octet-stream',
                authorization: authorization,
            }),
            body: urlInfo,
        },
    );

    await checkResponse('postCensor', response);
}

export async function getRanges(
    server: string,
    system: Models.PublicKey.PublicKey,
): Promise<Protocol.RangesForSystem> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(system).finish(),
    );

    const path = `/ranges?system=${systemQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getRanges', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.RangesForSystem.decode(rawBody);
}

export async function getEvents(
    server: string,
    system: Models.PublicKey.PublicKey,
    ranges: Protocol.RangesForSystem,
): Promise<Protocol.Events> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(system).finish(),
    );

    const rangesQuery = Base64.encodeUrl(
        Protocol.RangesForSystem.encode(ranges).finish(),
    );

    const path = `/events?system=${systemQuery}&ranges=${rangesQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getEvents', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

export async function getResolveClaim(
    server: string,
    trustRoot: Models.PublicKey.PublicKey,
    claimType: Models.ClaimType.ClaimType,
    matchAnyField: string,
): Promise<Protocol.QueryClaimToSystemResponse> {
    const query = Base64.encodeUrl(
        Protocol.QueryClaimToSystemRequest.encode({
            claimType: claimType,
            trustRoot: trustRoot,
            matchAnyField: matchAnyField,
        }).finish(),
    );

    const path = `/resolve_claim?query=${query}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getResolveClaim', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.QueryClaimToSystemResponse.decode(rawBody);
}

export async function getQueryLatest(
    server: string,
    system: Models.PublicKey.PublicKey,
    eventTypes: Array<Models.ContentType.ContentType>,
): Promise<Protocol.Events> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(system).finish(),
    );

    const eventTypesQuery = Base64.encodeUrl(
        Protocol.RepeatedUInt64.encode({
            numbers: eventTypes,
        }).finish(),
    );

    const path =
        `/query_latest?system=${systemQuery}` +
        `&event_types=${eventTypesQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getQueryLatest', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

export async function getQueryIndex(
    server: string,
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
    after?: Long,
    limit?: Long,
): Promise<Protocol.QueryIndexResponse> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(system).finish(),
    );

    const path =
        `/query_index?system=${systemQuery}` +
        `&content_type=${contentType.toString()}` +
        (after ? `&after=${after.toString()}` : '') +
        (limit ? `&limit=${limit.toString()}` : '');

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getQueryIndex', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.QueryIndexResponse.decode(rawBody);
}

export async function getQueryReferences(
    server: string,
    reference: Protocol.Reference,
    cursor?: Uint8Array,
    requestEvents?: Protocol.QueryReferencesRequestEvents,
    countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
    countReferences?: Protocol.QueryReferencesRequestCountReferences[],
): Promise<Protocol.QueryReferencesResponse> {
    const query: Protocol.QueryReferencesRequest = {
        reference: reference,
        cursor: cursor,
        requestEvents: requestEvents,
        countLwwElementReferences: countLwwElementReferences ?? [],
        countReferences: countReferences ?? [],
    };

    const encodedQuery = Base64.encodeUrl(
        Protocol.QueryReferencesRequest.encode(query).finish(),
    );

    const path = `/query_references?query=${encodedQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getQueryReferences', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.QueryReferencesResponse.decode(rawBody);
}

export async function getSearch(
    server: string,
    searchQuery: string,
    cursor?: Uint8Array,
): Promise<Protocol.ResultEventsAndRelatedEventsAndCursor> {
    let path = `/search?search=${encodeURIComponent(searchQuery)}`;

    if (cursor !== undefined) {
        path += `&cursor=${Base64.encodeUrl(cursor)}`;
    }

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getSearch', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.ResultEventsAndRelatedEventsAndCursor.decode(rawBody);
}

export async function getHead(
    server: string,
    system: Models.PublicKey.PublicKey,
): Promise<Protocol.Events> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(system).finish(),
    );

    const path = `/head?system=${systemQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getHead', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}
