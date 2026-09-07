package org.futo.polycentric.core

import java.security.MessageDigest
import java.util.logging.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okio.ByteString.Companion.toByteString
import org.futo.polycentric.core.ServerJwt
import org.futo.polycentric.core.ICryptoManager
import org.futo.polycentric.core.IFileStoreDriver
import org.futo.polycentric.core.IStorageDriver
import org.futo.polycentric.core.StoredKeyPair
import org.futo.polycentric.ffi.AuthToken
import org.futo.polycentric.ffi.AuthTokenProvider
import org.futo.polycentric.ffi.ContentEntry
import org.futo.polycentric.ffi.ListEventsArgs
import org.futo.polycentric.ffi.PolycentricCore
import org.futo.polycentric.ffi.Query
import org.futo.polycentric.ffi.SignBytesCallback
import polycentric.v2.Blob
import polycentric.v2.Content
import polycentric.v2.ContentDigest
import polycentric.v2.ContentDigestType
import polycentric.v2.Event
import polycentric.v2.EventBundle
import polycentric.v2.EventKey
import polycentric.v2.ListEventsResponse
import polycentric.v2.PublicKey
import polycentric.v2.PutEventsResponse
import polycentric.v2.SignedEvent
import polycentric.v2.UploadBlobRequest
import polycentric.v2.VectorClock

/**
 * Kotlin port of js-core `PolycentricClient` (polycentric-client.ts).
 *
 * Thin orchestration shell over the shared Rust protocol engine
 * (rs-core via UniFFI): the core owns sequences, Merkle anchoring,
 * vector clocks, validation, the networked query engine, and gRPC
 * transport (native tonic + TLS — no Kotlin transport code needed).
 * This class owns key custody, persistent storage, and control flow.
 */
