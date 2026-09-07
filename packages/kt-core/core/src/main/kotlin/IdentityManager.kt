package org.futo.polycentric.core

import java.security.MessageDigest
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.futo.polycentric.ffi.ListEventsArgs
import org.futo.polycentric.ffi.Query
import org.futo.polycentric.ffi.QueryOpts
import polycentric.v2.Content
import polycentric.v2.ContentDigest
import polycentric.v2.ContentDigestType
import polycentric.v2.Event
import polycentric.v2.EventKey
import polycentric.v2.Identity
import polycentric.v2.PublicKey
import polycentric.v2.ServerList
import polycentric.v2.SignedEvent
import polycentric.v2.VectorClock

/**
 * Resolved identity state from the latest Identity document.
 * Port of js-core `IdentityState`.
 */
class IdentityState(
    /** The identity key (hex-encoded sha256 of the initial Identity content). */
    val identityKey: String?,
    /** Rotation keys that control the identity. */
    val rotationKeys: List<PublicKey>,
    /** Signing keys authorized to sign events. */
    val signingKeys: List<PublicKey>,
    /**
     * Servers this identity pushes to and pulls from. `null` when the
     * identity has never configured its list (clients fall back to their
     * defaults); an empty list is an intentionally empty list.
     */
    val servers: List<String>?,
)

class PublishResult(
    val identityKey: String,
    val signedEvent: SignedEvent,
)

/**
 * IdentityManager owns all identity lifecycle operations — publishing,
 * claiming, key rotation — and the authorization checks that go with them.
 *
 * Port of js-core `client-internal/identity-manager.ts`. Chain-validity
 * rules live in rs-core; like js-core, methods here do only the local
 * bookkeeping and the "basic precaution" checks noted per method.
 */
class IdentityManager(private val client: PolycentricClient) {

    companion object {
        fun keysEqual(a: PublicKey, b: PublicKey): Boolean =
            a.key_type == b.key_type && a.key == b.key
    }

    /**
     * Serializes identity-document mutations (add/remove key or server). Each
     * is a getCurrent() → publish() read-modify-write against the same
     * document; running two concurrently (e.g. approving two paired devices at
     * once) makes the second overwrite the first's change based on a stale
     * read, dropping a key. Holding this across the whole read-modify-write
     * makes them run one at a time. Only guards same-process concurrency;
     * cross-device conflicts are resolved by sequence numbers on the server.
     */
    private val mutationMutex = Mutex()

    /**
     * How many identity-collection events to pull when resolving a remote
     * identity's chain. Identity chains are tiny (genesis + a handful of
     * key/server updates), so this comfortably covers the full collection.
     */
    private val IDENTITY_CHAIN_FETCH_SIZE = 1000

    /**
     * Resolves the current identity state by finding the latest Identity
     * document on the identity collection for the active key pair.
     */
    suspend fun getCurrent(): IdentityState {
        val activeKey = client.activeIdentityKey
            ?: return IdentityState(null, emptyList(), emptyList(), null)

        // TODO: Fix this so it doesn't need to go over all events
        //       (js-core has the same TODO; an (identity, collection)
        //       index on IEventRepository is the fix for both).
        var highestSequence = -1L
        var state = IdentityState(null, emptyList(), emptyList(), null)

        for (signedEvent in client.events.getAll()) {
            val event = Event.ADAPTER.decode(signedEvent.event_bytes)
            val key = event.key ?: continue
            if (key.collection != Collections.IDENTITY) continue
            if (key.identity != activeKey) continue
            val digest = event.content_digest ?: continue
            if (key.sequence <= highestSequence) continue

            val contentBytes = client.contents.get(digest) ?: continue
            val identity = Content.ADAPTER.decode(contentBytes).identity ?: continue

            highestSequence = key.sequence
            state = IdentityState(
                identityKey = key.identity,
                rotationKeys = identity.rotation_keys,
                signingKeys = identity.signing_keys,
                servers = identity.servers?.urls,
            )
        }

        return state
    }

