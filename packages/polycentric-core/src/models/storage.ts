import Long from 'long';

import * as Protocol from '../protocol';
import * as Models from '.';

interface StorageTypeSystemStateI {
    processes: Array<Models.Process.Process>;
    crdtItems: Array<Protocol.StorageTypeCRDTItem>;
}

export type StorageTypeSystemState = Readonly<StorageTypeSystemStateI> & {
    readonly __tag: unique symbol;
};

export function storageTypeSystemStateFromProto(
    proto: Protocol.StorageTypeSystemState,
): StorageTypeSystemState {
    proto.processes.forEach(Models.Process.fromProto);

    return proto as StorageTypeSystemState;
}

export function storageTypeSystemStateFromBuffer(
    buffer: Uint8Array,
): StorageTypeSystemState {
    return storageTypeSystemStateFromProto(
        Protocol.StorageTypeSystemState.decode(buffer),
    );
}

interface StorageTypeProcessStateI {
    logicalClock: Long;
    ranges: Array<Protocol.Range>;
    indices: Protocol.Indices;
}

export type StorageTypeProcessState = StorageTypeProcessStateI & {
    readonly __tag: unique symbol;
};

export function storageTypeProcessStateFromProto(
    proto: Protocol.StorageTypeProcessState,
): StorageTypeProcessState {
    if (proto.indices === undefined) {
        throw Error('StorageTypeProcessState expected indices');
    }

    return proto as StorageTypeProcessState;
}

export function storageTypeProcessStateFromBuffer(
    buffer: Uint8Array,
): StorageTypeProcessState {
    return storageTypeProcessStateFromProto(
        Protocol.StorageTypeProcessState.decode(buffer),
    );
}

interface StorageTypeEventI {
    event: Models.SignedEvent.SignedEvent | undefined;
    mutationPointer: Models.Pointer.Pointer | undefined;
}

export type StorageTypeEvent = Readonly<StorageTypeEventI> & {
    readonly __tag: unique symbol;
};

export function storageTypeEventFromProto(
    proto: Protocol.StorageTypeEvent,
): StorageTypeEvent {
    if (proto.event !== undefined) {
        Models.SignedEvent.fromProto(proto.event);
    }

    if (proto.mutationPointer !== undefined) {
        Models.Pointer.fromProto(proto.mutationPointer);
    }

    if (proto.event === undefined && proto.mutationPointer === undefined) {
        throw Error('StorageTypeEvent expected event or mutationPointer');
    }

    return proto as StorageTypeEvent;
}

export function storageTypeEventFromBuffer(
    buffer: Uint8Array,
): StorageTypeEvent {
    return storageTypeEventFromProto(Protocol.StorageTypeEvent.decode(buffer));
}
