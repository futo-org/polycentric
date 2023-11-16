import * as Protocol from './protocol';

import * as Base64 from '@borderless/base64';
import * as Ed from '@noble/ed25519';
import * as FastSHA256 from 'fast-sha256';
import Long from 'long';

import * as Util from './util';

export namespace ContentType {
    export type ContentType = Readonly<Long> & {
        readonly __tag: unique symbol;
    };

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
    export const ContentTypeOpinion = makeContentType(14);
    export const ContentTypeStore = makeContentType(15);
    export const ContentTypeAuthority = makeContentType(16);
}

export namespace CensorshipType {
    export const RefuseStorage = 'refuse_storage';
    export const DoNotRecommend = 'do_not_recommend';
}

export namespace Opinion {
    export type Opinion = Readonly<Uint8Array> & {
        readonly __tag: unique symbol;
    };

    function makeOpinion(x: number): Opinion {
        return new Uint8Array([x]) as Opinion;
    }

    export const OpinionLike = makeOpinion(1);
    export const OpinionDislike = makeOpinion(2);
    export const OpinionNeutral = makeOpinion(3);

    export function equal(a: Opinion, b: Opinion): boolean {
        return Util.buffersEqual(a, b);
    }
}

export namespace PublicKey {
    export type PublicKey = Readonly<Protocol.PublicKey> & {
        readonly __tag: unique symbol;
    };

    export type PublicKeyString = Readonly<string> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(proto: Protocol.PublicKey): PublicKey {
        if (!proto.keyType.equals(Long.UONE)) {
            throw new Error('unknown key type');
        }

        if (proto.key.length !== 32) {
            throw new Error('incorrect public key length');
        }

        return proto as PublicKey;
    }

    export function toString(key: PublicKey): PublicKeyString {
        return Base64.encode(
            Protocol.PublicKey.encode(key).finish(),
        ) as PublicKeyString;
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
    export type PrivateKey = Readonly<Protocol.PrivateKey> & {
        readonly __tag: unique symbol;
    };

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
    export type Digest = Readonly<Protocol.Digest> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(proto: Protocol.Digest): Digest {
        if (!proto.digestType.equals(Long.UONE)) {
            throw new Error('unknown digest type');
        }

        if (proto.digest.length !== 32) {
            throw new Error('incorrect digest length');
        }

        return proto as Digest;
    }

    export function equal(a: Digest, b: Digest): boolean {
        return (
            a.digestType.equals(b.digestType) &&
            Util.buffersEqual(b.digest, b.digest)
        );
    }
}

export namespace Process {
    export type Process = Readonly<Protocol.Process> & {
        readonly __tag: unique symbol;
    };

    export type ProcessString = Readonly<string> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(proto: Protocol.Process): Process {
        if (proto.process.length !== 16) {
            throw new Error('incorrect process size');
        }

        return proto as Process;
    }

    export function toString(process: Process): ProcessString {
        return Base64.encode(
            Protocol.Process.encode(process).finish(),
        ) as ProcessString;
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

    export type Pointer = Readonly<PointerI> & {
        readonly __tag: unique symbol;
    };

    export type PointerString = Readonly<string> & {
        readonly __tag: unique symbol;
    };

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

    export function toString(pointer: Pointer): PointerString {
        return Base64.encode(
            Protocol.Pointer.encode(pointer).finish(),
        ) as PointerString;
    }

    export function fromBuffer(buffer: Uint8Array): Pointer {
        return fromProto(Protocol.Pointer.decode(buffer));
    }

    export function equal(a: Pointer, b: Pointer): boolean {
        return (
            PublicKey.equal(a.system, b.system) &&
            Process.equal(a.process, b.process) &&
            a.logicalClock.equals(b.logicalClock) &&
            Digest.equal(a.eventDigest, b.eventDigest)
        );
    }
}

export namespace ProcessSecret {
    interface ProcessSecretI {
        system: PrivateKey.PrivateKey;
        process: Process.Process;
    }

