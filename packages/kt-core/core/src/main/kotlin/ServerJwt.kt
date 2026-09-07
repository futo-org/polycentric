package org.futo.polycentric.core

import okio.ByteString.Companion.toByteString
import org.futo.polycentric.core.KeyTypes
import org.futo.polycentric.core.PolycentricException
import org.futo.polycentric.core.ICryptoManager
import org.futo.polycentric.core.StoredKeyPair

/**
 * Port of js-core `crypto/server-jwt.ts` — the bearer token attached to
 * every outgoing gRPC request. EdDSA-signed JWT authenticating `iss` (an
 * identity key) against `aud` (a server URL); the signing key travels in
 * the header's `kid` as hex.
 */
object ServerJwt {

    /** How long a server JWT stays valid unless overridden. */
    const val DEFAULT_EXPIRY_SECONDS = 60L * 60L

    /**
     * Create a JWT for [iss] against [aud], signed with [keyPair] via
     * [crypto] (private keys stay behind the ICryptoManager boundary).
     */
    suspend fun create(
        crypto: ICryptoManager,
        keyPair: StoredKeyPair,
        iss: String,
        aud: String,
        expirySeconds: Long = DEFAULT_EXPIRY_SECONDS,
        nowSeconds: Long = System.currentTimeMillis() / 1000,
    ): String {
        if (keyPair.keyType != KeyTypes.ED25519) {
            throw PolycentricException("Unsupported key type: ${keyPair.keyType}")
        }

        val header = jsonObject(
            "alg" to "EdDSA",
            "typ" to "JWT",
            "kid" to keyPair.publicKey.toByteString().hex(),
        )
        val claims = jsonObject(
            "iss" to iss,
            "aud" to aud,
            "iat" to nowSeconds,
            "exp" to nowSeconds + expirySeconds,
        )

        val signingInput =
            "${base64UrlEncode(header.encodeToByteArray())}.${base64UrlEncode(claims.encodeToByteArray())}"
        val signature = crypto.sign(
            keyPair.privateKey,
            signingInput.toByteArray(Charsets.US_ASCII),
            keyPair.keyType,
        )
        return "$signingInput.${base64UrlEncode(signature)}"
    }

    // Hand-rolled JSON for two flat objects with known keys — org.json is
    // stub-only in JVM unit tests and kotlinx.serialization would be a new
    // dependency for 20 lines of output.
    private fun jsonObject(vararg fields: Pair<String, Any>): String =
        fields.joinToString(",", prefix = "{", postfix = "}") { (key, value) ->
            when (value) {
                is String -> "${jsonString(key)}:${jsonString(value)}"
                else -> "${jsonString(key)}:$value"
            }
        }

    private fun jsonString(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c < ' ' -> sb.append("\\u%04x".format(c.code))
            else -> sb.append(c)
        }
        return sb.append('"').toString()
    }

    private const val ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    /** Unpadded base64url (RFC 7515); java.util.Base64 needs API 26, minSdk is 24. */
    internal fun base64UrlEncode(bytes: ByteArray): String {
        val sb = StringBuilder((bytes.size + 2) / 3 * 4)
        var i = 0
        while (i + 3 <= bytes.size) {
            val n = (bytes[i].toInt() and 0xFF shl 16) or
                (bytes[i + 1].toInt() and 0xFF shl 8) or
                (bytes[i + 2].toInt() and 0xFF)
            sb.append(ALPHABET[n ushr 18])
                .append(ALPHABET[n ushr 12 and 63])
                .append(ALPHABET[n ushr 6 and 63])
                .append(ALPHABET[n and 63])
            i += 3
        }
        when (bytes.size - i) {
            1 -> {
                val n = bytes[i].toInt() and 0xFF shl 16
                sb.append(ALPHABET[n ushr 18]).append(ALPHABET[n ushr 12 and 63])
            }
            2 -> {
                val n = (bytes[i].toInt() and 0xFF shl 16) or (bytes[i + 1].toInt() and 0xFF shl 8)
                sb.append(ALPHABET[n ushr 18])
                    .append(ALPHABET[n ushr 12 and 63])
                    .append(ALPHABET[n ushr 6 and 63])
            }
        }
        return sb.toString()
    }
}
