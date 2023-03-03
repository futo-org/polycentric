import * as Protocol from './protocol';

import * as Ed from '@noble/ed25519';
import Long from 'long';
import * as FastSHA256 from 'fast-sha256';

import * as Util from './util';

export enum ContentType {
    Delete = 1,
    SystemProcesses = 2,
    Post = 3,
    Follow = 4,
    Username = 5,
    Description = 6,
    BlobMeta = 7,
    BlobSection = 8,
    Avatar = 9,
    Server = 10,
    Vouch = 11,
    Claim = 12,
}

export enum ClaimType {
    HackerNews = 1,
    YouTube = 2,
    Odysee = 3,
    Rumble = 4,
    Twitter = 5,
    Bitcoin = 6,
    Generic = 7,
}

export function claimHackerNews(username: string): Protocol.Claim {
    return {
        claimType: new Long(ClaimType.HackerNews, 0, true),
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimYouTube(username: string): Protocol.Claim {
    return {
        claimType: new Long(ClaimType.YouTube, 0, true),
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimTwitter(username: string): Protocol.Claim {
    return {
        claimType: new Long(ClaimType.Twitter, 0, true),
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimBitcoin(username: string): Protocol.Claim {
    return {
        claimType: new Long(ClaimType.Bitcoin, 0, true),
        claim: Protocol.ClaimIdentifier.encode({
            identifier: username,
        }).finish(),
    };
}

export function claimGeneric(text: string): Protocol.Claim {
    return {
        claimType: new Long(ClaimType.Generic, 0, true),
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

export class Digest {
    private _digestType: Long;
    private _digest: Uint8Array;

    public constructor(digestType: Long, digest: Uint8Array) {
        if (!digestType.equals(Long.UONE)) {
            throw new Error('unknown digest type');
        }

        if (digest.length !== 32) {
            throw new Error('incorrect digest length');
        }

        this._digestType = digestType;
        this._digest = digest;
    }

    public digestType(): Long {
        return this._digestType;
    }

    public digest(): Uint8Array {
        return this._digest;
    }
}

export function digestFromProto(proto: Protocol.Digest): Digest {
    return new Digest(proto.digestType, proto.digest);
}

export function digestToProto(digest: Digest): Protocol.Digest {
    return {
        digestType: digest.digestType(),
        digest: digest.digest(),
    };
}

export async function hash(bytes: Uint8Array): Promise<Digest> {
    const context = new FastSHA256.Hash();
    context.update(bytes);
    return new Digest(Long.UONE, await context.digest());
}

export class Pointer {
    private _system: PublicKey;
    private _process: Process;
    private _logicalClock: Long;
    private _digest: Digest;

    public constructor(
        system: PublicKey,
        process: Process,
        logicalClock: Long,
        digest: Digest,
    ) {
        this._system = system;
        this._process = process;
        this._logicalClock = logicalClock;
        this._digest = digest;
    }

    public system(): PublicKey {
        return this._system;
    }

    public process(): Process {
        return this._process;
    }

    public logicalClock(): Long {
        return this._logicalClock;
    }

    public digest(): Digest {
        return this._digest;
    }
}

export function pointerFromProto(proto: Protocol.Pointer): Pointer {
    if (proto.system === undefined) {
        throw new Error('expected system');
    }

    if (proto.process === undefined) {
        throw new Error('expected process');
    }

    if (proto.eventDigest === undefined) {
        throw new Error('expected digest');
    }

    return new Pointer(
        publicKeyFromProto(proto.system),
        processFromProto(proto.process),
        proto.logicalClock,
        digestFromProto(proto.eventDigest),
    );
}

export function pointerToProto(pointer: Pointer): Protocol.Pointer {
    return {
        system: publicKeyToProto(pointer.system()),
        process: processToProto(pointer.process()),
        logicalClock: pointer.logicalClock(),
        eventDigest: digestToProto(pointer.digest()),
    };
}

export function pointerToReference(pointer: Pointer): Protocol.Reference {
    return {
        referenceType: new Long(2, 0, true),
        reference: Protocol.Pointer.encode(pointerToProto(pointer)).finish(),
    };
}

export class PublicKey {
    private _keyType: Long;
    private _key: Uint8Array;

    public constructor(keyType: Long, key: Uint8Array) {
        if (!keyType.equals(Long.UONE)) {
            throw new Error('unknown key type');
        }

        if (key.length !== 32) {
            throw new Error('incorrect public key length');
        }

        this._keyType = keyType;
        this._key = key;
    }

    public async verify(
        signature: Uint8Array,
        bytes: Uint8Array,
    ): Promise<boolean> {
        return await Ed.verify(signature, bytes, this._key);
    }

    public keyType(): Long {
        return this._keyType;
    }

    public key(): Uint8Array {
        return this._key;
    }
}

export function publicKeyFromProto(proto: Protocol.PublicKey): PublicKey {
    return new PublicKey(proto.keyType, proto.key);
}

export function publicKeyToProto(publicKey: PublicKey): Protocol.PublicKey {
    return {
        keyType: publicKey.keyType(),
        key: publicKey.key(),
    };
}

export function publicKeysEqual(a: PublicKey, b: PublicKey): boolean {
    if (!a.keyType().equals(b.keyType())) {
        return false;
    }

    return Util.buffersEqual(a.key(), b.key());
}

export class PrivateKey {
    private _keyType: Long;
    private _key: Uint8Array;

    public constructor(keyType: Long, key: Uint8Array) {
        if (!keyType.equals(Long.UONE)) {
            throw new Error('unknown key type');
        }

        if (key.length !== 32) {
            throw new Error('incorrect private key length');
        }

        this._keyType = keyType;
        this._key = key;
    }

    public async sign(bytes: Uint8Array): Promise<Uint8Array> {
        return await Ed.sign(bytes, this._key);
    }

    public async derivePublicKey(): Promise<PublicKey> {
        return new PublicKey(this._keyType, await Ed.getPublicKey(this._key));
    }

    public keyType(): Long {
        return this._keyType;
    }

    public key(): Uint8Array {
        return this._key;
    }
}

function privateKeyFromProto(proto: Protocol.PrivateKey): PrivateKey {
    return new PrivateKey(proto.keyType, proto.key);
}

export function privateKeyToProto(privateKey: PrivateKey): Protocol.PrivateKey {
    return {
        keyType: privateKey.keyType(),
        key: privateKey.key(),
    };
}

export function generateRandomPrivateKey(): PrivateKey {
    return new PrivateKey(Long.UONE, Ed.utils.randomPrivateKey());
}

export class Process {
    private _process: Uint8Array;

    public constructor(process: Uint8Array) {
        if (process.length !== 16) {
            throw new Error('incorrect process size');
        }

        this._process = process;
    }

    public process(): Uint8Array {
        return this._process;
    }
}

export function processFromProto(proto: Protocol.Process): Process {
    return new Process(proto.process);
}

export function processToProto(process: Process): Protocol.Process {
    return {
        process: process.process(),
    };
}

export function processesEqual(a: Process, b: Process): boolean {
    return Util.buffersEqual(a.process(), b.process());
}

export function generateRandomProcess(): Process {
    return new Process(Ed.utils.randomPrivateKey().slice(0, 16));
}

export class Event {
    private _system: PublicKey;
    private _process: Process;
    private _logicalClock: Long;
    private _contentType: Long;
    private _content: Uint8Array;
    private _lwwElementSet: LWWElementSet | undefined;
    private _lwwElement: LWWElement | undefined;
    private _references: Array<Protocol.Reference>;
    private _indices: Array<Protocol.Index>;

    public constructor(
        system: PublicKey,
        process: Process,
        logicalClock: Long,
        contentType: Long,
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

    public system(): PublicKey {
        return this._system;
    }

    public process(): Process {
        return this._process;
    }

    public logicalClock(): Long {
        return this._logicalClock;
    }

    public contentType(): Long {
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
        publicKeyFromProto(proto.system),
        processFromProto(proto.process),
        proto.logicalClock,
        proto.contentType,
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
        system: publicKeyToProto(event.system()),
        process: processToProto(event.process()),
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

export class SignedEvent {
    private _signature: Uint8Array;
    private _event: Uint8Array;

    public constructor(signature: Uint8Array, rawEvent: Uint8Array) {
        const event = eventFromProto(Protocol.Event.decode(rawEvent));

        if (!event.system().verify(signature, rawEvent)) {
            throw new Error('signature verification failed');
        }

        this._signature = signature;
        this._event = rawEvent;
    }

    public signature(): Uint8Array {
        return this._signature;
    }

    public event(): Uint8Array {
        return this._event;
    }
}

export function signedEventFromProto(proto: Protocol.SignedEvent): SignedEvent {
    return new SignedEvent(proto.signature, proto.event);
}

export function signedEventToProto(
    signedEvent: SignedEvent,
): Protocol.SignedEvent {
    return {
        signature: signedEvent.signature(),
        event: signedEvent.event(),
    };
}

export async function signedEventToPointer(
    signedEvent: SignedEvent,
): Promise<Pointer> {
    const event = eventFromProtoBuffer(signedEvent.event());
    return new Pointer(
        event.system(),
        event.process(),
        event.logicalClock(),
        await hash(signedEvent.event()),
    );
}

export class ProcessSecret {
    private _system: PrivateKey;
    private _process: Process;

    constructor(system: PrivateKey, process: Process) {
        this._system = system;
        this._process = process;
    }

    public system(): PrivateKey {
        return this._system;
    }

    public process(): Process {
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
        privateKeyFromProto(proto.system),
        processFromProto(proto.process),
    );
}

export function processSecretToProto(
    processSecret: ProcessSecret,
): Protocol.StorageTypeProcessSecret {
    return {
        system: privateKeyToProto(processSecret.system()),
        process: processToProto(processSecret.process()),
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