    export type ProcessSecret = Readonly<ProcessSecretI> & {
        readonly __tag: unique symbol;
    };

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

export namespace Delete {
    interface DeleteI {
        process: Process.Process;
        logicalClock: Long;
        indices: Protocol.Indices;
        unixMilliseconds: Long | undefined;
        contentType: ContentType.ContentType;
    }

    export type Delete = Readonly<DeleteI> & { readonly __tag: unique symbol };

    export function fromProto(proto: Protocol.Delete): Delete {
        if (proto.process === undefined) {
            throw new Error('expected process');
        }

        Process.fromProto(proto.process);

        return proto as Delete;
    }

    export function fromBuffer(buffer: Uint8Array): Delete {
        return fromProto(Protocol.Delete.decode(buffer));
    }
}

export namespace Event {
    interface EventI {
        system: PublicKey.PublicKey;
        process: Process.Process;
        logicalClock: Long;
        contentType: ContentType.ContentType;
        content: Uint8Array;
        vectorClock: Protocol.VectorClock;
        lwwElementSet: Protocol.LWWElementSet | undefined;
        lwwElement: Protocol.LWWElement | undefined;
        references: Array<Protocol.Reference>;
        indices: Protocol.Indices;
        unixMilliseconds: Long | undefined;
    }

    export type Event = Readonly<EventI> & { readonly __tag: unique symbol };

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

        return proto as Event;
    }

    export function fromBuffer(buffer: Uint8Array): Event {
        return fromProto(Protocol.Event.decode(buffer));
    }
}

export namespace SignedEvent {
    export type SignedEvent = Readonly<Protocol.SignedEvent> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(proto: Protocol.SignedEvent): SignedEvent {
        const event = Event.fromProto(Protocol.Event.decode(proto.event));

        if (!PublicKey.verify(event.system, proto.signature, proto.event)) {
            throw new Error('signature verification failed');
        }

        return proto as SignedEvent;
    }

    export function fromBuffer(buffer: Uint8Array): SignedEvent {
        return fromProto(Protocol.SignedEvent.decode(buffer));
    }

    export function equal(x: SignedEvent, y: SignedEvent): boolean {
        if (!Util.buffersEqual(x.signature, y.signature)) {
            return false;
        }

        if (!Util.buffersEqual(x.event, y.event)) {
            return false;
        }

        return true;
    }
}

export namespace ClaimType {
    export type ClaimType = Readonly<Long> & {
        readonly __tag: unique symbol;
    };

    function makeClaimType(x: number): ClaimType {
        return new Long(x, 0, true) as ClaimType;
    }

    export const ClaimTypeHackerNews = makeClaimType(1);
    export const ClaimTypeYouTube = makeClaimType(2);
    export const ClaimTypeOdysee = makeClaimType(3);
    export const ClaimTypeRumble = makeClaimType(4);
    export const ClaimTypeTwitter = makeClaimType(5);
    export const ClaimTypeBitcoin = makeClaimType(6);
    export const ClaimTypeGeneric = makeClaimType(7);
    export const ClaimTypeDiscord = makeClaimType(8);
    export const ClaimTypeInstagram = makeClaimType(9);
    export const ClaimTypeGitHub = makeClaimType(10);
    export const ClaimTypeMinds = makeClaimType(11);
    export const ClaimTypePatreon = makeClaimType(12);
    export const ClaimTypeSubstack = makeClaimType(13);
    export const ClaimTypeTwitch = makeClaimType(14);
    export const ClaimTypeWebsite = makeClaimType(15);
    export const ClaimTypeKick = makeClaimType(16);
    export const ClaimTypeSoundcloud = makeClaimType(17);
    export const ClaimTypeVimeo = makeClaimType(18);
    export const ClaimTypeNebula = makeClaimType(19);
    export const ClaimTypeURL = makeClaimType(20);
    export const ClaimTypeOccupation = makeClaimType(21);
    export const ClaimTypeSkill = makeClaimType(22);
    export const ClaimTypeSpotify = makeClaimType(23);
    export const ClaimTypeSpreadshop = makeClaimType(24);
    export const ClaimTypePolycentric = makeClaimType(25);
    export const ClaimTypeGitlab = makeClaimType(26);

