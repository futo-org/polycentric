package org.futo.polycentric.core

import org.futo.polycentric.ffi.GetAttributionFeedArgs
import org.futo.polycentric.ffi.GetEventArgs
import org.futo.polycentric.ffi.GetIdentityFeedArgs
import org.futo.polycentric.ffi.GetPostThreadArgs
import org.futo.polycentric.ffi.GetProfileArgs
import org.futo.polycentric.ffi.ListVerificationClaimsArgs
import org.futo.polycentric.ffi.ResolveVerifiedClaimsArgs
import org.futo.polycentric.ffi.Query
import polycentric.v2.AttributedTo
import polycentric.v2.EventBundle
import polycentric.v2.EventKey
import polycentric.v2.GetFeedResponse
import polycentric.v2.GetPostThreadResponse
import polycentric.v2.GetProfileResponse
import polycentric.v2.ListVerificationClaimsResponse
import polycentric.v2.ResolveVerifiedClaimsResponse

/**
 * Typed one-shot wrappers for the core `Query` variants this SDK uses. Each
 * fans out over the configured servers and resolves on the first `Success`
 * status via [awaitQuery].
 */


suspend fun PolycentricClient.getProfile(identity: String): GetProfileResponse? =
    core.awaitQuery(Query.GetProfile(GetProfileArgs(identity)))
        ?.let { GetProfileResponse.ADAPTER.decode(it) }

/** Returns the single event bundle for a key, or null when no server has it. */
suspend fun PolycentricClient.getEvent(
    identity: String,
    collection: Int,
    sequence: Long,
    /** Hex prefix of the signing key, to disambiguate same-sequence events. */
    signerKeyPrefix: String? = null,
): EventBundle? =
    core.awaitQuery(
        Query.GetEvent(GetEventArgs(identity, collection, sequence.toULong(), signerKeyPrefix)),
    )?.let { EventBundle.ADAPTER.decode(it) }

suspend fun PolycentricClient.getPostThread(
    postKey: EventKey,
    limit: Int = 50,
    omitLabels: List<String> = emptyList(),
): GetPostThreadResponse? =
    core.awaitQuery(Query.GetPostThread(GetPostThreadArgs(postKey.toFfiOrThrow(), limit, omitLabels)))
        ?.let { GetPostThreadResponse.ADAPTER.decode(it) }

suspend fun PolycentricClient.getIdentityFeed(
    identity: String,
    limit: Int? = null,
    backwardToken: String? = null,
    forwardToken: String? = null,
    omitLabels: List<String> = emptyList(),
    windowSize: Int? = null,
): GetFeedResponse? =
    core.awaitQuery(
        Query.GetIdentityFeed(
            GetIdentityFeedArgs(identity, limit, backwardToken, forwardToken, omitLabels, windowSize),
        ),
    )?.let { GetFeedResponse.ADAPTER.decode(it) }

/**
 * Posts attributed to the same target as [attributedTo] — e.g. all posts
 * about a video URL. For a link, "same target" means the same URL,
 * ignoring the other Link metadata. The whole AttributedTo crosses the
 * FFI as serialized proto bytes.
 */
suspend fun PolycentricClient.getAttributionFeed(
    attributedTo: AttributedTo,
    limit: Int? = null,
    backwardToken: String? = null,
    forwardToken: String? = null,
    omitLabels: List<String> = emptyList(),
    windowSize: Int? = null,
): GetFeedResponse? =
    core.awaitQuery(
        Query.GetAttributionFeed(
            GetAttributionFeedArgs(
                AttributedTo.ADAPTER.encode(attributedTo),
                limit,
                backwardToken,
                forwardToken,
                omitLabels,
                windowSize,
            ),
        ),
    )?.let { GetFeedResponse.ADAPTER.decode(it) }

suspend fun PolycentricClient.listVerificationClaims(
    claimedByIdentity: String,
): ListVerificationClaimsResponse? =
    core.awaitQuery(
        Query.ListVerificationClaims(ListVerificationClaimsArgs(claimedByIdentity)),
    )?.let { ListVerificationClaimsResponse.ADAPTER.decode(it) }

/**
 * Reverse lookup: verified claims whose fields contain every pair in [fields],
 * restricted to those verified by one of [verifiedByIdentities] (the trust
 * roots), optionally scoped to a schema by its digest ([schemaDigest], sha256).
 * Starts from claim field values (e.g. a platform channel id) rather than from
 * an identity, and works for any claim type.
 */
suspend fun PolycentricClient.resolveVerifiedClaims(
    fields: Map<String, String>,
    verifiedByIdentities: List<String>,
    schemaDigest: ByteArray? = null,
): ResolveVerifiedClaimsResponse? =
    core.awaitQuery(
        Query.ResolveVerifiedClaims(
            ResolveVerifiedClaimsArgs(
                schemaDigest,
                fields,
                verifiedByIdentities,
            ),
        ),
    )?.let { ResolveVerifiedClaimsResponse.ADAPTER.decode(it) }
