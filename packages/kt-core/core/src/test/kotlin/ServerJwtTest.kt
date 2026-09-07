package org.futo.polycentric.core

import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.futo.polycentric.core.KeyTypes
import org.futo.polycentric.core.PolycentricException
import org.futo.polycentric.core.StoredKeyPair
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Port of js-core `crypto/server-jwt.test.ts`.
 *
 * The extra base64url test at the bottom has no js counterpart: js-core
 * encodes with a library, while ServerJwt hand-rolls the encoder (no
 * java.util.Base64 before API 26), so it is pinned against the JDK here.
 */
class ServerJwtTest {

    private val crypto = Ed25519CryptoManager()

    private val privateKey = ByteArray(32) { 7 }
    private val publicKey = crypto.derivePublicKey(privateKey, KeyTypes.ED25519)
    private val keyPair = StoredKeyPair(
        keyType = KeyTypes.ED25519,
        publicKey = publicKey,
        privateKey = privateKey,
    )

    private val identity = "identity-key-hex"
    private val server = "https://server.example.com"

    private class Parts(val header: String, val claims: String, val signature: String)

    private fun createParts(expirySeconds: Long? = null): Parts = runBlocking {
        val jwt = if (expirySeconds != null) {
            ServerJwt.create(crypto, keyPair, iss = identity, aud = server, expirySeconds = expirySeconds)
        } else {
            ServerJwt.create(crypto, keyPair, iss = identity, aud = server)
        }
        val (header, claims, signature) = jwt.split(".")
        Parts(header, claims, signature)
    }

    /** java.util.Base64's URL decoder accepts the unpadded form RFC 7515 requires. */
    private fun decodeSegment(segment: String): JSONObject =
        JSONObject(String(Base64.getUrlDecoder().decode(segment), Charsets.UTF_8))

    @Test
    fun `carries the issuer, audience, and signing key`() {
        val parts = createParts()

        val header = decodeSegment(parts.header)
        assertEquals("EdDSA", header.getString("alg"))
        assertEquals("JWT", header.getString("typ"))
        assertEquals(publicKey.joinToString("") { "%02x".format(it) }, header.getString("kid"))

        val claims = decodeSegment(parts.claims)
        assertEquals(identity, claims.getString("iss"))
        assertEquals(server, claims.getString("aud"))
    }

    @Test
    fun `expires in one hour by default`() {
        val parts = createParts()
        val claims = decodeSegment(parts.claims)
        val iat = claims.getLong("iat")
        val exp = claims.getLong("exp")

        assertTrue(
            "iat should be about now",
            Math.abs(iat - System.currentTimeMillis() / 1000) <= 10,
        )
        assertEquals(60L * 60L, exp - iat)
    }

    @Test
    fun `honours a custom expiry`() {
        val parts = createParts(expirySeconds = 30)
        val claims = decodeSegment(parts.claims)

        assertEquals(30L, claims.getLong("exp") - claims.getLong("iat"))
    }

    @Test
    fun `signs header claims with the keypair EdDSA`() {
        val parts = createParts()

        val verified = crypto.verify(
            publicKey,
            "${parts.header}.${parts.claims}".toByteArray(Charsets.US_ASCII),
            Base64.getUrlDecoder().decode(parts.signature),
            KeyTypes.ED25519,
        )
        assertTrue(verified)
    }

    @Test
    fun `rejects a non-ed25519 keypair`() {
        val badPair = StoredKeyPair(keyType = 0, publicKey = publicKey, privateKey = privateKey)

        val e = assertThrows(PolycentricException::class.java) {
            runBlocking { ServerJwt.create(crypto, badPair, iss = identity, aud = server) }
        }
        assertTrue(e.message!!.contains("Unsupported key type"))
    }

    @Test
    fun `base64url matches the JDK encoder on padding boundaries`() {
        val jdk = Base64.getUrlEncoder().withoutPadding()
        for (length in 0..8) {
            val bytes = ByteArray(length) { (it * 37 + 251).toByte() }
            assertEquals(jdk.encodeToString(bytes), ServerJwt.base64UrlEncode(bytes))
        }
    }
}