    /**
     * Publishes a new Identity document with the given rotation and
     * signing keys.
     *
     * The identity key is the hex-encoded sha256 of the initial Identity
     * content. For a new identity, pass null and it is computed — the
     * bootstrap event is built by hand (sequence = 1, identitySequence = 1,
     * vectorClock = [1], empty previous signature) because the core cannot
     * resolve an identity document that doesn't exist yet.
     */
    suspend fun publish(
        identityKey: String?,
        rotationKeys: List<PublicKey>,
        signingKeys: List<PublicKey>,
        servers: List<String>? = null,
    ): PublishResult {
        val keyPair = client.currentKeyPair ?: throw NoActiveKeyPairException()
        val publicKeyProto = keyPair.toPublicKeyProto()

        val identity = Identity(
            rotation_keys = rotationKeys,
            signing_keys = signingKeys,
            servers = servers?.let { ServerList(urls = it) },
        )
        val content = Content(identity = identity)

        val isBootstrap = identityKey == null
        val resolvedIdentityKey: String
        if (isBootstrap) {
            if (rotationKeys.size != 1 ||
                signingKeys.isNotEmpty() ||
                !keysEqual(rotationKeys[0], publicKeyProto)
            ) {
                throw PolycentricException(
                    "Initial identity must have exactly one rotation key (the current key) and no signing keys",
                )
            }
            resolvedIdentityKey = sha256(Identity.ADAPTER.encode(identity)).toHex()
        } else {
            resolvedIdentityKey = identityKey
        }

        val contentBytes = Content.ADAPTER.encode(content)
        val digest = ContentDigest(
            type = ContentDigestType.CONTENT_DIGEST_TYPE_SHA256,
            value_ = sha256(contentBytes).toByteString(),
        )
        client.contents.save(digest, contentBytes)
        client.setActiveIdentityKey(resolvedIdentityKey)

        val event = if (isBootstrap) {
            Event(
                key = EventKey(
                    collection = Collections.IDENTITY,
                    identity = resolvedIdentityKey,
                    signed_by = publicKeyProto,
                    sequence = 1L,
                ),
                identity_sequence = 1L,
                vector_clock = VectorClock(sequence = listOf(1L)),
                previous_signature = ByteString.EMPTY,
                content_digest = digest,
                created_at = System.currentTimeMillis(),
                application = client.application,
            )
        } else {
            client.buildEvent(content, Collections.IDENTITY)
        }

        val signedEvent = client.signEvent(event)
        client.commitEvent(signedEvent, content)

        // The identity document is the source of truth for the server list,
        // so adopt it before syncing — a newly added server receives the push.
        if (servers != null) {
            client.adoptServers(servers)
        }

        client.sync(SyncStrategy.PARTIAL_PUSH)

        return PublishResult(resolvedIdentityKey, signedEvent)
    }

    /**
     * Fetches and validates the identity state of any identity from one
     * server (intended for polling while pairing). Hydrates the identity's
     * full event chain from the server into the core, then resolves it via
     * the core's rs-common chain logic — which validates content-digest
     * match, vector-clock/collection integrity, and signer authorization
     * across the whole chain, rather than trusting a single event
     * (js-core #200: "always use rs-common for identity chain logic").
     */
    suspend fun fetchIdentityState(
        identityKey: String,
        server: String? = null,
    ): IdentityState {
        val targetServer = server ?: client.servers.firstOrNull()
            ?: throw PolycentricException("No servers configured")

        // Hydrate the identity's events from the server into the core's local
        // store so its chain can be validated as a whole. Identity chains are
        // small; a generous size fetches the full collection.
        client.core.awaitQuery(
            Query.ListEvents(
                ListEventsArgs(
                    size = IDENTITY_CHAIN_FETCH_SIZE,
                    identity = identityKey,
                    collection = Collections.IDENTITY,
                    signedBy = null,
                    sequenceGt = null,
                    sequenceLt = null,
                    heads = null,
                ),
            ),
            queryKey = listOf("list_events_for_server", targetServer, identityKey),
            opts = QueryOpts(fetchMode = null, updateMode = null, servers = listOf(targetServer), emitMode = null, serverTimeoutMs = null),
        )

        return resolveIdentity(identityKey)
            ?: throw IdentityNotFoundException(identityKey)
    }

