package org.futo.polycentric.core

/**
 * Reserved collection IDs for `EventKey.collection`.
 *
 * The proto field is a plain int32 — there is deliberately no enum in the
 * schema (arbitrary collections are allowed); the reserved values are
 * documented in protos/polycentric/v2/event_key.proto and mirrored in
 * js-core src/constants.ts and rs-common src/models/collections.rs.
 * Keep all three in sync.
 */
object Collections {
    const val IDENTITY = 1
    const val FEED = 2
    const val PROFILE = 3
    const val INTERACTIONS = 4
    const val GRAPH = 5
    const val REPORTS = 6
    const val LABELS = 7
    const val VERIFICATIONS = 8
}

/** `PublicKey.key_type` / `ContentDigest.type` values (KeyType enum in keypair.proto only defines ED25519). */
object KeyTypes {
    const val ED25519 = 1
    const val SHA256 = 2
}

/**
 * How to sync events and blobs for an identity between the local store and
 * the remote servers. Mirrors js-core `SyncStrategy`.
 */
enum class SyncStrategy {
    /** Push and pull all events. */
    FULL,
    /** Push all events; pull nothing. */
    FULL_PUSH,
    /** Pull all events; push nothing. */
    FULL_PULL,
    /** Push and pull only events believed to be missing. */
    PARTIAL,
    PARTIAL_PUSH,
    PARTIAL_PULL,
}
