import * as Core from '@polycentric/polycentric-core';
import Long from 'long';

export const SERVER = "https://srv1-stg.polycentric.io";
export const TRUST_ROOT = Core.Models.PublicKey.fromProto(Core.Protocol.PublicKey.create({
    keyType: 1,
    key: Uint8Array.from(atob("gX0eCWctTm6WHVGot4sMAh7NDAIwWsIM5tRsOz9dX04="), c => c.charCodeAt(0))
}));

export function replacer(key: any, value: any) {
    if (value instanceof Uint8Array) {
        return btoa(String.fromCharCode.apply(null, Array.from(value)));
    }
    if (Long.isLong(value)) {
        return value.toString();
    }

    return value;
}