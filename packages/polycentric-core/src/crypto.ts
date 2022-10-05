import Long from 'long';
import * as Ed from '@noble/ed25519';
import * as sha256 from 'fast-sha256';

import * as Protocol from './user';

function numberToBinary(value: number): Uint8Array {
    const long = Long.fromNumber(value, true);
    return new Uint8Array(long.toBytesLE());
}

export async function hashEvent(event: Protocol.Event): Promise<Uint8Array> {
    const hash = new sha256.Hash();

    hash.update(event.writerId);
    hash.update(event.authorPublicKey);
    hash.update(numberToBinary(event.sequenceNumber));
    hash.update(numberToBinary(event.unixMilliseconds));
    hash.update(event.content);

    for (const clock of event.clocks) {
        hash.update(clock.key);
        hash.update(numberToBinary(clock.value));
    }

    return await hash.digest();
}

export async function addEventSignature(
    event: Protocol.Event,
    privateKey: Uint8Array,
): Promise<void> {
    const signature = await Ed.sign(await hashEvent(event), privateKey);
    event.signature = signature;
}

export async function validateSignature(
    event: Protocol.Event,
): Promise<boolean> {
    if (event.signature === undefined) {
        return false;
    }

    return await Ed.verify(
        new Uint8Array(event.signature),
        new Uint8Array(await hashEvent(event)),
        new Uint8Array(event.authorPublicKey),
    );
}