    export function toString(claimType: ClaimType): string {
        if (claimType.equals(ClaimTypeHackerNews)) {
            return 'HackerNews';
        } else if (claimType.equals(ClaimTypeYouTube)) {
            return 'YouTube';
        } else if (claimType.equals(ClaimTypeOdysee)) {
            return 'Odysee';
        } else if (claimType.equals(ClaimTypeRumble)) {
            return 'Rumble';
        } else if (claimType.equals(ClaimTypeTwitter)) {
            return 'Twitter';
        } else if (claimType.equals(ClaimTypeBitcoin)) {
            return 'Bitcoin';
        } else if (claimType.equals(ClaimTypeGeneric)) {
            return 'Generic';
        } else if (claimType.equals(ClaimTypeDiscord)) {
            return 'Discord';
        } else if (claimType.equals(ClaimTypeInstagram)) {
            return 'Instagram';
        } else if (claimType.equals(ClaimTypeGitHub)) {
            return 'GitHub';
        } else if (claimType.equals(ClaimTypeMinds)) {
            return 'Minds';
        } else if (claimType.equals(ClaimTypePatreon)) {
            return 'Patreon';
        } else if (claimType.equals(ClaimTypeSubstack)) {
            return 'Substack';
        } else if (claimType.equals(ClaimTypeTwitch)) {
            return 'Twitch';
        } else if (claimType.equals(ClaimTypeWebsite)) {
            return 'Website';
        } else if (claimType.equals(ClaimTypeKick)) {
            return 'Kick';
        } else if (claimType.equals(ClaimTypeSoundcloud)) {
            return 'Soundcloud';
        } else if (claimType.equals(ClaimTypeVimeo)) {
            return 'Vimeo';
        } else if (claimType.equals(ClaimTypeNebula)) {
            return 'Nebula';
        } else if (claimType.equals(ClaimTypeURL)) {
            return 'URL';
        } else if (claimType.equals(ClaimTypeOccupation)) {
            return 'Occupation';
        } else if (claimType.equals(ClaimTypeSkill)) {
            return 'Skill';
        } else if (claimType.equals(ClaimTypeSpotify)) {
            return 'Spotify';
        } else if (claimType.equals(ClaimTypeSpreadshop)) {
            return 'Spreadshop';
        } else if (claimType.equals(ClaimTypePolycentric)) {
            return 'Polycentric';
        } else if (claimType.equals(ClaimTypeGitlab)) {
            return 'Gitlab';
        } else {
            return 'unknown';
        }
    }
}

function claimIdentifier(
    claimType: ClaimType.ClaimType,
    identifier: string,
): Protocol.Claim {
    return {
        claimType: claimType,
        claimFields: [
            {
                key: Long.fromNumber(0),
                value: identifier,
            },
        ],
    };
}

export function claimOccupation(
    organization: string | undefined,
    role: string | undefined,
    location: string | undefined,
): Protocol.Claim {
    const fields = [];

    if (organization !== undefined) {
        fields.push({
            key: Long.fromNumber(0),
            value: organization,
        });
    }

    if (role !== undefined) {
        fields.push({
            key: Long.fromNumber(1),
            value: role,
        });
    }

    if (location !== undefined) {
        fields.push({
            key: Long.fromNumber(2),
            value: location,
        });
    }

    return {
        claimType: ClaimType.ClaimTypeOccupation,
        claimFields: fields,
    };
}

export function claimSkill(skill: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeSkill, skill);
}

export function claimHackerNews(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeHackerNews, username);
}

