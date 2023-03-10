declare var TextEncoder: any;

const textEncoder = new TextEncoder();

export function encodeText(text: string): Uint8Array {
    return textEncoder.encode(text);
}

declare var TextDecoder: any;

const textDecoder = new TextDecoder();

export function decodeText(buffer: Uint8Array): string {
    return textDecoder.decode(buffer);
}

export function buffersEqual(x: Uint8Array, y: Uint8Array): boolean {
    if (x.byteLength !== y.byteLength) {
        return false;
    }

    for (let i = 0; i < x.byteLength; i++) {
        if (x[i] !== y[i]) {
            return false;
        }
    }

    return true;
}

export function bufferSuffixMatch(
    buffer: Uint8Array,
    suffix: Uint8Array,
): boolean {
    if (buffer.length < suffix.length) {
        return false;
    }

    for (let i = 0; i < suffix.byteLength; i++) {
        if (buffer[i] !== suffix[i]) {
            return false;
        }
    }

    return true;
}
