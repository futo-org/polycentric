/**
 * This file has been automatically generated by the [capnpc-ts utility](https://github.com/jdiaz5513/capnp-ts).
 */
import * as capnp from "capnp-ts";
import { Struct as __S } from 'capnp-ts';
export declare const _capnpFileId = "cafebabedeadbeef";
export declare class PublicKey extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getKeyType(): capnp.Uint64;
    setKeyType(value: capnp.Uint64): void;
    adoptKey(value: capnp.Orphan<capnp.Data>): void;
    disownKey(): capnp.Orphan<capnp.Data>;
    getKey(): capnp.Data;
    hasKey(): boolean;
    initKey(length: number): capnp.Data;
    setKey(value: capnp.Data): void;
    toString(): string;
}
export declare class Process extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptProcess(value: capnp.Orphan<capnp.Data>): void;
    disownProcess(): capnp.Orphan<capnp.Data>;
    getProcess(): capnp.Data;
    hasProcess(): boolean;
    initProcess(length: number): capnp.Data;
    setProcess(value: capnp.Data): void;
    toString(): string;
}
export declare class Index extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getIndexType(): capnp.Uint64;
    setIndexType(value: capnp.Uint64): void;
    getLogicalClock(): capnp.Uint64;
    setLogicalClock(value: capnp.Uint64): void;
    toString(): string;
}
export declare class Indices extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Indices: capnp.ListCtor<Index>;
    adoptIndices(value: capnp.Orphan<capnp.List<Index>>): void;
    disownIndices(): capnp.Orphan<capnp.List<Index>>;
    getIndices(): capnp.List<Index>;
    hasIndices(): boolean;
    initIndices(length: number): capnp.List<Index>;
    setIndices(value: capnp.List<Index>): void;
    toString(): string;
}
export declare class VectorClock extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptLogicalClocks(value: capnp.Orphan<capnp.List<capnp.Uint64>>): void;
    disownLogicalClocks(): capnp.Orphan<capnp.List<capnp.Uint64>>;
    getLogicalClocks(): capnp.List<capnp.Uint64>;
    hasLogicalClocks(): boolean;
    initLogicalClocks(length: number): capnp.List<capnp.Uint64>;
    setLogicalClocks(value: capnp.List<capnp.Uint64>): void;
    toString(): string;
}
export declare class ModerationTag extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getName(): string;
    setName(value: string): void;
    getLevel(): number;
    setLevel(value: number): void;
    toString(): string;
}
export declare class SignedEvent extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _ModerationTags: capnp.ListCtor<ModerationTag>;
    adoptSignature(value: capnp.Orphan<capnp.Data>): void;
    disownSignature(): capnp.Orphan<capnp.Data>;
    getSignature(): capnp.Data;
    hasSignature(): boolean;
    initSignature(length: number): capnp.Data;
    setSignature(value: capnp.Data): void;
    adoptEvent(value: capnp.Orphan<capnp.Data>): void;
    disownEvent(): capnp.Orphan<capnp.Data>;
    getEvent(): capnp.Data;
    hasEvent(): boolean;
    initEvent(length: number): capnp.Data;
    setEvent(value: capnp.Data): void;
    adoptModerationTags(value: capnp.Orphan<capnp.List<ModerationTag>>): void;
    disownModerationTags(): capnp.Orphan<capnp.List<ModerationTag>>;
    getModerationTags(): capnp.List<ModerationTag>;
    hasModerationTags(): boolean;
    initModerationTags(length: number): capnp.List<ModerationTag>;
    setModerationTags(value: capnp.List<ModerationTag>): void;
    toString(): string;
}
export declare enum LWWElementSet_Operation {
    ADD = 0,
    REMOVE = 1
}
export declare class LWWElementSet extends __S {
    static readonly Operation: typeof LWWElementSet_Operation;
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getOperation(): LWWElementSet_Operation;
    setOperation(value: LWWElementSet_Operation): void;
    adoptValue(value: capnp.Orphan<capnp.Data>): void;
    disownValue(): capnp.Orphan<capnp.Data>;
    getValue(): capnp.Data;
    hasValue(): boolean;
    initValue(length: number): capnp.Data;
    setValue(value: capnp.Data): void;
    getUnixMilliseconds(): capnp.Uint64;
    setUnixMilliseconds(value: capnp.Uint64): void;
    toString(): string;
}
export declare class LWWElement extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptValue(value: capnp.Orphan<capnp.Data>): void;
    disownValue(): capnp.Orphan<capnp.Data>;
    getValue(): capnp.Data;
    hasValue(): boolean;
    initValue(length: number): capnp.Data;
    setValue(value: capnp.Data): void;
    getUnixMilliseconds(): capnp.Uint64;
    setUnixMilliseconds(value: capnp.Uint64): void;
    toString(): string;
}
export declare class Server extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getServer(): string;
    setServer(value: string): void;
    toString(): string;
}
export declare class ImageManifest extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Sections: capnp.ListCtor<Range>;
    getMime(): string;
    setMime(value: string): void;
    getWidth(): capnp.Uint64;
    setWidth(value: capnp.Uint64): void;
    getHeight(): capnp.Uint64;
    setHeight(value: capnp.Uint64): void;
    getByteCount(): capnp.Uint64;
    setByteCount(value: capnp.Uint64): void;
    adoptProcess(value: capnp.Orphan<Process>): void;
    disownProcess(): capnp.Orphan<Process>;
    getProcess(): Process;
    hasProcess(): boolean;
    initProcess(): Process;
    setProcess(value: Process): void;
    adoptSections(value: capnp.Orphan<capnp.List<Range>>): void;
    disownSections(): capnp.Orphan<capnp.List<Range>>;
    getSections(): capnp.List<Range>;
    hasSections(): boolean;
    initSections(length: number): capnp.List<Range>;
    setSections(value: capnp.List<Range>): void;
    toString(): string;
}
export declare class ImageBundle extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _ImageManifests: capnp.ListCtor<ImageManifest>;
    adoptImageManifests(value: capnp.Orphan<capnp.List<ImageManifest>>): void;
    disownImageManifests(): capnp.Orphan<capnp.List<ImageManifest>>;
    getImageManifests(): capnp.List<ImageManifest>;
    hasImageManifests(): boolean;
    initImageManifests(length: number): capnp.List<ImageManifest>;
    setImageManifests(value: capnp.List<ImageManifest>): void;
    toString(): string;
}
export declare class Event extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _References: capnp.ListCtor<Reference>;
    adoptSystem(value: capnp.Orphan<PublicKey>): void;
    disownSystem(): capnp.Orphan<PublicKey>;
    getSystem(): PublicKey;
    hasSystem(): boolean;
    initSystem(): PublicKey;
    setSystem(value: PublicKey): void;
    adoptProcess(value: capnp.Orphan<Process>): void;
    disownProcess(): capnp.Orphan<Process>;
    getProcess(): Process;
    hasProcess(): boolean;
    initProcess(): Process;
    setProcess(value: Process): void;
    getLogicalClock(): capnp.Uint64;
    setLogicalClock(value: capnp.Uint64): void;
    getContentType(): capnp.Uint64;
    setContentType(value: capnp.Uint64): void;
    adoptContent(value: capnp.Orphan<capnp.Data>): void;
    disownContent(): capnp.Orphan<capnp.Data>;
    getContent(): capnp.Data;
    hasContent(): boolean;
    initContent(length: number): capnp.Data;
    setContent(value: capnp.Data): void;
    adoptVectorClock(value: capnp.Orphan<VectorClock>): void;
    disownVectorClock(): capnp.Orphan<VectorClock>;
    getVectorClock(): VectorClock;
    hasVectorClock(): boolean;
    initVectorClock(): VectorClock;
    setVectorClock(value: VectorClock): void;
    adoptIndices(value: capnp.Orphan<Indices>): void;
    disownIndices(): capnp.Orphan<Indices>;
    getIndices(): Indices;
    hasIndices(): boolean;
    initIndices(): Indices;
    setIndices(value: Indices): void;
    adoptLwwElementSet(value: capnp.Orphan<LWWElementSet>): void;
    disownLwwElementSet(): capnp.Orphan<LWWElementSet>;
    getLwwElementSet(): LWWElementSet;
    hasLwwElementSet(): boolean;
    initLwwElementSet(): LWWElementSet;
    setLwwElementSet(value: LWWElementSet): void;
    adoptLwwElement(value: capnp.Orphan<LWWElement>): void;
    disownLwwElement(): capnp.Orphan<LWWElement>;
    getLwwElement(): LWWElement;
    hasLwwElement(): boolean;
    initLwwElement(): LWWElement;
    setLwwElement(value: LWWElement): void;
    adoptReferences(value: capnp.Orphan<capnp.List<Reference>>): void;
    disownReferences(): capnp.Orphan<capnp.List<Reference>>;
    getReferences(): capnp.List<Reference>;
    hasReferences(): boolean;
    initReferences(length: number): capnp.List<Reference>;
    setReferences(value: capnp.List<Reference>): void;
    getUnixMilliseconds(): capnp.Uint64;
    setUnixMilliseconds(value: capnp.Uint64): void;
    toString(): string;
}
export declare class SystemProcesses extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Processes: capnp.ListCtor<Process>;
    adoptProcesses(value: capnp.Orphan<capnp.List<Process>>): void;
    disownProcesses(): capnp.Orphan<capnp.List<Process>>;
    getProcesses(): capnp.List<Process>;
    hasProcesses(): boolean;
    initProcesses(length: number): capnp.List<Process>;
    setProcesses(value: capnp.List<Process>): void;
    toString(): string;
}
export declare class Digest extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getDigestType(): capnp.Uint64;
    setDigestType(value: capnp.Uint64): void;
    adoptDigest(value: capnp.Orphan<capnp.Data>): void;
    disownDigest(): capnp.Orphan<capnp.Data>;
    getDigest(): capnp.Data;
    hasDigest(): boolean;
    initDigest(length: number): capnp.Data;
    setDigest(value: capnp.Data): void;
    toString(): string;
}
export declare class Pointer extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptSystem(value: capnp.Orphan<PublicKey>): void;
    disownSystem(): capnp.Orphan<PublicKey>;
    getSystem(): PublicKey;
    hasSystem(): boolean;
    initSystem(): PublicKey;
    setSystem(value: PublicKey): void;
    adoptProcess(value: capnp.Orphan<Process>): void;
    disownProcess(): capnp.Orphan<Process>;
    getProcess(): Process;
    hasProcess(): boolean;
    initProcess(): Process;
    setProcess(value: Process): void;
    getLogicalClock(): capnp.Uint64;
    setLogicalClock(value: capnp.Uint64): void;
    adoptEventDigest(value: capnp.Orphan<Digest>): void;
    disownEventDigest(): capnp.Orphan<Digest>;
    getEventDigest(): Digest;
    hasEventDigest(): boolean;
    initEventDigest(): Digest;
    setEventDigest(value: Digest): void;
    toString(): string;
}
export declare class Delete extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptProcess(value: capnp.Orphan<Process>): void;
    disownProcess(): capnp.Orphan<Process>;
    getProcess(): Process;
    hasProcess(): boolean;
    initProcess(): Process;
    setProcess(value: Process): void;
    getLogicalClock(): capnp.Uint64;
    setLogicalClock(value: capnp.Uint64): void;
    adoptIndices(value: capnp.Orphan<Indices>): void;
    disownIndices(): capnp.Orphan<Indices>;
    getIndices(): Indices;
    hasIndices(): boolean;
    initIndices(): Indices;
    setIndices(value: Indices): void;
    getUnixMilliseconds(): capnp.Uint64;
    setUnixMilliseconds(value: capnp.Uint64): void;
    getContentType(): capnp.Uint64;
    setContentType(value: capnp.Uint64): void;
    toString(): string;
}
export declare class Events extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Events: capnp.ListCtor<SignedEvent>;
    adoptEvents(value: capnp.Orphan<capnp.List<SignedEvent>>): void;
    disownEvents(): capnp.Orphan<capnp.List<SignedEvent>>;
    getEvents(): capnp.List<SignedEvent>;
    hasEvents(): boolean;
    initEvents(length: number): capnp.List<SignedEvent>;
    setEvents(value: capnp.List<SignedEvent>): void;
    toString(): string;
}
export declare class AggregationBucket extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptKey(value: capnp.Orphan<capnp.Data>): void;
    disownKey(): capnp.Orphan<capnp.Data>;
    getKey(): capnp.Data;
    hasKey(): boolean;
    initKey(length: number): capnp.Data;
    setKey(value: capnp.Data): void;
    getValue(): capnp.Int64;
    setValue(value: capnp.Int64): void;
    toString(): string;
}
export declare class PublicKeys extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Systems: capnp.ListCtor<PublicKey>;
    adoptSystems(value: capnp.Orphan<capnp.List<PublicKey>>): void;
    disownSystems(): capnp.Orphan<capnp.List<PublicKey>>;
    getSystems(): capnp.List<PublicKey>;
    hasSystems(): boolean;
    initSystems(length: number): capnp.List<PublicKey>;
    setSystems(value: capnp.List<PublicKey>): void;
    toString(): string;
}
export declare class Range extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getLow(): capnp.Uint64;
    setLow(value: capnp.Uint64): void;
    getHigh(): capnp.Uint64;
    setHigh(value: capnp.Uint64): void;
    toString(): string;
}
export declare class RangesForProcess extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Ranges: capnp.ListCtor<Range>;
    adoptProcess(value: capnp.Orphan<Process>): void;
    disownProcess(): capnp.Orphan<Process>;
    getProcess(): Process;
    hasProcess(): boolean;
    initProcess(): Process;
    setProcess(value: Process): void;
    adoptRanges(value: capnp.Orphan<capnp.List<Range>>): void;
    disownRanges(): capnp.Orphan<capnp.List<Range>>;
    getRanges(): capnp.List<Range>;
    hasRanges(): boolean;
    initRanges(length: number): capnp.List<Range>;
    setRanges(value: capnp.List<Range>): void;
    toString(): string;
}
export declare class RangesForSystem extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _RangesForProcesses: capnp.ListCtor<RangesForProcess>;
    adoptRangesForProcesses(value: capnp.Orphan<capnp.List<RangesForProcess>>): void;
    disownRangesForProcesses(): capnp.Orphan<capnp.List<RangesForProcess>>;
    getRangesForProcesses(): capnp.List<RangesForProcess>;
    hasRangesForProcesses(): boolean;
    initRangesForProcesses(length: number): capnp.List<RangesForProcess>;
    setRangesForProcesses(value: capnp.List<RangesForProcess>): void;
    toString(): string;
}
export declare class PrivateKey extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getKeyType(): capnp.Uint64;
    setKeyType(value: capnp.Uint64): void;
    adoptKey(value: capnp.Orphan<capnp.Data>): void;
    disownKey(): capnp.Orphan<capnp.Data>;
    getKey(): capnp.Data;
    hasKey(): boolean;
    initKey(length: number): capnp.Data;
    setKey(value: capnp.Data): void;
    toString(): string;
}
export declare class KeyPair extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getKeyType(): capnp.Uint64;
    setKeyType(value: capnp.Uint64): void;
    adoptPrivateKey(value: capnp.Orphan<capnp.Data>): void;
    disownPrivateKey(): capnp.Orphan<capnp.Data>;
    getPrivateKey(): capnp.Data;
    hasPrivateKey(): boolean;
    initPrivateKey(length: number): capnp.Data;
    setPrivateKey(value: capnp.Data): void;
    adoptPublicKey(value: capnp.Orphan<capnp.Data>): void;
    disownPublicKey(): capnp.Orphan<capnp.Data>;
    getPublicKey(): capnp.Data;
    hasPublicKey(): boolean;
    initPublicKey(length: number): capnp.Data;
    setPublicKey(value: capnp.Data): void;
    toString(): string;
}
export declare class ExportBundle extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptKeyPair(value: capnp.Orphan<KeyPair>): void;
    disownKeyPair(): capnp.Orphan<KeyPair>;
    getKeyPair(): KeyPair;
    hasKeyPair(): boolean;
    initKeyPair(): KeyPair;
    setKeyPair(value: KeyPair): void;
    adoptEvents(value: capnp.Orphan<Events>): void;
    disownEvents(): capnp.Orphan<Events>;
    getEvents(): Events;
    hasEvents(): boolean;
    initEvents(): Events;
    setEvents(value: Events): void;
    toString(): string;
}
export declare class ResultEventsAndRelatedEventsAndCursor extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptResultEvents(value: capnp.Orphan<Events>): void;
    disownResultEvents(): capnp.Orphan<Events>;
    getResultEvents(): Events;
    hasResultEvents(): boolean;
    initResultEvents(): Events;
    setResultEvents(value: Events): void;
    adoptRelatedEvents(value: capnp.Orphan<Events>): void;
    disownRelatedEvents(): capnp.Orphan<Events>;
    getRelatedEvents(): Events;
    hasRelatedEvents(): boolean;
    initRelatedEvents(): Events;
    setRelatedEvents(value: Events): void;
    adoptCursor(value: capnp.Orphan<capnp.Data>): void;
    disownCursor(): capnp.Orphan<capnp.Data>;
    getCursor(): capnp.Data;
    hasCursor(): boolean;
    initCursor(length: number): capnp.Data;
    setCursor(value: capnp.Data): void;
    toString(): string;
}
export declare class ResultTopStringReferences extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Buckets: capnp.ListCtor<AggregationBucket>;
    adoptBuckets(value: capnp.Orphan<capnp.List<AggregationBucket>>): void;
    disownBuckets(): capnp.Orphan<capnp.List<AggregationBucket>>;
    getBuckets(): capnp.List<AggregationBucket>;
    hasBuckets(): boolean;
    initBuckets(length: number): capnp.List<AggregationBucket>;
    setBuckets(value: capnp.List<AggregationBucket>): void;
    toString(): string;
}
export declare class Reference extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getReferenceType(): capnp.Uint64;
    setReferenceType(value: capnp.Uint64): void;
    adoptReference(value: capnp.Orphan<capnp.Data>): void;
    disownReference(): capnp.Orphan<capnp.Data>;
    getReference(): capnp.Data;
    hasReference(): boolean;
    initReference(length: number): capnp.Data;
    setReference(value: capnp.Data): void;
    toString(): string;
}
export declare class Post extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getContent(): string;
    setContent(value: string): void;
    adoptImage(value: capnp.Orphan<ImageManifest>): void;
    disownImage(): capnp.Orphan<ImageManifest>;
    getImage(): ImageManifest;
    hasImage(): boolean;
    initImage(): ImageManifest;
    setImage(value: ImageManifest): void;
    toString(): string;
}
export declare class Claim extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _ClaimFields: capnp.ListCtor<ClaimFieldEntry>;
    getClaimType(): capnp.Uint64;
    setClaimType(value: capnp.Uint64): void;
    adoptClaimFields(value: capnp.Orphan<capnp.List<ClaimFieldEntry>>): void;
    disownClaimFields(): capnp.Orphan<capnp.List<ClaimFieldEntry>>;
    getClaimFields(): capnp.List<ClaimFieldEntry>;
    hasClaimFields(): boolean;
    initClaimFields(length: number): capnp.List<ClaimFieldEntry>;
    setClaimFields(value: capnp.List<ClaimFieldEntry>): void;
    toString(): string;
}
export declare class ClaimFieldEntry extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getKey(): capnp.Uint64;
    setKey(value: capnp.Uint64): void;
    getValue(): string;
    setValue(value: string): void;
    toString(): string;
}
export declare class Vouch extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    toString(): string;
}
export declare class StorageTypeProcessSecret extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptSystem(value: capnp.Orphan<PrivateKey>): void;
    disownSystem(): capnp.Orphan<PrivateKey>;
    getSystem(): PrivateKey;
    hasSystem(): boolean;
    initSystem(): PrivateKey;
    setSystem(value: PrivateKey): void;
    adoptProcess(value: capnp.Orphan<Process>): void;
    disownProcess(): capnp.Orphan<Process>;
    getProcess(): Process;
    hasProcess(): boolean;
    initProcess(): Process;
    setProcess(value: Process): void;
    toString(): string;
}
export declare class StorageTypeProcessState extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Ranges: capnp.ListCtor<Range>;
    getLogicalClock(): capnp.Uint64;
    setLogicalClock(value: capnp.Uint64): void;
    adoptRanges(value: capnp.Orphan<capnp.List<Range>>): void;
    disownRanges(): capnp.Orphan<capnp.List<Range>>;
    getRanges(): capnp.List<Range>;
    hasRanges(): boolean;
    initRanges(length: number): capnp.List<Range>;
    setRanges(value: capnp.List<Range>): void;
    adoptIndices(value: capnp.Orphan<Indices>): void;
    disownIndices(): capnp.Orphan<Indices>;
    getIndices(): Indices;
    hasIndices(): boolean;
    initIndices(): Indices;
    setIndices(value: Indices): void;
    toString(): string;
}
export declare class StorageTypeCRDTSetItem extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getContentType(): capnp.Uint64;
    setContentType(value: capnp.Uint64): void;
    adoptValue(value: capnp.Orphan<capnp.Data>): void;
    disownValue(): capnp.Orphan<capnp.Data>;
    getValue(): capnp.Data;
    hasValue(): boolean;
    initValue(length: number): capnp.Data;
    setValue(value: capnp.Data): void;
    getUnixMilliseconds(): capnp.Uint64;
    setUnixMilliseconds(value: capnp.Uint64): void;
    getOperation(): LWWElementSet_Operation;
    setOperation(value: LWWElementSet_Operation): void;
    toString(): string;
}
export declare class StorageTypeCRDTItem extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getContentType(): capnp.Uint64;
    setContentType(value: capnp.Uint64): void;
    adoptValue(value: capnp.Orphan<capnp.Data>): void;
    disownValue(): capnp.Orphan<capnp.Data>;
    getValue(): capnp.Data;
    hasValue(): boolean;
    initValue(length: number): capnp.Data;
    setValue(value: capnp.Data): void;
    getUnixMilliseconds(): capnp.Uint64;
    setUnixMilliseconds(value: capnp.Uint64): void;
    toString(): string;
}
export declare class StorageTypeSystemState extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _Processes: capnp.ListCtor<Process>;
    static _CrdtItems: capnp.ListCtor<StorageTypeCRDTItem>;
    adoptProcesses(value: capnp.Orphan<capnp.List<Process>>): void;
    disownProcesses(): capnp.Orphan<capnp.List<Process>>;
    getProcesses(): capnp.List<Process>;
    hasProcesses(): boolean;
    initProcesses(length: number): capnp.List<Process>;
    setProcesses(value: capnp.List<Process>): void;
    adoptCrdtItems(value: capnp.Orphan<capnp.List<StorageTypeCRDTItem>>): void;
    disownCrdtItems(): capnp.Orphan<capnp.List<StorageTypeCRDTItem>>;
    getCrdtItems(): capnp.List<StorageTypeCRDTItem>;
    hasCrdtItems(): boolean;
    initCrdtItems(length: number): capnp.List<StorageTypeCRDTItem>;
    setCrdtItems(value: capnp.List<StorageTypeCRDTItem>): void;
    toString(): string;
}
export declare class StorageTypeEvent extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptEvent(value: capnp.Orphan<SignedEvent>): void;
    disownEvent(): capnp.Orphan<SignedEvent>;
    getEvent(): SignedEvent;
    hasEvent(): boolean;
    initEvent(): SignedEvent;
    setEvent(value: SignedEvent): void;
    adoptMutationPointer(value: capnp.Orphan<Pointer>): void;
    disownMutationPointer(): capnp.Orphan<Pointer>;
    getMutationPointer(): Pointer;
    hasMutationPointer(): boolean;
    initMutationPointer(): Pointer;
    setMutationPointer(value: Pointer): void;
    toString(): string;
}
export declare class RepeatedUInt64 extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptNumbers(value: capnp.Orphan<capnp.List<capnp.Uint64>>): void;
    disownNumbers(): capnp.Orphan<capnp.List<capnp.Uint64>>;
    getNumbers(): capnp.List<capnp.Uint64>;
    hasNumbers(): boolean;
    initNumbers(length: number): capnp.List<capnp.Uint64>;
    setNumbers(value: capnp.List<capnp.Uint64>): void;
    toString(): string;
}
export declare class QueryReferencesRequest extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _CountLwwElementReferences: capnp.ListCtor<QueryReferencesRequestCountLWWElementReferences>;
    static _CountReferences: capnp.ListCtor<QueryReferencesRequestCountReferences>;
    adoptReference(value: capnp.Orphan<Reference>): void;
    disownReference(): capnp.Orphan<Reference>;
    getReference(): Reference;
    hasReference(): boolean;
    initReference(): Reference;
    setReference(value: Reference): void;
    adoptCursor(value: capnp.Orphan<capnp.Data>): void;
    disownCursor(): capnp.Orphan<capnp.Data>;
    getCursor(): capnp.Data;
    hasCursor(): boolean;
    initCursor(length: number): capnp.Data;
    setCursor(value: capnp.Data): void;
    adoptRequestEvents(value: capnp.Orphan<QueryReferencesRequestEvents>): void;
    disownRequestEvents(): capnp.Orphan<QueryReferencesRequestEvents>;
    getRequestEvents(): QueryReferencesRequestEvents;
    hasRequestEvents(): boolean;
    initRequestEvents(): QueryReferencesRequestEvents;
    setRequestEvents(value: QueryReferencesRequestEvents): void;
    adoptCountLwwElementReferences(value: capnp.Orphan<capnp.List<QueryReferencesRequestCountLWWElementReferences>>): void;
    disownCountLwwElementReferences(): capnp.Orphan<capnp.List<QueryReferencesRequestCountLWWElementReferences>>;
    getCountLwwElementReferences(): capnp.List<QueryReferencesRequestCountLWWElementReferences>;
    hasCountLwwElementReferences(): boolean;
    initCountLwwElementReferences(length: number): capnp.List<QueryReferencesRequestCountLWWElementReferences>;
    setCountLwwElementReferences(value: capnp.List<QueryReferencesRequestCountLWWElementReferences>): void;
    adoptCountReferences(value: capnp.Orphan<capnp.List<QueryReferencesRequestCountReferences>>): void;
    disownCountReferences(): capnp.Orphan<capnp.List<QueryReferencesRequestCountReferences>>;
    getCountReferences(): capnp.List<QueryReferencesRequestCountReferences>;
    hasCountReferences(): boolean;
    initCountReferences(length: number): capnp.List<QueryReferencesRequestCountReferences>;
    setCountReferences(value: capnp.List<QueryReferencesRequestCountReferences>): void;
    adoptExtraByteReferences(value: capnp.Orphan<capnp.List<capnp.Data>>): void;
    disownExtraByteReferences(): capnp.Orphan<capnp.List<capnp.Data>>;
    getExtraByteReferences(): capnp.List<capnp.Data>;
    hasExtraByteReferences(): boolean;
    initExtraByteReferences(length: number): capnp.List<capnp.Data>;
    setExtraByteReferences(value: capnp.List<capnp.Data>): void;
    toString(): string;
}
export declare class QueryReferencesRequestEvents extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    static _CountLwwElementReferences: capnp.ListCtor<QueryReferencesRequestCountLWWElementReferences>;
    static _CountReferences: capnp.ListCtor<QueryReferencesRequestCountReferences>;
    getFromType(): capnp.Uint64;
    setFromType(value: capnp.Uint64): void;
    adoptCountLwwElementReferences(value: capnp.Orphan<capnp.List<QueryReferencesRequestCountLWWElementReferences>>): void;
    disownCountLwwElementReferences(): capnp.Orphan<capnp.List<QueryReferencesRequestCountLWWElementReferences>>;
    getCountLwwElementReferences(): capnp.List<QueryReferencesRequestCountLWWElementReferences>;
    hasCountLwwElementReferences(): boolean;
    initCountLwwElementReferences(length: number): capnp.List<QueryReferencesRequestCountLWWElementReferences>;
    setCountLwwElementReferences(value: capnp.List<QueryReferencesRequestCountLWWElementReferences>): void;
    adoptCountReferences(value: capnp.Orphan<capnp.List<QueryReferencesRequestCountReferences>>): void;
    disownCountReferences(): capnp.Orphan<capnp.List<QueryReferencesRequestCountReferences>>;
    getCountReferences(): capnp.List<QueryReferencesRequestCountReferences>;
    hasCountReferences(): boolean;
    initCountReferences(length: number): capnp.List<QueryReferencesRequestCountReferences>;
    setCountReferences(value: capnp.List<QueryReferencesRequestCountReferences>): void;
    toString(): string;
}
export declare class QueryReferencesRequestCountLWWElementReferences extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptValue(value: capnp.Orphan<capnp.Data>): void;
    disownValue(): capnp.Orphan<capnp.Data>;
    getValue(): capnp.Data;
    hasValue(): boolean;
    initValue(length: number): capnp.Data;
    setValue(value: capnp.Data): void;
    getFromType(): capnp.Uint64;
    setFromType(value: capnp.Uint64): void;
    toString(): string;
}
export declare class QueryReferencesRequestCountReferences extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    getFromType(): capnp.Uint64;
    setFromType(value: capnp.Uint64): void;
    toString(): string;
}
export declare class QueryReferencesResponseEventItem extends __S {
    static readonly _capnp: {
        displayName: string;
        id: string;
        size: capnp.ObjectSize;
    };
    adoptEvent(value: capnp.Orphan<SignedEvent>): void;
    disownEvent(): capnp.Orphan<SignedEvent>;
    getEvent(): SignedEvent;
    hasEvent(): boolean;
    initEvent(): SignedEvent;
    setEvent(value: SignedEvent): void;
    toString(): string;
}
