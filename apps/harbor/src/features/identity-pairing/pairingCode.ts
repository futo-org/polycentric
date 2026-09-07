import { Base64 } from 'js-base64';
import { bytesToHex, hexToBytes, v2 } from '@polycentric/react-native';

/**
 * -----------------------------------------------------------------------------
 * The `PairingInfo` protobuf message contains the information we need to join
 * a pairing session securely.
 * For the QR code, we don't care about readability but we want the payload size
 * to be small so that it is easy to scan.
 * For the manual entry, we want it to look like a random token string.
 * -----------------------------------------------------------------------------
 */

export enum EncodingMode {
  BASE64 = 'base64',
  HEX = 'hex',
}

/** Encode the pairing info for use in a QR code or copy/paste */
export function encodePairingCode(
  info: v2.PairingInfo,
  mode: EncodingMode,
): string {
  const bytes = v2.PairingInfo.toBinary(info);

  if (mode === EncodingMode.BASE64) {
    return Base64.fromUint8Array(bytes, true);
  } else if (mode === EncodingMode.HEX) {
    return bytesToHex(bytes);
  }

  throw new Error('Unsupported encoding mode');
}

/** Decode a pairing code received from another device */
export function decodePairingCode(
  encoded: string,
  mode: EncodingMode,
): v2.PairingInfo | undefined {
  try {
    let bytes: Uint8Array;

    if (mode === EncodingMode.BASE64) {
      bytes = Base64.toUint8Array(encoded);
    } else if (mode === EncodingMode.HEX) {
      const maybeBytes = hexToBytes(encoded);
      if (!maybeBytes) return undefined;
      bytes = maybeBytes;
    } else {
      return undefined;
    }

    const info = v2.PairingInfo.fromBinary(bytes);

    // Do some sanity checks
    if (info.digestSha256.length === 0) return undefined;
    if (info.server.length === 0) return undefined;

    return info;
  } catch {
    return undefined;
  }
}
