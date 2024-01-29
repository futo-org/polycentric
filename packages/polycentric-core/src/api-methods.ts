import * as Base64 from '@borderless/base64';
import fetch, { Headers } from 'cross-fetch';
import Long from 'long';
import * as Models from './models';
import * as Protocol from './protocol';

async function checkResponse(name: string, response: Response): Promise<void> {
    if (!response.ok) {
        console.warn(name, response.status, await response.text());
        throw new Error(name + ' !ok');
    }
}

export async function postEvents(
    server: string,
    events: Array<Models.SignedEvent.SignedEvent>,
): Promise<void> {
    const response = await fetch(server + '/events', {
        method: 'POST',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
        body: Protocol.Events.encode({
            events: events,
        }).finish(),
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

export type GetEventsType = (
    server: string,
    system: Models.PublicKey.PublicKey,
    ranges: Protocol.RangesForSystem,
) => Promise<Models.Events.Type>;

export const getEvents: GetEventsType = async (
    server: string,
    system: Models.PublicKey.PublicKey,
    ranges: Protocol.RangesForSystem,
): Promise<Models.Events.Type> => {
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

    return Models.Events.fromBuffer(rawBody);
};

export async function getResolveClaim(
    server: string,
    trustRoot: Models.PublicKey.PublicKey,
    claimType: Models.ClaimType.ClaimType,
    matchAnyField: string,
): Promise<Models.QueryClaimToSystemResponse.ResponseType> {
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

    return Models.QueryClaimToSystemResponse.responseTypeFromBuffer(rawBody);
}

export type GetQueryLatestType = (
    server: string,
    system: Models.PublicKey.PublicKey,
    eventTypes: Array<Models.ContentType.ContentType>,
) => Promise<Models.Events.Type>;

export const getQueryLatest: GetQueryLatestType = async (
    server: string,
    system: Models.PublicKey.PublicKey,
    eventTypes: Array<Models.ContentType.ContentType>,
): Promise<Models.Events.Type> => {
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

    return Models.Events.fromBuffer(rawBody);
};

export async function getQueryIndex(
    server: string,
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
    after?: Long,
    limit?: Long,
): Promise<Models.QueryIndexResponse.Type> {
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

    return Models.QueryIndexResponse.fromBuffer(rawBody);
}

export async function getQueryReferences(
    server: string,
    reference: Protocol.Reference,
    cursor?: Uint8Array,
    requestEvents?: Protocol.QueryReferencesRequestEvents,
    countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
    countReferences?: Protocol.QueryReferencesRequestCountReferences[],
    extraByteReferences?: Array<Uint8Array>,
): Promise<Protocol.QueryReferencesResponse> {
    const query: Protocol.QueryReferencesRequest = {
        reference: reference,
        cursor: cursor,
        requestEvents: requestEvents,
        countLwwElementReferences: countLwwElementReferences ?? [],
        countReferences: countReferences ?? [],
        extraByteReferences: extraByteReferences ?? [],
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

export enum SearchType {
    Messages = 'messages',
    Profiles = 'profiles',
}

export async function getSearch(
    server: string,
    searchQuery: string,
    limit?: number,
    cursor?: Uint8Array,
    searchType?: SearchType,
): Promise<Models.ResultEventsAndRelatedEventsAndCursor.Type> {
    let path = `/search?search=${encodeURIComponent(searchQuery)}`;

    if (cursor !== undefined) {
        path += `&cursor=${Base64.encodeUrl(cursor)}`;
    }

    if (limit !== undefined) {
        path += `&limit=${limit.toString()}`;
    }

    if (searchType !== undefined) {
        path += `&search_type=${searchType}`;
    }

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getSearch', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Models.ResultEventsAndRelatedEventsAndCursor.fromBuffer(rawBody);
}

export async function getHead(
    server: string,
    system: Models.PublicKey.PublicKey,
): Promise<Models.Events.Type> {
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

    return Models.Events.fromBuffer(rawBody);
}

export async function getExplore(
    server: string,
    limit?: number,
    cursor?: Uint8Array,
): Promise<Models.ResultEventsAndRelatedEventsAndCursor.Type> {
    let path = '/explore?';

    const params = new URLSearchParams();

    if (cursor !== undefined) {
        params.append('cursor', Base64.encodeUrl(cursor));
    }

    if (limit !== undefined) {
        params.append('limit', limit.toString());
    }

    path += params.toString();

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getExplore', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Models.ResultEventsAndRelatedEventsAndCursor.fromBuffer(rawBody);
}

export async function getFindClaimAndVouch(
    server: string,
    vouching_system: Models.PublicKey.PublicKey,
    claiming_system: Models.PublicKey.PublicKey,
    fields: Array<Protocol.ClaimFieldEntry>,
    claimType: Models.ClaimType.ClaimType,
): Promise<Models.FindClaimAndVouchResponse.Type | undefined> {
    const query: Protocol.FindClaimAndVouchRequest = {
        vouchingSystem: vouching_system,
        claimingSystem: claiming_system,
        fields: fields,
        claimType: claimType,
    };

    const encodedQuery = Base64.encodeUrl(
        Protocol.FindClaimAndVouchRequest.encode(query).finish(),
    );

    const path = `/find_claim_and_vouch?query=${encodedQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    if (response.status === 404) {
        return undefined;
    }

    await checkResponse('getFindClaimAndVouch', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Models.FindClaimAndVouchResponse.fromBuffer(rawBody);
}

export async function getChallenge(
    server: string,
): Promise<Protocol.HarborChallengeResponse> {
    const response = await fetch(server + '/challenge', {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getChallenge', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.HarborChallengeResponse.decode(rawBody);
}

export async function postPurge(
    server: string,
    solvedChallenge: Protocol.HarborValidateRequest,
): Promise<void> {
    const response = await fetch(server + '/purge', {
        method: 'POST',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
        body: Protocol.HarborValidateRequest.encode(solvedChallenge).finish(),
    });

    await checkResponse('postPurge', response);
}
