import * as Protocol from '../protocol';
import * as Models from '.';

interface MatchTypeI {
    claim: Models.SignedEvent.SignedEvent;
    proofChain: Array<Models.SignedEvent.SignedEvent>;
}

export type MatchType = Readonly<MatchTypeI> & {
    readonly __tag: unique symbol;
};

export function matchTypeFromProto(
    proto: Protocol.QueryClaimToSystemResponseMatch,
): MatchType {
    if (proto.claim === undefined) {
        throw Error('expected proto.claim');
    }

    Models.SignedEvent.fromProto(proto.claim);
    proto.proofChain.forEach(Models.SignedEvent.fromProto);

    return proto as MatchType;
}

interface ResponseTypeI {
    matches: Array<MatchType>;
}

export type ResponseType = Readonly<ResponseTypeI> & {
    readonly __tag: unique symbol;
};

export function responseTypeFromProto(
    proto: Protocol.QueryClaimToSystemResponse,
): ResponseType {
    proto.matches.forEach(matchTypeFromProto);

    return proto as ResponseType;
}

export function responseTypeFromBuffer(buffer: Uint8Array): ResponseType {
    return responseTypeFromProto(
        Protocol.QueryClaimToSystemResponse.decode(buffer),
    );
}