    /**
     * Resolve an identity's latest validated state from the core's LOCAL
     * store via rs-common chain validation (js-core #200). Returns null when
     * no valid chain is known locally — callers hydrate the events first
     * (e.g. [fetchIdentityState] or a sync).
     */
    private fun resolveIdentity(identityKey: String): IdentityState? {
        val bytes = client.core.resolveIdentity(identityKey) ?: return null
        val identity = Identity.ADAPTER.decode(bytes)
        return IdentityState(
            identityKey = identityKey,
            rotationKeys = identity.rotation_keys,
            signingKeys = identity.signing_keys,
            servers = identity.servers?.urls,
        )
    }

    /**
     * Claims an identity: verifies the current key is authorized on it,
     * sets it active, pulls the full identity event history, then
     * re-publishes the same document signed by our own key — proving this
     * key acknowledged its membership (the only mutation a signing key is
     * allowed to make).
     */
    suspend fun claim(identityKey: String): IdentityState {
        val keyPair = client.currentKeyPair ?: throw NoActiveKeyPairException()
        val publicKeyProto = keyPair.toPublicKeyProto()

        // Validate authorization via rs-common chain logic before adopting.
        val state = fetchIdentityState(identityKey)
        if (!isAuthorized(state, publicKeyProto)) {
            throw UnauthorizedKeyException()
        }

        client.setActiveIdentityKey(identityKey)
        client.sync(SyncStrategy.PARTIAL_PULL)

        // Re-validate after pulling the full history — authorization could have
        // been revoked between the check and the pull (js-core #200).
        val pulled = resolveIdentity(identityKey)
        if (pulled == null || !isAuthorized(pulled, publicKeyProto)) {
            throw UnauthorizedKeyException()
        }

        publish(identityKey, pulled.rotationKeys, pulled.signingKeys, pulled.servers)

        return pulled
    }

    /** Whether [state] authorizes [myKey] (present as a rotation or signing key). */
    private fun isAuthorized(state: IdentityState, myKey: PublicKey): Boolean =
        state.rotationKeys.any { keysEqual(it, myKey) } ||
            state.signingKeys.any { keysEqual(it, myKey) }

    suspend fun isRotationKeyForIdentity(identityKey: String, publicKey: PublicKey): Boolean {
        val state = getCurrent()
        if (state.identityKey != identityKey) return false
        return state.rotationKeys.any { keysEqual(it, publicKey) }
    }

    /** Adds a signing key to the current identity and publishes the update. */
    suspend fun addSigningKey(publicKey: PublicKey): SignedEvent = mutationMutex.withLock {
        val state = getCurrent()
        val identityKey = state.identityKey ?: throw NoActiveIdentityException()
        publish(
            identityKey,
            state.rotationKeys,
            state.signingKeys + publicKey,
            state.servers,
        ).signedEvent
    }

    /** Adds a rotation key to the current identity and publishes the update. */
    suspend fun addRotationKey(publicKey: PublicKey): SignedEvent = mutationMutex.withLock {
        val state = getCurrent()
        val identityKey = state.identityKey ?: throw NoActiveIdentityException()
        if (state.rotationKeys.any { keysEqual(it, publicKey) }) {
            throw PolycentricException("Rotation key already exists")
        }
        publish(
            identityKey,
            state.rotationKeys + publicKey,
            state.signingKeys,
            state.servers,
        ).signedEvent
    }

    /**
     * Adds a server to the current identity document and publishes the
     * update. Calls the server's `GetInfo` first — an unreachable server
     * is not added.
     */
    suspend fun addServer(url: String): SignedEvent = mutationMutex.withLock {
        val state = getCurrent()
        val identityKey = state.identityKey ?: throw NoActiveIdentityException()

        // An identity that has never configured its list starts from the
        // client's effective (default) servers.
        val servers = state.servers ?: client.servers
        if (url in servers) {
            throw ServerAlreadyAddedException()
        }

        client.core.getServerInfo(url)

        publish(
            identityKey,
            state.rotationKeys,
            state.signingKeys,
            servers + url,
        ).signedEvent
    }

    /** Removes a server from the current identity document and publishes the update. */
    suspend fun removeServer(url: String): SignedEvent = mutationMutex.withLock {
        val state = getCurrent()
        val identityKey = state.identityKey ?: throw NoActiveIdentityException()

        val current = state.servers ?: client.servers
        val servers = current.filter { it != url }
        if (servers.size == current.size) {
            throw PolycentricException("Server not found")
        }

        publish(
            identityKey,
            state.rotationKeys,
            state.signingKeys,
            servers,
        ).signedEvent
    }

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}
