import { Base64 } from 'js-base64';

/**
 * Wrappers over the js-base64 package to handle all base64 encoding/decoding
 * that we do in javascript.
 * The main reason that we have a wrapper instead of using the library directly
 * is to add validation for decoding since js-base64 sometimes throws and
 * sometimes ignores when invalid input is encountered.
 */

/**
 * Encode the input bytes into a base64 string.
 * Standard padded base64 will be used when urlSafe is false,
 * and unpadded base64url will be used when it is true.
 */
export function base64Encode(bytes: Uint8Array, urlSafe = false): string {
  return Base64.fromUint8Array(bytes, urlSafe);
}

/**
 * Decode a base64 string to bytes.
 * Returns undefined if the input is invalid.
 */
export function base64Decode(base64: string): Uint8Array | undefined {
  if (!Base64.isValid(base64)) return undefined;

  try {
    return Base64.toUint8Array(base64);
  } catch {
    return undefined;
  }
}

/** Encode the input as UTF-8 into a base64 string. */
export function base64EncodeString(text: string, urlSafe = false): string {
  return Base64.encode(text, urlSafe);
}

/**
 * Decode a base64 string to a string.
 * Returns undefined if the input is invalid.
 */
export function base64DecodeString(base64: string): string | undefined {
  if (!Base64.isValid(base64)) return undefined;

  try {
    return Base64.decode(base64);
  } catch {
    return undefined;
  }
}
