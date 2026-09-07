package org.futo.polycentric.core

import polycentric.v2.ContentDigest
import polycentric.v2.EventKey
import polycentric.v2.PublicKey
import polycentric.v2.SignedEvent

/**
 * 1:1 ports of js-core platform-interfaces. Implementations are
 * pluggable so the library core stays storage-agnostic (SQLite on
 * Android, in-memory in tests) — the same pattern js-core uses for
 * IndexedDB vs sqlite vs postgres drivers.
 */

interface IEventRepository {
    suspend fun save(signedEvent: SignedEvent)

    /** Batch save; drivers with transactions should override this. */
    suspend fun saveAll(signedEvents: List<SignedEvent>) {
        for (signedEvent in signedEvents) save(signedEvent)
    }

    suspend fun getAll(): List<SignedEvent>
    suspend fun getByEventKey(key: EventKey): SignedEvent?

    /**
     * Events for an identity, sorted by sequence ascending. Optional
     * [signer] and [collection] narrow the scan. With [headsOnly] return
     * only the highest-sequence event per (signer, collection) stream —
     * the anchors for a partial pull.
     */
    suspend fun getByIdentity(
        identity: String,
        signer: PublicKey? = null,
        collection: Int? = null,
        headsOnly: Boolean = false,
    ): List<SignedEvent>
}

interface IContentRepository {
    suspend fun save(digest: ContentDigest, contentBytes: ByteArray)
    suspend fun get(digest: ContentDigest): ByteArray?
    suspend fun getAll(): List<Pair<ContentDigest, ByteArray>>
}

interface IKeysRepository {
    /** Persist a keypair (private key bytes are the caller's concern to encrypt). */
    suspend fun save(publicKey: ByteArray, keyType: Int, privateKey: ByteArray)
    suspend fun getAll(): List<StoredKeyPair>
    suspend fun getByPublicKey(publicKey: ByteArray): StoredKeyPair?
    suspend fun delete(publicKey: ByteArray)
}

class StoredKeyPair(
    val keyType: Int,
    val publicKey: ByteArray,
    val privateKey: ByteArray,
)

/** Tracks which servers have acked which events, enabling partial push. */
interface IEventAckRepository {
    suspend fun recordAck(server: String, key: EventKey)
    suspend fun isAcked(server: String, key: EventKey): Boolean
}

/** Content-addressed blob storage (avatar/post images), keyed by digest. */
interface IFileStoreDriver {
    suspend fun put(digest: ContentDigest, bytes: ByteArray)
    suspend fun get(digest: ContentDigest): ByteArray?
    suspend fun delete(digest: ContentDigest)
    suspend fun has(digest: ContentDigest): Boolean = get(digest) != null
}

interface IStorageDriver {
    fun createEventRepository(): IEventRepository
    fun createContentRepository(): IContentRepository
    fun createKeysRepository(): IKeysRepository
    fun createEventAckRepository(): IEventAckRepository

    /**
     * The identity a device keypair holds — the durable binding used to list
     * and switch identities. Passing `null` removes the binding (identity
     * deleted from the device); logout does NOT go through here.
     */
    suspend fun saveActiveIdentityKey(publicKey: ByteArray, identityKey: String?)
    suspend fun loadActiveIdentityKey(publicKey: ByteArray): String?

    /**
     * The currently signed-in identity, or `null` when logged out. Persisted
     * separately from the binding so logout survives a restart without
     * forgetting the identity.
     */
    suspend fun saveActiveSession(identityKey: String?)
    suspend fun loadActiveSession(): String?
}

/**
 * Parameter order matches js-core's ICryptoManager exactly — in
 * particular `verify(publicKey, message, signature, keyType)` — so code
 * ported between the two wrappers can't silently swap two ByteArrays.
 */
interface ICryptoManager {
    fun generateKeyPair(keyType: Int): StoredKeyPair
    fun derivePublicKey(privateKey: ByteArray, keyType: Int): ByteArray
    suspend fun sign(privateKey: ByteArray, message: ByteArray, keyType: Int): ByteArray
    fun verify(publicKey: ByteArray, message: ByteArray, signature: ByteArray, keyType: Int): Boolean
    fun getSupportedKeyTypes(): List<Int>
}