class PolycentricClient(
    val core: PolycentricCore,
    private val storageDriver: IStorageDriver,
    val filestore: IFileStoreDriver,
    seedServers: List<String> = emptyList(),
    val crypto: ICryptoManager = org.futo.polycentric.core.Ed25519CryptoManager(),
    /** Stamped on every event this client builds. */
    val application: polycentric.v2.Application? = null,
) {
    @Volatile
    var currentKeyPair: StoredKeyPair? = null
        private set

    /** Identity key (hex sha256 of genesis Identity doc) the keypair acts as. */
    @Volatile
    var activeIdentityKey: String? = null
        private set

    @Volatile
    var servers: List<String> = seedServers
        private set

    val events = storageDriver.createEventRepository()
    val contents = storageDriver.createContentRepository()
    val keys = storageDriver.createKeysRepository()
    val eventAcks = storageDriver.createEventAckRepository()

    val identityManager = IdentityManager(this)
    val contentManager = ContentManager(this)
    val keyPairManager = KeyPairManager(this)
    val pairingSessionManager = PairingSessionManager(this)

    /**
     * Outward event bus (js-core `client.events`; renamed here because
     * `events` is the event *repository* on this flattened client).
     */
    val eventService = EventService()

    @Volatile
    var error: Throwable? = null
        private set

    val isReady: Boolean
        get() = eventService.state.value == ClientState.READY

    /**
     * Suspends until the client has finished [initialize] and reached
     * [ClientState.READY] — the point at which `currentKeyPair`/`currentSystem`
     * are guaranteed set. Returns immediately if already ready. Throws the
     * initialization failure if the client ended in [ClientState.ERROR], rather
     * than suspending forever. Lets callers gate on readiness the way js-core's
     * `await create()` does, instead of touching a half-built client.
     */
    suspend fun awaitReady() {
        eventService.state.first { state ->
            when (state) {
                ClientState.READY -> true
                ClientState.ERROR ->
                    throw (error ?: PolycentricException("Client initialization failed"))
                else -> false
            }
        }
    }

    /** The active device public key as a proto (js-core `currentSystem`). */
    val currentSystem: PublicKey
        get() = requireNotNull(currentKeyPair) { "No keypair set" }.toPublicKeyProto()

    private val http = OkHttpClient()

    init {
        // Authenticate every outgoing gRPC request as the active identity.
        // The core caches each server's token and only calls back when it
        // expires (js-core parity: the PolycentricClient constructor).
        core.setAuthTokenProvider(object : AuthTokenProvider {
            override suspend fun authToken(serverUrl: String): AuthToken? {
                val keyPair = currentKeyPair ?: return null
                val identity = activeIdentityKey ?: return null
                val nowSeconds = System.currentTimeMillis() / 1000
                return AuthToken(
                    token = ServerJwt.create(crypto, keyPair, iss = identity, aud = serverUrl, nowSeconds = nowSeconds),
                    expiresAt = (nowSeconds + ServerJwt.DEFAULT_EXPIRY_SECONDS).toULong(),
                )
            }
        })
    }

    companion object {
        private val log = Logger.getLogger("PolycentricClient")

        /** Construct and initialize in one step (js-core `PolycentricClient.create`). */
        suspend fun create(
            core: PolycentricCore,
            storageDriver: IStorageDriver,
            filestore: IFileStoreDriver,
            seedServers: List<String> = emptyList(),
            crypto: ICryptoManager = org.futo.polycentric.core.Ed25519CryptoManager(),
        ): PolycentricClient =
            PolycentricClient(core, storageDriver, filestore, seedServers, crypto)
                .also { it.initialize() }
    }

    // ── Lifecycle (js-core: initialize) ────────────────────────────────

    /**
     * Hydrate the Rust core's ephemeral in-memory stores from persistent
     * storage, restore (or create) a keypair, and push the server list
     * into the core. Mirrors js-core `initialize()` including its state
     * machine and progress/hydration signals.
     */
    suspend fun initialize() {
        try {
            eventService.emitStateChanged(ClientState.INITIALIZING)
            eventService.emitProgress(InitializationStep.STARTING)

            eventService.emitProgress(InitializationStep.HYDRATING_EVENTS)
            eventService.emitHydrationStatus(HydrationStatus.IN_PROGRESS)
            copyEvents()
            copyContents()
            eventService.emitHydrationStatus(HydrationStatus.COMPLETED)

            // Restore the first stored keypair, or create an ephemeral one —
            // the SDK always has a keypair after initialize (js-core parity).
            val session = storageDriver.loadActiveSession()
            val allKeys = keys.getAll()
            // The keypair holding the signed-in identity; fall back to any
            // stored key so the client always has a keypair (js-core parity)
            // when logged out.
            val sessionKey = session?.let { s ->
                allKeys.firstOrNull { storageDriver.loadActiveIdentityKey(it.publicKey) == s }
            }
            val restored = sessionKey ?: allKeys.firstOrNull()
            if (restored != null) {
                currentKeyPair = restored
                // Signed in only when the session resolved to a keypair we hold.
                activeIdentityKey = if (restored === sessionKey) session else null
                eventService.emitKeyPairChanged(restored)
            } else {
                eventService.emitProgress(InitializationStep.CREATING_EPHEMERAL_IDENTITY)
                keyPairManager.createKeyPair(setAsCurrent = true)
            }

            refreshServers()

            eventService.emitProgress(InitializationStep.COMPLETE)
            eventService.emitStateChanged(ClientState.READY)
        } catch (e: Throwable) {
            error = e
            // Only report a hydration failure when hydration is what failed;
            // later steps (keypair restore, server refresh) leave it COMPLETED.
            if (eventService.hydrationStatus.value == HydrationStatus.IN_PROGRESS) {
                eventService.emitHydrationStatus(HydrationStatus.FAILED)
            }
            eventService.emitStateChanged(ClientState.ERROR)
            eventService.emitError(e)
            throw e
        }
    }

    /** js-core `copyEvents`: replay stored events into the core. */
    suspend fun copyEvents(events: List<SignedEvent>? = null) {
        val all = events ?: this.events.getAll()
        core.copyEvents(all.map { SignedEvent.ADAPTER.encode(it) })
    }

    /** js-core `copyContents`: replay stored content into the core. */
    suspend fun copyContents() {
        core.copyContents(
            contents.getAll().map { (digest, contentBytes) ->
                ContentEntry(
                    digestBytes = ContentDigest.ADAPTER.encode(digest),
                    contentBytes = contentBytes,
                )
            },
        )
    }

    // ── Event construction (js-core: buildEvent / signEvent / commitEvent) ──

    /**
     * Build an unsigned Event for `content` in `collection` using the
     * active identity and current keypair. Sequences, previous
     * signature/root (RFC-6962), and the vector clock all come from the
     * core — the exact steps of js-core `buildEvent`.
     *
     * Note: proto uint64 fields surface as Long in Wire and ULong across
     * the FFI; conversions are lossless bit-reinterpretations.
     */
    fun buildEvent(content: Content, collection: Int = Collections.FEED): Event {
        val keyPair = requireNotNull(currentKeyPair) { "No keypair set" }
        val identity = requireNotNull(activeIdentityKey) { "No active identity" }

        val sequence = core.nextSequence(identity, collection)
        val publicKeyProto = keyPair.toPublicKeyProto()
        val signedByBytes = PublicKey.ADAPTER.encode(publicKeyProto)

        val identitySequence = if (collection == Collections.IDENTITY) {
            sequence
        } else {
            core.getIdentitySequence(identity, signedByBytes)
                ?: error("Cannot build event: current keypair has no identity event for the active identity (broken pairing?)")
        }

        val contentBytes = Content.ADAPTER.encode(content)
        val digest = ContentDigest(
            type = ContentDigestType.CONTENT_DIGEST_TYPE_SHA256,
            value_ = sha256(contentBytes).toByteString(),
        )

        val identityContentForVc: ByteArray? =
            if (collection == Collections.IDENTITY) content.identity
                ?.let { polycentric.v2.Identity.ADAPTER.encode(it) }
            else null

        val clockBytes = core.buildVectorClock(
            identity,
            collection,
            identitySequence,
            signedByBytes,
            sequence,
            identityContentForVc,
        )

        return Event(
            key = EventKey(
                collection = collection,
                identity = identity,
                signed_by = publicKeyProto,
                sequence = sequence.toLong(),
            ),
            identity_sequence = identitySequence.toLong(),
            vector_clock = VectorClock.ADAPTER.decode(clockBytes),
            previous_signature = core.previousSignature(identity, collection).toByteString(),
            previous_root = core.previousRoot(identity, collection).toByteString(),
            content_digest = digest,
            created_at = System.currentTimeMillis(),
            application = application,
        )
    }

    /**
     * Sign via the core's canonical envelope. Private keys never cross
     * the FFI — the core calls back into [crypto] with the exact bytes
     * to sign (js-core `signEvent`).
     */
    suspend fun signEvent(event: Event): SignedEvent {
        val keyPair = requireNotNull(currentKeyPair) { "No keypair" }
        val eventBytes = Event.ADAPTER.encode(event)

        val signedBytes = core.signEvent(
            eventBytes,
            object : SignBytesCallback {
                override suspend fun sign(bytes: ByteArray): ByteArray =
                    crypto.sign(keyPair.privateKey, bytes, keyPair.keyType)
            },
        )
        return SignedEvent.ADAPTER.decode(signedBytes)
    }

    /**
     * Persist a signed event (and its content) locally and mirror both
     * into the core so subsequent sequence/clock reads see them
     * (js-core `commitEvent`).
     */
    suspend fun commitEvent(signedEvent: SignedEvent, content: Content? = null) {
        events.save(signedEvent)
        core.copyEvents(listOf(SignedEvent.ADAPTER.encode(signedEvent)))
        if (content != null) {
            val event = Event.ADAPTER.decode(signedEvent.event_bytes)
            event.content_digest?.let { digest ->
                val contentBytes = Content.ADAPTER.encode(content)
                contents.save(digest, contentBytes)
                core.copyContents(
                    listOf(
                        ContentEntry(
                            digestBytes = ContentDigest.ADAPTER.encode(digest),
                            contentBytes = contentBytes,
                        ),
                    ),
                )
            }
        }
        eventService.emitContentCreated(ContentCreatedPayload(signedEvent, content))
    }

    // ── Queries (js-core: listEvents / listValidEvents) ────────────────

    /** One-shot ListEvents across all configured servers. */
    suspend fun listEvents(
        identity: String? = null,
        collection: Int? = null,
        limit: Int? = null,
        signedBy: PublicKey? = null,
        /** Exclusive lower bound on EventKey.sequence. */
        sequenceGt: Long? = null,
        /** Exclusive upper bound on EventKey.sequence. */
        sequenceLt: Long? = null,
        heads: List<EventKey> = emptyList(),
        queryKey: List<String>? = null,
    ): List<EventBundle> {
        val bytes = core.awaitQuery(
            Query.ListEvents(
                ListEventsArgs(
                    size = limit,
                    identity = identity,
                    collection = collection,
                    signedBy = signedBy?.toFfi(),
                    sequenceGt = sequenceGt,
                    sequenceLt = sequenceLt,
                    heads = heads.mapNotNull { it.toFfiOrNull() }.ifEmpty { null },
                ),
            ),
            queryKey = queryKey,
        ) ?: return emptyList()
        return ListEventsResponse.ADAPTER.decode(bytes).event_bundles
    }

    /** Local, tombstone-filtered view of an (identity, collection) stream. */
    fun listValidEvents(identity: String, collection: Int): List<EventBundle> {
        val bytes = core.listValidEvents(identity, collection)
        return ListEventsResponse.ADAPTER.decode(bytes).event_bundles
    }


    // ── Sync (js-core: sync / pull / push) ─────────────────────────────

    /**
     * Bidirectional sync for the active identity. Pull fetches bundles
     * (optionally bounded by local heads) and persists new ones; push
     * delegates to the core's `pushLocalEvents`, then uploads any blobs
     * the server reports missing. Mirrors js-core `sync()`.
     */
    suspend fun sync(strategy: SyncStrategy = SyncStrategy.PARTIAL): Int = coroutineScope {
        val identity = activeIdentityKey ?: return@coroutineScope 0

        // A pull failure must not cancel in-flight pushes (js-core joins
        // both with allSettled): capture it and rethrow after the pushes.
        val pullTask = async {
            try {
                Result.success(
                    when (strategy) {
                        SyncStrategy.FULL, SyncStrategy.FULL_PULL -> pull(partial = false)
                        SyncStrategy.PARTIAL, SyncStrategy.PARTIAL_PULL -> pull(partial = true)
                        else -> 0
                    },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Result.failure(e)
            }
        }

        val doPush = strategy != SyncStrategy.FULL_PULL && strategy != SyncStrategy.PARTIAL_PULL
        val partialPush = strategy == SyncStrategy.PARTIAL || strategy == SyncStrategy.PARTIAL_PUSH

        val pushTasks = if (doPush) {
            servers.map { server ->
                async {
                    try {
                        val responseBytes = core.pushLocalEvents(identity, server, partialPush)
                            ?: return@async
                        val response = PutEventsResponse.ADAPTER.decode(responseBytes)
                        for (pushError in response.errors) {
                            log.warning("Error from event push: $pushError")
                        }
                        for (blob in response.requested_blobs) {
                            val digest = blob.digest ?: continue
                            val body = filestore.get(digest) ?: continue
                            uploadBlob(blob, body, listOf(server))
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Throwable) {
                        log.warning("Sync failed for $server: $e")
                    }
                }
            }
        } else {
            emptyList()
        }

        pushTasks.awaitAll()
        pullTask.await().getOrThrow()
    }

    private suspend fun pull(partial: Boolean): Int {
        val identity = activeIdentityKey ?: throw NoActiveIdentityException()
        val heads = if (partial) {
            events.getByIdentity(identity, headsOnly = true)
                .mapNotNull { Event.ADAPTER.decode(it.event_bytes).key }
        } else {
            emptyList()
        }

        val bundles = listEvents(identity = identity, heads = heads)

        // Blobs referenced by pulled content, deduped by digest so each
        // is fetched once (js-core `pull`).
        val blobs = mutableMapOf<String, polycentric.v2.Blob>()

        var newCount = 0
        for (bundle in bundles) {
            if (trySaveBundle(bundle, blobs)) newCount++
        }

        // Fetch any of our own referenced blobs so they persist locally.
        contentManager.pullBlobs(blobs.values.toList())
        return newCount
    }

    /**
     * Absorb errors and return true only when the event is new and added.
     * Discovered blobs are added to [blobs]. (js-core `trySaveBundle`.)
     */
    private suspend fun trySaveBundle(
        bundle: EventBundle,
        blobs: MutableMap<String, polycentric.v2.Blob>,
    ): Boolean = runCatching {
        val signed = bundle.signed_event ?: return false
        val event = Event.ADAPTER.decode(signed.event_bytes)
        val key = event.key ?: return false
        if (key.signed_by == null) return false

        // Try saving content for any event that seems valid, even if the
        // event itself may already exist.
        trySaveContent(event, bundle, blobs)

        if (events.getByEventKey(key) != null) return false

        // Verify the signature before persisting an untrusted (server-supplied)
        // event. On the next startup `copyEvents` replays every stored event
        // through the core, which verifies signatures and fails the whole
        // batch on a bad one — so persisting even one unverified event would
        // brick every subsequent launch (ClientState.ERROR) until the DB is
        // wiped. `runCatching` turns a bad event into skip-and-log, leaving the
        // rest of the bundle to save. This subsumes js-core's empty-signature /
        // empty-event-bytes guards: an empty or invalid signature, or empty
        // event bytes, fails verification here.
        core.verifySignedEvent(SignedEvent.ADAPTER.encode(signed))

        events.save(signed)
        true
    }.getOrElse { e ->
        log.warning("Pull event: $e")
        false
    }

    /**
     * Absorb errors and return true only when the content is new and
     * added. Discovered blobs are added to [blobs] BEFORE the existence
     * check — we might be missing a blob referenced by content we already
     * have. (js-core `trySaveContent`.)
     */
    private suspend fun trySaveContent(
        event: Event,
        bundle: EventBundle,
        blobs: MutableMap<String, polycentric.v2.Blob>,
    ): Boolean = runCatching {
        val contentBytes = bundle.serialized_content?.content_bytes ?: return false
        val content = Content.ADAPTER.decode(contentBytes)
        val digest = event.content_digest ?: return false

        for (blob in ContentManager.collectBlobs(content)) {
            val blobDigest = blob.digest ?: continue
            blobs["${blobDigest.type.value}_${blobDigest.value_.hex()}"] = blob
        }

        if (contents.get(digest) != null) return false
        contents.save(digest, contentBytes.toByteArray())
        true
    }.getOrElse { e ->
        log.warning("Pull event content: $e")
        false
    }

    // ── Blobs (js-core: commitBlob / fetchBlobBytes / uploadBlob) ──────

    /** Blob URL for each configured server, in order, for fallback. */
    fun blobUrls(digest: ContentDigest): List<String> {
        val key = "${digest.type.value}_${digest.value_.hex()}"
        return servers.map { "$it/blob/$key" }
    }

    /** First server's blob URL, or null if no servers are configured. */
    fun blobUrl(digest: ContentDigest): String? = blobUrls(digest).firstOrNull()

    suspend fun commitBlob(bytes: ByteArray, mimeType: String): Blob {
        val digest = ContentDigest(
            type = ContentDigestType.CONTENT_DIGEST_TYPE_SHA256,
            value_ = sha256(bytes).toByteString(),
        )
        filestore.put(digest, bytes)
        return Blob(digest = digest, mime_type = mimeType, size = bytes.size.toLong())
    }

    /** Plain-HTTP blob fetch with per-server fallback. */
    suspend fun fetchBlobBytes(digest: ContentDigest): ByteArray? = withContext(Dispatchers.IO) {
        for (url in blobUrls(digest)) {
            val bytes = runCatching {
                http.newCall(Request.Builder().url(url).build()).execute().use { res ->
                    if (res.isSuccessful) res.body?.bytes() else null
                }
            }.getOrNull()
            if (bytes != null) return@withContext bytes
        }
        null
    }

    suspend fun uploadBlob(blob: Blob, body: ByteArray, targets: List<String> = servers) {
        val requestBytes = UploadBlobRequest.ADAPTER.encode(
            UploadBlobRequest(blob = blob, body = body.toByteString()),
        )
        for (server in targets) {
            runCatching { core.uploadBlob(server, requestBytes) }
                .onFailure { log.warning("uploadBlob failed for $server: $it") }
        }
    }

    // ── Key / identity state (js-core: setCurrentKeyPair etc.) ─────────

    suspend fun setCurrentKeyPair(keyPair: StoredKeyPair) {
        currentKeyPair = keyPair
        activeIdentityKey = storageDriver.loadActiveIdentityKey(keyPair.publicKey)
        // Switching to a keypair signs in as its bound identity; persist that
        // session so it (and a subsequent logout) survives a restart.
        storageDriver.saveActiveSession(activeIdentityKey)
        refreshServers()
        eventService.emitKeyPairChanged(keyPair)
    }

    /**
     * Look up the v2 identity key bound to the given device keypair
     * locally; null when this device never associated one with the pair.
     */
    suspend fun getIdentityKeyFor(keyPair: StoredKeyPair): String? =
        storageDriver.loadActiveIdentityKey(keyPair.publicKey)

    suspend fun setActiveIdentityKey(identityKey: String?) {
        activeIdentityKey = identityKey
        // Tokens minted for the previous identity must not be reused.
        core.clearAuthTokens()
        // Persist the session (null = logged out) so it survives a restart.
        storageDriver.saveActiveSession(identityKey)
        // Record the key->identity binding on sign-in. Logout (null) leaves the
        // binding in place so the identity stays listable and can be signed back
        // into; removing it is deleteActiveIdentity's job.
        if (identityKey != null) {
            currentKeyPair?.let {
                storageDriver.saveActiveIdentityKey(it.publicKey, identityKey)
            }
        }
    }

    /**
     * Derive `servers` from the active identity's latest Identity doc
     * (falling back to seeds) and push the list into the core so its
     * fan-out queries have targets. Mirrors js-core `refreshServers`.
     */
    suspend fun refreshServers() {
        if (activeIdentityKey != null) {
            identityManager.getCurrent().servers?.let { servers = it }
        }
        core.setServers(servers)
    }

    /**
     * Adopt a server list (e.g. one published on the identity document, the
     * source of truth) and propagate it to the core. Used by IdentityManager
     * right after publishing so a newly added server receives the push, and by
     * clients that need to point at a negotiated server before claiming an
     * identity during device pairing (js-core exposes `servers` as settable).
     */
    fun adoptServers(list: List<String>) {
        servers = list.toList()
        core.setServers(servers)
    }

    private fun sha256(bytes: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(bytes)
}
