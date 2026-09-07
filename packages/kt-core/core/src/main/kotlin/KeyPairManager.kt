package org.futo.polycentric.core

import org.futo.polycentric.core.StoredKeyPair
import polycentric.v2.PublicKey

/**
 * Port of js-core `client-internal/keypair-manager.ts` — device keypair
 * lifecycle. A device may hold several keypairs (one per identity it
 * participates in); exactly one is "current".
 */
class KeyPairManager(private val client: PolycentricClient) {

    /**
     * Creates a new key pair, stores it, and (by default) sets it as
     * current.
     */
    suspend fun createKeyPair(
        keyType: Int = KeyTypes.ED25519,
        setAsCurrent: Boolean = true,
    ): StoredKeyPair {
        val keyPair = client.crypto.generateKeyPair(keyType)
        client.keys.save(keyPair.publicKey, keyPair.keyType, keyPair.privateKey)
        if (setAsCurrent) {
            client.setCurrentKeyPair(keyPair)
        }
        return keyPair
    }

    /** Returns all stored key pairs. */
    suspend fun getKeys(): List<StoredKeyPair> = client.keys.getAll()

    /** Removes a key pair by its public key. */
    suspend fun removeKeyPair(publicKey: PublicKey) {
        client.keys.delete(publicKey.key.toByteArray())
    }
}
