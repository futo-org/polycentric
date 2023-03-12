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

export namespace SignedEvent {
    export type SignedEvent =
        Readonly<Protocol.SignedEvent> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.SignedEvent): SignedEvent {
        const event = eventFromProto(Protocol.Event.decode(proto.event));

        if (!PublicKey.verify(event.system(), proto.signature, proto.event)) {
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

export class Event {
    private _system: PublicKey.PublicKey;
    private _process: Process.Process;
    private _logicalClock: Long;
    private _contentType: ContentType.ContentType;
    private _content: Uint8Array;
    private _lwwElementSet: LWWElementSet | undefined;
    private _lwwElement: LWWElement | undefined;
    private _references: Array<Protocol.Reference>;
    private _indices: Array<Protocol.Index>;

    public constructor(
        system: PublicKey.PublicKey,
        process: Process.Process,
        logicalClock: Long,
        contentType: ContentType.ContentType,
        content: Uint8Array,
        lwwElementSet: LWWElementSet | undefined,
        lwwElement: LWWElement | undefined,
        references: Array<Protocol.Reference>,
        indices: Array<Protocol.Index>,
    ) {
        if (!logicalClock.unsigned) {
            throw new Error('expected logical clock to be unsigned');
        }

        if (!contentType.unsigned) {
            throw new Error('expected content type to be unsigned');
        }

        this._system = system;
        this._process = process;
        this._logicalClock = logicalClock;
        this._contentType = contentType;
        this._content = content;
        this._lwwElementSet = lwwElementSet;
        this._lwwElement = lwwElement;
        this._references = references;
        this._indices = indices;
    }

    public system(): PublicKey.PublicKey {
        return this._system;
    }

    public process(): Process.Process {
        return this._process;
    }

    public logicalClock(): Long {
        return this._logicalClock;
    }

    public contentType(): ContentType.ContentType {
        return this._contentType;
    }

    public content(): Uint8Array {
        return this._content;
    }

    public lwwElementSet(): LWWElementSet | undefined {
        return this._lwwElementSet;
    }

    public lwwElement(): LWWElement | undefined {
        return this._lwwElement;
    }

    public references(): Array<Protocol.Reference> {
        return this._references;
    }

    public indices(): Array<Protocol.Index> {
        return this._indices;
    }
}

export function eventFromProto(proto: Protocol.Event): Event {
    if (proto.system === undefined) {
        throw new Error('expected system');
    }

    if (proto.process === undefined) {
        throw new Error('expected process');
    }

    if (proto.indices === undefined) {
        throw new Error('expected indices');
    }

    return new Event(
        PublicKey.fromProto(proto.system),
        Process.fromProto(proto.process),
        proto.logicalClock,
        proto.contentType as ContentType.ContentType,
        proto.content,
        proto.lwwElementSet
            ? lwwElementSetFromProto(proto.lwwElementSet)
            : undefined,
        proto.lwwElement ? lwwElementFromProto(proto.lwwElement) : undefined,
        proto.references,
        proto.indices.indices,
    );
}

export function eventFromProtoBuffer(proto: Uint8Array): Event {
    return eventFromProto(Protocol.Event.decode(proto));
}

export function eventToProto(event: Event): Protocol.Event {
    const lwwElementSet = event.lwwElementSet();
    const lwwElement = event.lwwElement();

    return {
        system: event.system(),
        process: event.process(),
        logicalClock: event.logicalClock(),
        contentType: event.contentType(),
        content: event.content(),
        vectorClock: {
            logicalClocks: [],
        },
        indices: {
            indices: event.indices(),
        },
        lwwElementSet: lwwElementSet
            ? lwwElementSetToProto(lwwElementSet)
            : undefined,
        lwwElement: lwwElement ? lwwElementToProto(lwwElement) : undefined,
        references: event.references(),
    };
}

export async function signedEventToPointer(
    signedEvent: SignedEvent.SignedEvent,
): Promise<Pointer.Pointer> {
    const event = eventFromProtoBuffer(signedEvent.event);
    return Pointer.fromProto({
        system: event.system(),
        process: event.process(),
        logicalClock: event.logicalClock(),
        eventDigest: await hash(signedEvent.event),
    });
}

export class ProcessSecret {
    private _system: PrivateKey.PrivateKey;
    private _process: Process.Process;

    constructor(system: PrivateKey.PrivateKey, process: Process.Process) {
        this._system = system;
        this._process = process;
    }

    public system(): PrivateKey.PrivateKey {
        return this._system;
    }

    public process(): Process.Process {
        return this._process;
    }
}

export function processSecretFromProto(
    proto: Protocol.StorageTypeProcessSecret,
): ProcessSecret {
    if (proto.system === undefined) {
        throw new Error('expected system');
    }

    if (proto.process === undefined) {
        throw new Error('expected process');
    }

    return new ProcessSecret(
        PrivateKey.fromProto(proto.system),
        Process.fromProto(proto.process),
    );
}

export function processSecretToProto(
    processSecret: ProcessSecret,
): Protocol.StorageTypeProcessSecret {
    return {
        system: processSecret.system(),
        process: processSecret.process(),
    };
}

export class LWWElement {
    private _value: Uint8Array;
    private _unixMilliseconds: Long;

    public constructor(value: Uint8Array, unixMilliseconds: Long) {
        this._value = value;
        this._unixMilliseconds = unixMilliseconds;
    }

    public value(): Uint8Array {
        return this._value;
    }

    public unixMilliseconds(): Long {
        return this._unixMilliseconds;
    }
}

export function lwwElementToProto(model: LWWElement): Protocol.LWWElement {
    return {
        value: model.value(),
        unixMilliseconds: model.unixMilliseconds(),
    };
}

export function lwwElementFromProto(proto: Protocol.LWWElement): LWWElement {
    return new LWWElement(proto.value, proto.unixMilliseconds);
}

export enum LWWElementSetOperation {
    Add = 0,
    Remove = 1,
}

export class LWWElementSet {
    private _operation: LWWElementSetOperation;
    private _value: Uint8Array;
    private _unixMilliseconds: Long;

    public constructor(
        operation: LWWElementSetOperation,
        value: Uint8Array,
        unixMilliseconds: Long,
    ) {
        this._operation = operation;
        this._value = value;
        this._unixMilliseconds = unixMilliseconds;
    }

    public operation(): LWWElementSetOperation {
        return this._operation;
    }

    public value(): Uint8Array {
        return this._value;
    }

    public unixMilliseconds(): Long {
        return this._unixMilliseconds;
    }
}

export function lwwElementSetOperationToProto(
    model: LWWElementSetOperation,
): Protocol.LWWElementSet_Operation {
    if (model === LWWElementSetOperation.Add) {
        return Protocol.LWWElementSet_Operation.ADD;
    } else {
        return Protocol.LWWElementSet_Operation.REMOVE;
    }
}

function lwwElementSetOperationFromProto(
    proto: Protocol.LWWElementSet_Operation,
): LWWElementSetOperation {
    if (proto === Protocol.LWWElementSet_Operation.ADD) {
        return LWWElementSetOperation.Add;
    } else if (proto === Protocol.LWWElementSet_Operation.REMOVE) {
        return LWWElementSetOperation.Remove;
    } else {
        throw new Error('unknown LWWElementSetOperation');
    }
}

export function lwwElementSetToProto(
    model: LWWElementSet,
): Protocol.LWWElementSet {
    return {
        operation: lwwElementSetOperationToProto(model.operation()),
        value: model.value(),
        unixMilliseconds: model.unixMilliseconds(),
    };
}

export function lwwElementSetFromProto(
    proto: Protocol.LWWElementSet,
): LWWElementSet {
    return new LWWElementSet(
        lwwElementSetOperationFromProto(proto.operation),
        proto.value,
        proto.unixMilliseconds,
    );
}
