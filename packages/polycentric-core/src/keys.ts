import Long from 'long';

import * as Util from './Util';
import * as Protocol from './protocol';

export const MIN_UINT64_KEY = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

export const MAX_UINT64_KEY = new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 255,
]);

export const MIN_32BYTE_KEY = new Uint8Array(32).fill(0);

export const MAX_32BYTE_KEY = new Uint8Array(32).fill(255);

export const IDENTITY_KEY = new TextEncoder().encode('IDENTITY');

export function pointerToKey(pointer: Protocol.Pointer): Uint8Array {
    if (pointer.publicKey.length != 32) {
        throw new Error('expected publicKey to be 32 bytes');
    }

    if (pointer.writerId.length != 32) {
        throw new Error('expected writerId to be 32 bytes');
    }

    const number = Util.numberToBinaryBE(pointer.sequenceNumber);

    const merged = new Uint8Array(
        pointer.publicKey.length + pointer.writerId.length + number.length,
    );

    merged.set(pointer.publicKey);
    merged.set(pointer.writerId, pointer.publicKey.length);
    merged.set(number, pointer.publicKey.length + pointer.writerId.length);

    return merged;
}

export function keyToPointer(key: Uint8Array): Protocol.Pointer {
    if (key.length !== 32 + 32 + 8) {
        throw new Error('unexpected key size');
    }

    const publicKey = key.slice(0, 32);
    const writerId = key.slice(32, 32 + 32);
    const sequenceNumberArray = Array.from(key.slice(64, 64 + 8));

    const sequenceNumber = Long.fromBytesBE(
        sequenceNumberArray,
        true,
    ).toNumber();

    return {
        publicKey: publicKey,
        writerId: writerId,
        sequenceNumber: sequenceNumber,
    };
}

export function makeStorageTypeEventKeyByAuthorByTime(
    publicKey: Uint8Array,
    unixMilliseconds: number,
): Uint8Array {
    if (publicKey.length != 32) {
        throw new Error('expected publicKey to be 32 bytes');
    }

    const number = Util.numberToBinaryBE(unixMilliseconds);
    const merged = new Uint8Array(publicKey.length + number.length);

    merged.set(publicKey);
    merged.set(number, publicKey.length);

    return merged;
}
