import Long from 'long';

import * as Protocol from '../protocol';
import * as Ranges from '../ranges';
import * as Models from '.';

interface RangeI {
    low: Long;
    high: Long;
}

export type Range = Readonly<RangeI> & {
    readonly __tag: unique symbol;
};

export function rangeFromProto(proto: Protocol.Range): Range {
    if (proto.low.greaterThan(proto.high)) {
        throw Error('range.low is greater than range.high');
    }

    return proto as Range;
}

interface RangesForProcessI {
    process: Models.Process.Process;
    ranges: Array<Range>;
}

export type RangesForProcess = Readonly<RangesForProcessI> & {
    readonly __tag: unique symbol;
};

export function rangesForProcessFromProto(
    proto: Protocol.RangesForProcess,
): RangesForProcess {
    if (!proto.process) {
        throw Error('expected process');
    }

    Models.Process.fromProto(proto.process);

    proto.ranges.forEach(rangeFromProto);

    if (!Ranges.validateInvariants(proto.ranges)) {
        console.log("RangesForProcess invariants violated");
        proto.ranges = Ranges.fixRanges(proto.ranges);
        // throw Error('invalid ranges');
    }

    return proto as RangesForProcess;
}

interface RangesForSystemI {
    rangesForProcesses: Array<RangesForProcess>;
}

export type RangesForSystem = Readonly<RangesForSystemI> & {
    readonly __tag: unique symbol;
};

export function rangesForSystemFromProto(
    proto: Protocol.RangesForSystem,
): RangesForSystem {
    proto.rangesForProcesses.forEach(rangesForProcessFromProto);

    return proto as RangesForSystem;
}

export function rangesForSystemFromBuffer(buffer: Uint8Array): RangesForSystem {
    return rangesForSystemFromProto(Protocol.RangesForSystem.decode(buffer));
}
