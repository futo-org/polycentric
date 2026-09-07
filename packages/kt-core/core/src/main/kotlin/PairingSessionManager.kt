package org.futo.polycentric.core

import java.security.MessageDigest
import java.security.SecureRandom
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.futo.polycentric.ffi.PublicKey as FfiPublicKey
import polycentric.v2.IssuerPairingState
import polycentric.v2.KeyType
import polycentric.v2.PairingInfo
import polycentric.v2.PairingSessionDigest
import polycentric.v2.PairingSessionState
import polycentric.v2.PublicKey
import polycentric.v2.SignedIssuerState

const val PAIRING_SESSION_TTL_MILLIS = 5 * 60 * 1000L
private const val NONCE_BYTES = 32

/**
 * Device-pairing handshake manager. The pairing session creator publishes a new pairing session to
 * a server, and shares pairing info using a QR code or typable pairing code. After another device
 * joins, the user verifies each device displays the same emoji fingerprint for the pairing session
 * to confirm that no attacker has intercepted the pairing session.
 */
class PairingSessionManager(private val client: PolycentricClient) {

    class PairingSession(
        /** Canonical serialized `PairingSessionDigest` for this session. */
        val digestBytes: ByteArray,
        val digest: PairingSessionDigest,
        /** Pairing session state verified to be from the issuer. */
        val issuerState: IssuerPairingState,
        /** Public keys requesting to be paired. */
        val claimers: List<PublicKey>,
        /** Expiration time in posix epoch millis. */
        val expiresAt: Long,
        /** Information needed to access this session from the server. */
        val pairingInfo: PairingInfo,
    )

    /** Start a new pairing session and register it on [server]. */
    suspend fun createPairingSession(server: String): PairingSession {
        val keyPair = client.currentKeyPair ?: throw NoActiveKeyPairException()
        val identityKey = client.activeIdentityKey ?: throw NoActiveIdentityException()
        val digestBytes = PairingSessionDigest.ADAPTER.encode(
            PairingSessionDigest(
                issuer_identity = identityKey,
                issuer_signer = keyPair.toPublicKeyProto(),
                nonce = randomNonce(),
                initial_timestamp = System.currentTimeMillis(),
                ttl_millis = PAIRING_SESSION_TTL_MILLIS,
            ),
        )
        return putState(server, digestBytes, sequence = 1L)
    }

    /** Publish a new state for an existing session. */
    suspend fun updatePairingSession(
        server: String,
        digestBytes: ByteArray,
        sequence: Long,
    ): PairingSession = putState(server, digestBytes, sequence)

    /** Fetch a pairing session using [info]. */
    suspend fun getPairingSession(info: PairingInfo): PairingSession =
        decodeSession(
            info.server,
            client.core.getPairingSession(info.server, info.digest_sha256.toByteArray()),
        )

    /** Register our key as a claimer on a session. Verify the session first. */
    suspend fun joinPairingSession(info: PairingInfo) {
        val keyPair = client.currentKeyPair ?: throw NoActiveKeyPairException()
        client.core.joinPairingSession(
            info.server,
            info.digest_sha256.toByteArray(),
            keyPair.toPublicKeyProto().toFfi(),
        )
    }

    /** Poll the server's list of claimer public keys. */
    suspend fun pollForClaimers(info: PairingInfo): List<PublicKey> =
        client.core
            .pollForClaimers(info.server, info.digest_sha256.toByteArray())
            .map { it.toProto() }

    /**
     * Check whether the issuer's published identity state authorizes our key.
		 * Verify the full identity chain before committing.
     */
    suspend fun pollForAuthorization(info: PairingInfo): Boolean {
        val keyPair = client.currentKeyPair ?: throw NoActiveKeyPairException()
        return client.core.pollForAuthorization(
            info.server,
            info.digest_sha256.toByteArray(),
            keyPair.toPublicKeyProto().toFfi(),
        )
    }

    private suspend fun signIssuerState(issuerState: IssuerPairingState): SignedIssuerState {
        val keyPair = client.currentKeyPair ?: throw NoActiveKeyPairException()
        val stateBytes = IssuerPairingState.ADAPTER.encode(issuerState)
        val signature = client.crypto.sign(keyPair.privateKey, stateBytes, keyPair.keyType)
        return SignedIssuerState(
            state_bytes = stateBytes.toByteString(),
            signature = signature.toByteString(),
        )
    }

    /** Sign and publish new session state derived from the local identity chain. */
    private suspend fun putState(server: String, digestBytes: ByteArray, sequence: Long): PairingSession {
        val digest = digestFrom(digestBytes, assertIssuer = true)
        val identityState = client.listValidEvents(digest.issuer_identity, Collections.IDENTITY)
            .lastOrNull()
            ?: throw PolycentricException("No local identity chain for ${digest.issuer_identity}")

        val signedState = signIssuerState(
            IssuerPairingState(
                session_digest = digestBytes.toByteString(),
                identity_state = identityState,
                sequence = sequence,
            ),
        )

        val responseBytes = client.core.putPairingSession(
            server,
            SignedIssuerState.ADAPTER.encode(signedState),
        )
        return decodeSession(server, responseBytes)
    }

    /**
     * Decode a `PairingSessionDigest`. With [assertIssuer], verify the
     * session belongs to the active identity and key pair.
     */
    private fun digestFrom(digestBytes: ByteArray, assertIssuer: Boolean = false): PairingSessionDigest {
        val decoded = PairingSessionDigest.ADAPTER.decode(digestBytes)
        val signer = decoded.issuer_signer
            ?: throw PolycentricException("Pairing session digest has no issuer signer")
        val digest = decoded.copy(issuer_signer = signer)

        if (assertIssuer) {
            if (digest.issuer_identity != client.activeIdentityKey) {
                throw PolycentricException(
                    "Pairing session specifies a different identity than the active identity key",
                )
            }
            val keyPair = client.currentKeyPair ?: throw NoActiveKeyPairException()
            if (!IdentityManager.keysEqual(signer, keyPair.toPublicKeyProto())) {
                throw PolycentricException(
                    "Pairing session pins a different signer than the active key pair",
                )
            }
        }

        return digest
    }

    /** Decode a `PairingSessionState` received from a server. */
    private fun decodeSession(server: String, stateBytes: ByteArray): PairingSession {
        val state = PairingSessionState.ADAPTER.decode(stateBytes)
        val signedIssuerState = state.issuer_state
            ?: throw PolycentricException("Pairing session state has no signed issuer state")
        val issuerState = IssuerPairingState.ADAPTER.decode(signedIssuerState.state_bytes.toByteArray())
        val digestBytes = issuerState.session_digest.toByteArray()
        val digest = digestFrom(digestBytes)
        val expiresAt = digest.initial_timestamp + digest.ttl_millis
        if (expiresAt < digest.initial_timestamp) {
            throw PolycentricException("Pairing session expiration overflows")
        }

        return PairingSession(
            digestBytes = digestBytes,
            digest = digest,
            issuerState = issuerState,
            claimers = state.claimers,
            expiresAt = expiresAt,
            pairingInfo = PairingInfo(
                server = server,
                digest_sha256 = sha256(digestBytes).toByteString(),
            ),
        )
    }

    private fun randomNonce(): ByteString {
        val nonce = ByteArray(NONCE_BYTES)
        SecureRandom().nextBytes(nonce)
        return nonce.toByteString()
    }

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun FfiPublicKey.toProto(): PublicKey = PublicKey(
        key_type = KeyType.fromValue(keyType) ?: KeyType.KEY_TYPE_UNSPECIFIED,
        key = key.toByteString(),
    )
}
