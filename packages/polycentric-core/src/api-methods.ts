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
        console.log('postEvents', response.status, await response.text());
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
        console.log('getRanges', response.status, await response.text());
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
        console.log('getEvents', response.status, await response.text());
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

    const path = `/resolve_claim?claim=${claimQuery}&trust_root=${trustRootQuery}`;

    const response = await fetch(server + path, {
        method: 'GET',
        headers: new Headers({
            'content-type': 'application/octet-stream',
        }),
    });

    if (!response.ok) {
        console.log('getResolveClaim', response.status, await response.text());
        throw new Error('getResolveClaim !ok');
    }

    const rawBody = new Uint8Array(await response.arrayBuffer());

    return Protocol.Events.decode(rawBody);
}
