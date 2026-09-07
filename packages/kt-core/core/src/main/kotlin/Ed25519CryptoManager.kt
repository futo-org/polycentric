package org.futo.polycentric.core

import java.security.SecureRandom
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.futo.polycentric.core.InvalidKeyLengthException
import org.futo.polycentric.core.InvalidSignatureException
import org.futo.polycentric.core.KeyTypes
import org.futo.polycentric.core.ICryptoManager
import org.futo.polycentric.core.StoredKeyPair

private const val ED25519_PRIVATE_KEY_LENGTH = 32
private const val ED25519_PUBLIC_KEY_LENGTH = 32
private const val ED25519_SIGNATURE_LENGTH = 64

/**
 * Ed25519 via BouncyCastle, mirroring js-core's @noble/curves CryptoManager.
 *
 * Keys are raw 32-byte scalars, wire-compatible with both v1 system keys
 * and v2 `PublicKey.key`. Android Keystore cannot hold ed25519 signing
 * keys, so private keys are app-managed (same trade-off polycentricandroid
 * makes today); encrypt-at-rest is the IKeysRepository implementation's job.
 */
class Ed25519CryptoManager : ICryptoManager {
    override fun generateKeyPair(keyType: Int): StoredKeyPair {
        require(keyType == KeyTypes.ED25519) { "Unsupported key type: $keyType" }
        val generator = Ed25519KeyPairGenerator()
        generator.init(Ed25519KeyGenerationParameters(SecureRandom()))
        val pair = generator.generateKeyPair()
        val private = pair.private as Ed25519PrivateKeyParameters
        val public = pair.public as Ed25519PublicKeyParameters
        return StoredKeyPair(
            keyType = keyType,
            publicKey = public.encoded,
            privateKey = private.encoded,
        )
    }

    override fun derivePublicKey(privateKey: ByteArray, keyType: Int): ByteArray {
        require(keyType == KeyTypes.ED25519) { "Unsupported key type: $keyType" }
        if (privateKey.size != ED25519_PRIVATE_KEY_LENGTH) {
            throw InvalidKeyLengthException(
                "Invalid private key length. Expected $ED25519_PRIVATE_KEY_LENGTH bytes, got ${privateKey.size}.",
            )
        }
        return Ed25519PrivateKeyParameters(privateKey, 0).generatePublicKey().encoded
    }

    override suspend fun sign(privateKey: ByteArray, message: ByteArray, keyType: Int): ByteArray {
        require(keyType == KeyTypes.ED25519) { "Unsupported key type: $keyType" }
        if (privateKey.size != ED25519_PRIVATE_KEY_LENGTH) {
            throw InvalidKeyLengthException(
                "Invalid private key length for signing. Expected $ED25519_PRIVATE_KEY_LENGTH bytes, got ${privateKey.size}.",
            )
        }
        val signer = Ed25519Signer()
        signer.init(true, Ed25519PrivateKeyParameters(privateKey, 0))
        signer.update(message, 0, message.size)
        return signer.generateSignature()
    }

    override fun verify(
        publicKey: ByteArray,
        message: ByteArray,
        signature: ByteArray,
        keyType: Int,
    ): Boolean {
        require(keyType == KeyTypes.ED25519) { "Unsupported key type: $keyType" }
        if (signature.size != ED25519_SIGNATURE_LENGTH) {
            throw InvalidSignatureException(
                "Invalid signature length. Expected $ED25519_SIGNATURE_LENGTH bytes, got ${signature.size}.",
            )
        }
        if (publicKey.size != ED25519_PUBLIC_KEY_LENGTH) {
            throw InvalidKeyLengthException(
                "Invalid public key length for verification. Expected $ED25519_PUBLIC_KEY_LENGTH bytes, got ${publicKey.size}.",
            )
        }
        val verifier = Ed25519Signer()
        verifier.init(false, Ed25519PublicKeyParameters(publicKey, 0))
        verifier.update(message, 0, message.size)
        return verifier.verifySignature(signature)
    }

    override fun getSupportedKeyTypes(): List<Int> = listOf(KeyTypes.ED25519)
}
