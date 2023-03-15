import * as Protocol from './protocol';

import * as Ed from '@noble/ed25519';
import Long from 'long';
import * as FastSHA256 from 'fast-sha256';

import * as Util from './util';

export namespace ContentType {
    export type ContentType =
        Readonly<Long> & { readonly __tag: unique symbol };

    function makeContentType(x: number): ContentType {
        return new Long(x, 0, true) as ContentType;
    }

    export const ContentTypeDelete = makeContentType(1);
    export const ContentTypeSystemProcesses = makeContentType(2);
    export const ContentTypePost = makeContentType(3);
    export const ContentTypeFollow = makeContentType(4);
    export const ContentTypeUsername = makeContentType(5);
    export const ContentTypeDescription = makeContentType(6);
    export const ContentTypeBlobMeta = makeContentType(7);
    export const ContentTypeBlobSection = makeContentType(8);
    export const ContentTypeAvatar = makeContentType(9);
    export const ContentTypeServer = makeContentType(10);
    export const ContentTypeVouch = makeContentType(11);
    export const ContentTypeClaim = makeContentType(12);
    export const ContentTypeBanner = makeContentType(13);
}

export namespace PublicKey {
    export type PublicKey =
        Readonly<Protocol.PublicKey> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.PublicKey): PublicKey {
        if (!proto.keyType.equals(Long.UONE)) {
            throw new Error('unknown key type');
        }

        if (proto.key.length !== 32) {
            throw new Error('incorrect public key length');
        }

        return proto as PublicKey;
    }

    export function equal(a: PublicKey, b: PublicKey): boolean {
        if (!a.keyType.equals(b.keyType)) {
            return false;
        }

        return Util.buffersEqual(a.key, b.key);
    }

    export async function verify(
        key: PublicKey,
        signature: Uint8Array,
        bytes: Uint8Array,
    ): Promise<boolean> {
        return await Ed.verify(signature, bytes, key.key);
    }
}

export namespace PrivateKey {
    export type PrivateKey =
        Readonly<Protocol.PrivateKey> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.PrivateKey): PrivateKey {
        if (!proto.keyType.equals(Long.UONE)) {
            throw new Error('unknown key type');
        }

        if (proto.key.length !== 32) {
            throw new Error('incorrect public key length');
        }

        return proto as PrivateKey;
    }

    export function random(): PrivateKey {
        return {
            keyType: Long.UONE,
            key: Ed.utils.randomPrivateKey(),
        } as PrivateKey;
    }

    export async function derivePublicKey(
        privateKey: PrivateKey,
    ): Promise<PublicKey.PublicKey> {
        return PublicKey.fromProto({ 
            keyType: privateKey.keyType,
            key: await Ed.getPublicKey(privateKey.key),
        });
    }

    export async function sign(
        privateKey: PrivateKey,
        bytes: Uint8Array,
    ): Promise<Uint8Array> {
        return await Ed.sign(bytes, privateKey.key);
    }
}

export namespace Digest {
    export type Digest =
        Readonly<Protocol.Digest> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.Digest): Digest {
        if (!proto.digestType.equals(Long.UONE)) {
            throw new Error('unknown digest type');
        }

        if (proto.digest.length !== 32) {
            throw new Error('incorrect digest length');
        }

        return proto as Digest;
    }
}

export namespace Process {
    export type Process =
        Readonly<Protocol.Process> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.Process): Process {
        if (proto.process.length !== 16) {
            throw new Error('incorrect process size');
        }

        return proto as Process;
    }

    export function equal(a: Process, b: Process): boolean {
        return Util.buffersEqual(a.process, b.process);
    }

    export function random(): Process {
        return {
            process: Ed.utils.randomPrivateKey().slice(0, 16),
        } as Process;
    }
}

export namespace Pointer {
    interface PointerI {
        system: PublicKey.PublicKey;
        process: Process.Process;
        logicalClock: Long;
        eventDigest: Digest.Digest;
    }

    export type Pointer =
        Readonly<PointerI> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.Pointer): Pointer {
        if (proto.system === undefined) {
            throw new Error('expected system');
        }

        if (proto.process === undefined) {
            throw new Error('expected process');
        }

        if (proto.eventDigest === undefined) {
            throw new Error('expected digest');
        }

        PublicKey.fromProto(proto.system);
        Process.fromProto(proto.process);
        Digest.fromProto(proto.eventDigest);

        return proto as Pointer;
    }
}

