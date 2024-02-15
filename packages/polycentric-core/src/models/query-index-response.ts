import * as Protocol from '../protocol';
import * as Models from '.';

interface TypeI {
    events: Models.SignedEvent.SignedEvent[];
    proof: Models.SignedEvent.SignedEvent[];
}

export type Type = Readonly<TypeI> & {
    readonly __tag: unique symbol;
};

export function fromProto(proto: Protocol.QueryIndexResponse): Type {
    proto.events.forEach(Models.SignedEvent.fromProto);
    proto.proof.forEach(Models.SignedEvent.fromProto);

    return proto as Type;
}

export function fromBuffer(buffer: Uint8Array): Type {
    return fromProto(Protocol.QueryIndexResponse.decode(buffer));
}
