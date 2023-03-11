import Long from 'long';
import fetch, { Headers } from 'cross-fetch';
import * as Base64 from '@borderless/base64';

import * as Protocol from './protocol';
import * as Models from './models';

async function checkResponse(
    name: string,
    response: Response,
): Promise<void> {
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

    await checkResponse('getRanges', response);

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

    await checkResponse('getEvents', response);

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

    const path = `/resolve_claim?claim=${claimQuery}` 
        + `&trust_root=${trustRootQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getResolveClaim', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

export async function getQueryIndex(
    server: string,
    system: Models.PublicKey,
    eventTypes: Array<Models.ContentType.ContentType>,
    limit: number | undefined,
): Promise<Protocol.Events> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(Models.publicKeyToProto(system)).finish(),
    );

    const eventTypesQuery = Base64.encodeUrl(
        Protocol.RepeatedUInt64.encode({
            numbers: eventTypes,
        }).finish(),
    );

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

    await checkResponse('getQueryIndex', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

export async function getQueryReferences(
    server: string,
    system: Models.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
    fromType: Long,
): Promise<Protocol.Events> {
    const systemQuery = Base64.encodeUrl(
        Protocol.PublicKey.encode(Models.publicKeyToProto(system)).finish(),
    );

    const processQuery = Base64.encodeUrl(
        Protocol.Process.encode(process).finish(),
    );

    const path = '/query_references' +
        `?system=${systemQuery}` +
        `&process=${processQuery}` +
        `&logical_clock=${logicalClock.toString()}` +
        `&from_type=${logicalClock.toString()}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    await checkResponse('getQueryReferences', response);

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}

