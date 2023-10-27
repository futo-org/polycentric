import * as Core from '@polycentric/polycentric-core';
import Long from 'long';

export const SERVER = "https://srv1-stg.polycentric.io";
export const TRUST_ROOT = Core.Models.PublicKey.fromProto(Core.Protocol.PublicKey.create({
    keyType: 1,
    key: Uint8Array.from(atob("gX0eCWctTm6WHVGot4sMAh7NDAIwWsIM5tRsOz9dX04="), c => c.charCodeAt(0))
}));

function contentTypeToString(contentType: Core.Models.ContentType.ContentType): string {
    switch (contentType.toInt()) {
        case Core.Models.ContentType.ContentTypeDelete.toInt():
            return "Delete";
        case Core.Models.ContentType.ContentTypeSystemProcesses.toInt():
            return "System Processes";
        case Core.Models.ContentType.ContentTypePost.toInt():
            return "Post";
        case Core.Models.ContentType.ContentTypeFollow.toInt():
            return "Follow";
        case Core.Models.ContentType.ContentTypeUsername.toInt():
            return "Username";
        case Core.Models.ContentType.ContentTypeDescription.toInt():
            return "Description";
        case Core.Models.ContentType.ContentTypeBlobMeta.toInt():
            return "Blob Meta";
        case Core.Models.ContentType.ContentTypeBlobSection.toInt():
            return "Blob Section";
        case Core.Models.ContentType.ContentTypeAvatar.toInt():
            return "Avatar";
        case Core.Models.ContentType.ContentTypeServer.toInt():
            return "Server";
        case Core.Models.ContentType.ContentTypeVouch.toInt():
            return "Vouch";
        case Core.Models.ContentType.ContentTypeClaim.toInt():
            return "Claim";
        case Core.Models.ContentType.ContentTypeBanner.toInt():
            return "Banner";
        case Core.Models.ContentType.ContentTypeOpinion.toInt():
            return "Opinion";
        case Core.Models.ContentType.ContentTypeStore.toInt():
            return "Store";
        case Core.Models.ContentType.ContentTypeAuthority.toInt():
            return "Authority";
        default:
            return contentType.toString();
    }
}

export function printableEvent(event: Core.Models.Event.Event): any {
    let content: any;
    switch (event.contentType.toInt()) {
        case Core.Models.ContentType.ContentTypePost.toInt():
            content = String.fromCharCode.apply(null, Array.from(event.content));
            break;
        case Core.Models.ContentType.ContentTypeClaim.toInt():
            const claim = Core.Protocol.Claim.decode(event.content);
            content = {
                ...claim,
                claimType: Core.Models.ClaimType.toString(claim.claimType as any)
            };
            break;
        case Core.Models.ContentType.ContentTypeBlobSection.toInt():
            content = btoa(String.fromCharCode.apply(null, Array.from(event.content)))
            break;
        default:
            content = event.content;
            break;
    }

    let lwwElementValue: any = undefined;
    if (event.lwwElement) {
        switch (event.contentType.toInt()) {
            case Core.Models.ContentType.ContentTypeUsername.toInt():
            case Core.Models.ContentType.ContentTypeDescription.toInt():
                lwwElementValue = String.fromCharCode.apply(null, Array.from(event.lwwElement.value));
                break;
            case Core.Models.ContentType.ContentTypeAvatar.toInt():
            case Core.Models.ContentType.ContentTypeBanner.toInt():
                lwwElementValue = Core.Protocol.ImageBundle.decode(event.lwwElement.value);
                break;
            default:
                lwwElementValue = event.lwwElement.value;
                break;
        }
    }

    const references = [];
    for (const ref of event.references) {
        let refValue: any;
        switch (ref.referenceType.toInt()) {
            case 2:
                refValue = Core.Protocol.Pointer.decode(ref.reference);
                break;
            case 3:
                refValue = String.fromCharCode.apply(null, Array.from(ref.reference));                
                break;
            default:
                refValue = ref.reference;
                break;
        }

        references.push({
            ...ref,
            reference: refValue
        })
    }

    let lwwElementSetValue: any = undefined;
    if (event.lwwElementSet) {
        switch (event.contentType.toInt()) {
            case Core.Models.ContentType.ContentTypeServer.toInt():
                lwwElementSetValue = String.fromCharCode.apply(null, Array.from(event.lwwElementSet.value));
                break;
            default:
                lwwElementSetValue = event.lwwElementSet.value;
                break;
        }
    }

    return {
        ...event,
        contentType: contentTypeToString(event.contentType),
        content,
        lwwElement: event.lwwElement ? {
            ...event.lwwElement,
            value: lwwElementValue
        } : undefined,
        lwwElementSet: event.lwwElementSet ? {
            ...event.lwwElementSet,
            value: lwwElementSetValue
        } : undefined,
        references,
        reference: Core.Models.pointerToReference(Core.Models.Pointer.fromProto({
            system: event.system,
            process: event.process,
            logicalClock: event.logicalClock,
            eventDigest: Core.Models.hash(Core.Protocol.Event.encode(event).finish()),
        }))
    };
}

export function replacer(key: any, value: any) {
    if (value instanceof Uint8Array) {
        return btoa(String.fromCharCode.apply(null, Array.from(value)));
    }
    if (Long.isLong(value)) {
        return value.toString();
    }

    return value;
}