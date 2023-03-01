import Long from 'long';
import fetch, { Headers } from 'cross-fetch';
import * as Base64 from '@borderless/base64';

import * as Protocol from './protocol';
import * as Models from './models';

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

    if (!response.ok) {
        console.warn('postEvents', response.status, await response.text());
        throw new Error('postEvents !ok');
    }
}

export async function getRanges(
    server: string,
    system: Models.PublicKey,
): Promise<Protocol.RangesForSystem> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(Models.publicKeyToProto(system)).finish(),
    );

    const path = `/ranges?system=${systemQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    if (!response.ok) {
        console.warn('getRanges', response.status, await response.text());
        throw new Error('getRanges !ok');
    }

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.RangesForSystem.decode(rawBody);
}

export async function getEvents(
    server: string,
    system: Models.PublicKey,
    ranges: Protocol.RangesForSystem,
): Promise<Protocol.Events> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(Models.publicKeyToProto(system)).finish(),
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

    if (!response.ok) {
        console.warn('getEvents', response.status, await response.text());
        throw new Error('getEvents !ok');
    }

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

export async function getResolveClaim(
    server: string,
    trustRoot: Models.PublicKey,
    claim: Protocol.Claim,
): Promise<Protocol.Events> {
    const trustRootQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(Models.publicKeyToProto(trustRoot)).finish(),
    );

    const claimQuery = Base64.encodeUrl(Protocol.Claim.encode(claim).finish());

    const path = `/resolve_claim?claim=${claimQuery}' 
        + &trust_root=${trustRootQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    if (!response.ok) {
        console.warn('getResolveClaim', response.status, await response.text());
        throw new Error('getResolveClaim !ok');
    }

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

export async function getQueryIndex(
    server: string,
    system: Models.PublicKey,
    eventTypes: Array<Long>,
    limit: number | undefined,
): Promise<Protocol.Events> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(Models.publicKeyToProto(system)).finish(),
    );

    const eventTypesQuery = Base64.encodeUrl(Protocol.RepeatedUInt64.encode({
        numbers: eventTypes,
    }).finish());

    const path = 
        `/query_index?system=${systemQuery}` +
        `&event_types=${eventTypesQuery}` +
        (limit ? `&limit=${limit.toString()}` : '');

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    if (!response.ok) {
        console.warn('getQueryIndex', response.status, await response.text());
        throw new Error('getQueryIndex !ok');
    }

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