export namespace ProcessSecret {
   interface ProcessSecretI {
        system: PrivateKey.PrivateKey;
        process: Process.Process;
    }

    export type ProcessSecret =
        Readonly<ProcessSecretI> & { readonly __tag: unique symbol };

    export function fromProto(
        proto: Protocol.StorageTypeProcessSecret,
    ): ProcessSecret {
        if (proto.system === undefined) {
            throw new Error('expected system');
        }

        if (proto.process === undefined) {
            throw new Error('expected process');
        }

        PrivateKey.fromProto(proto.system);
        Process.fromProto(proto.process);

        return proto as ProcessSecret;
    }
}

export namespace Event {
    interface EventI{
        system: PublicKey.PublicKey;
        process: Process.Process;
        logicalClock: Long;
        contentType: ContentType.ContentType,
        content: Uint8Array,
        vectorClock: Protocol.VectorClock,
        lwwElementSet: Protocol.LWWElementSet | undefined,
        lwwElement: Protocol.LWWElement | undefined,
        references: Array<Protocol.Reference>,
        indices: Protocol.Indices,
    }

    export type Event =
        Readonly<EventI> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.Event): Event {
        if (proto.system === undefined) {
            throw new Error('expected system');
        }

        if (proto.process === undefined) {
            throw new Error('expected process');
        }

        if (proto.vectorClock === undefined) {
            throw new Error('expected vector clock');
        }

        if (proto.indices === undefined) {
            throw new Error('expected indices');
        }

        PublicKey.fromProto(proto.system);
        Process.fromProto(proto.process);

        return proto as Event ;
    }

    export function fromBuffer(buffer: Uint8Array): Event {
        return fromProto(Protocol.Event.decode(buffer));
    }
}

export namespace SignedEvent {
    export type SignedEvent =
        Readonly<Protocol.SignedEvent> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.SignedEvent): SignedEvent {
        const event = Event.fromProto(Protocol.Event.decode(proto.event));

        if (!PublicKey.verify(event.system, proto.signature, proto.event)) {
            throw new Error('signature verification failed');
        }

        return proto as SignedEvent;
    }
}

export enum ClaimType {
    HackerNews = "HackerNews",
    YouTube = "YouTube",
    Odysee = "Odysee",
    Rumble = "Rumble",
    Twitter = "Twitter",
    Bitcoin = "Bitcoin",
    Generic = "Generic",
}

export function claimHackerNews(username: string): Protocol.Claim {
    return {
        claimType: ClaimType.HackerNews,
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimYouTube(username: string): Protocol.Claim {
    return {
        claimType: ClaimType.YouTube,
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimTwitter(username: string): Protocol.Claim {
    return {
        claimType: ClaimType.Twitter,
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimBitcoin(username: string): Protocol.Claim {
    return {
        claimType: ClaimType.Bitcoin,
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimGeneric(text: string): Protocol.Claim {
    return {
        claimType: ClaimType.Generic,
        claim: Protocol.ClaimIdentifier.encode({
            identifier: text,
        }).finish(),
    };
}

export class Blob {
    private _mime: string;
    private _content: Uint8Array;

    constructor(mime: string, content: Uint8Array) {
        this._mime = mime;
        this._content = content;
    }

    public mime(): string {
        return this._mime;
    }

    public content(): Uint8Array {
        return this._content;
    }
}

export async function hash(bytes: Uint8Array): Promise<Digest.Digest> {
    const context = new FastSHA256.Hash();
    context.update(bytes);
    return Digest.fromProto({
        digestType: Long.UONE,
        digest: await context.digest(),
    });
}

export function pointerToReference(
    pointer: Pointer.Pointer,
): Protocol.Reference {
    return {
        referenceType: new Long(2, 0, true),
        reference: Protocol.Pointer.encode(pointer).finish(),
    };
}

export async function signedEventToPointer(
    signedEvent: SignedEvent.SignedEvent,
): Promise<Pointer.Pointer> {
    const event = Event.fromBuffer(signedEvent.event);
    return Pointer.fromProto({
        system: event.system,
        process: event.process,
        logicalClock: event.logicalClock,
        eventDigest: await hash(signedEvent.event),
    });
}

