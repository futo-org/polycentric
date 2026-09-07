package org.futo.polycentric.core

import okio.ByteString.Companion.toByteString
import org.futo.polycentric.core.StoredKeyPair
import polycentric.v2.EventKey
import polycentric.v2.KeyType
import polycentric.v2.PublicKey

/**
 * Conversions between the three key representations: raw bytes
 * (StoredKeyPair), Wire protos (PublicKey/EventKey — note `key_type` is
 * the KeyType enum), and the UniFFI record types (plain Int/ByteArray).
 */

internal fun StoredKeyPair.toPublicKeyProto(): PublicKey = PublicKey(
    key_type = KeyType.fromValue(keyType) ?: KeyType.KEY_TYPE_UNSPECIFIED,
    key = publicKey.toByteString(),
)

internal fun PublicKey.toFfi(): org.futo.polycentric.ffi.PublicKey =
    org.futo.polycentric.ffi.PublicKey(
        keyType = key_type.value,
        key = key.toByteArray(),
    )

/** Proto EventKey → FFI record; null when `signed_by` is absent. */
internal fun EventKey.toFfiOrNull(): org.futo.polycentric.ffi.EventKey? {
    val signedBy = signed_by ?: return null
    return org.futo.polycentric.ffi.EventKey(
        collection = collection,
        identity = identity,
        signedBy = signedBy.toFfi(),
        sequence = sequence.toULong(),
    )
}

internal fun EventKey.toFfiOrThrow(): org.futo.polycentric.ffi.EventKey =
    toFfiOrNull() ?: throw PolycentricException("EventKey missing signed_by")