export function claimYouTube(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeYouTube, username);
}

export function claimOdysee(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeOdysee, username);
}

export function claimRumble(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeRumble, username);
}

export function claimTwitter(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeTwitter, username);
}

export function claimBitcoin(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeBitcoin, username);
}

export function claimGeneric(text: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeGeneric, text);
}

export function claimDiscord(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeDiscord, username);
}

export function claimInstagram(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeInstagram, username);
}

export function claimGitHub(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeGitHub, username);
}

export function claimMinds(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeMinds, username);
}

export function claimPatreon(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypePatreon, username);
}

export function claimSubstack(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeSubstack, username);
}

export function claimTwitch(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeTwitch, username);
}

export function claimWebsite(username: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeWebsite, username);
}

export function claimURL(url: string): Protocol.Claim {
    return claimIdentifier(ClaimType.ClaimTypeURL, url);
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

export function hash(bytes: Uint8Array): Digest.Digest {
    const context = new FastSHA256.Hash();
    context.update(bytes);
    return Digest.fromProto({
        digestType: Long.UONE,
        digest: context.digest(),
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

export function bufferToReference(buffer: Uint8Array): Protocol.Reference {
    return {
        referenceType: new Long(3, 0, true),
        reference: buffer,
    };
}

export function signedEventToPointer(
    signedEvent: SignedEvent.SignedEvent,
): Pointer.Pointer {
    const event = Event.fromBuffer(signedEvent.event);
    return Pointer.fromProto({
        system: event.system,
        process: event.process,
        logicalClock: event.logicalClock,
        eventDigest: hash(signedEvent.event),
    });
}

export namespace URLInfoSystemLink {
    interface URLInfoSystemLinkI {
        system: PublicKey.PublicKey;
        servers: Array<string>;
    }

    export type URLInfoSystemLink = Readonly<URLInfoSystemLinkI> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(
        proto: Protocol.URLInfoSystemLink,
    ): URLInfoSystemLink {
        if (proto.system === undefined) {
            throw new Error('expected system');
        }

        PublicKey.fromProto(proto.system);

        return proto as URLInfoSystemLink;
    }

    export function fromBuffer(buffer: Uint8Array): URLInfoSystemLink {
        return fromProto(Protocol.URLInfoSystemLink.decode(buffer));
    }
}

export namespace URLInfoEventLink {
    interface URLInfoEventLinkI {
        system: PublicKey.PublicKey;
        process: Process.Process;
        logicalClock: Long;
        servers: Array<string>;
    }

    export type URLInfoEventLink = Readonly<URLInfoEventLinkI> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(
        proto: Protocol.URLInfoEventLink,
    ): URLInfoEventLink {
        if (proto.system === undefined) {
            throw new Error('expected system');
        }

        if (proto.process === undefined) {
            throw new Error('expected process');
        }

        PublicKey.fromProto(proto.system);
        Process.fromProto(proto.process);

        return proto as URLInfoEventLink;
    }

    export function fromBuffer(buffer: Uint8Array): URLInfoEventLink {
        return fromProto(Protocol.URLInfoEventLink.decode(buffer));
    }
}

export namespace URLInfo {
    export type URLInfoType = Readonly<Long> & {
        readonly __tag: unique symbol;
    };

    function makeURLInfoType(x: number): URLInfoType {
        return new Long(x, 0, true) as URLInfoType;
    }

    export const URLInfoTypeSystemLink = makeURLInfoType(1);
    export const URLInfoTypeEventLink = makeURLInfoType(2);
    export const URLInfoTypeExportBundle = makeURLInfoType(3);

    export function getSystemLink(
        proto: Protocol.URLInfo,
    ): URLInfoSystemLink.URLInfoSystemLink {
        if (!proto.urlType.equals(URLInfoTypeSystemLink)) {
            throw new Error('expected URLInfoTypeSystemLink');
        }

        return URLInfoSystemLink.fromBuffer(proto.body);
    }

    export function getEventLink(
        proto: Protocol.URLInfo,
    ): URLInfoEventLink.URLInfoEventLink {
        if (!proto.urlType.equals(URLInfoTypeEventLink)) {
            throw new Error('expected URLInfoTypeEventLink');
        }

        return URLInfoEventLink.fromBuffer(proto.body);
    }

    export function getExportBundle(
        proto: Protocol.URLInfo,
    ): Protocol.ExportBundle {
        if (!proto.urlType.equals(URLInfoTypeExportBundle)) {
            throw new Error('expected URLInfoTypeExportBundle');
        }

        return Protocol.ExportBundle.decode(proto.body);
    }
}

export namespace Events {
    interface TypeI {
        events: Array<SignedEvent.SignedEvent>;
    }

    export type Type = Readonly<TypeI> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(proto: Protocol.Events): Type {
        proto.events.forEach(SignedEvent.fromProto);

        return proto as Type;
    }

    export function fromBuffer(buffer: Uint8Array): Type {
        return fromProto(Protocol.Events.decode(buffer));
    }
}

export namespace ResultEventsAndRelatedEventsAndCursor {
    interface TypeI {
        resultEvents: Events.Type;
        relatedEvents: Events.Type;
        cursor: Uint8Array | undefined;
    }

    export type Type = Readonly<TypeI> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(
        proto: Protocol.ResultEventsAndRelatedEventsAndCursor,
    ): Type {
        if (proto.resultEvents === undefined) {
            proto.resultEvents = { events: [] };
        }

        if (proto.relatedEvents === undefined) {
            proto.relatedEvents = { events: [] };
        }

        Events.fromProto(proto.resultEvents);
        Events.fromProto(proto.relatedEvents);

        return proto as Type;
    }

    export function fromBuffer(buffer: Uint8Array): Type {
        return fromProto(
            Protocol.ResultEventsAndRelatedEventsAndCursor.decode(buffer),
        );
    }

    export function equal(x: Type, y: Type): boolean {
        if (x.resultEvents.events.length !== y.resultEvents.events.length) {
            return false;
        }

        if (x.relatedEvents.events.length !== y.relatedEvents.events.length) {
            return false;
        }

        for (let i = 0; i < x.resultEvents.events.length; i++) {
            if (
                !SignedEvent.equal(
                    x.resultEvents.events[i],
                    y.resultEvents.events[i],
                )
            ) {
                return false;
            }
        }

        for (let i = 0; i < x.relatedEvents.events.length; i++) {
            if (
                !SignedEvent.equal(
                    x.relatedEvents.events[i],
                    y.relatedEvents.events[i],
                )
            ) {
                return false;
            }
        }

        if (x.cursor !== undefined && y.cursor !== undefined) {
            return Util.buffersEqual(x.cursor, y.cursor);
        } else if (x.cursor === undefined && y.cursor === undefined) {
            return true;
        } else {
            return false;
        }
    }
}

export namespace FindClaimAndVouchResponse {
    interface TypeI {
        vouch: SignedEvent.SignedEvent;
        claim: SignedEvent.SignedEvent;
    }

    export type Type = Readonly<TypeI> & {
        readonly __tag: unique symbol;
    };

    export function fromProto(proto: Protocol.FindClaimAndVouchResponse): Type {
        if (proto.vouch === undefined) {
            throw new Error('expected vouch field');
        }

        if (proto.claim === undefined) {
            throw new Error('expected claim field');
        }

        SignedEvent.fromProto(proto.vouch);
        SignedEvent.fromProto(proto.claim);

        return proto as Type;
    }

    export function fromBuffer(buffer: Uint8Array): Type {
        return fromProto(Protocol.FindClaimAndVouchResponse.decode(buffer));
    }
}
