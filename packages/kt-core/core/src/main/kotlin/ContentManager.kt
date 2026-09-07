package org.futo.polycentric.core

import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import okio.ByteString.Companion.toByteString
import polycentric.v2.Blob
import polycentric.v2.Content
import polycentric.v2.ContentDigest
import polycentric.v2.ContentDigestType
import polycentric.v2.ImageSet

/**
 * Port of js-core `client-internal/content-manager.ts` — content digest
 * construction, local persistence, and blob replication.
 */
class ContentManager(private val client: PolycentricClient) {

    companion object {
        private val log = java.util.logging.Logger.getLogger("ContentManager")

        /** Collect all blobs referenced in a post or profile update. */
        fun collectBlobs(content: Content): List<Blob> {
            val out = mutableListOf<Blob>()
            fun pushSet(set: ImageSet?) {
                set?.images?.forEach { img -> img.blob?.let { out.add(it) } }
            }
            content.post?.images?.forEach { pushSet(it) }
            content.profile_update?.let {
                pushSet(it.avatar)
                pushSet(it.banner)
            }
            return out
        }
    }

    /** Builds a ContentDigest (sha256 over serialized Content bytes). */
    fun buildDigest(content: Content): ContentDigest {
        val contentBytes = Content.ADAPTER.encode(content)
        return ContentDigest(
            type = ContentDigestType.CONTENT_DIGEST_TYPE_SHA256,
            value_ = MessageDigest.getInstance("SHA-256").digest(contentBytes).toByteString(),
        )
    }

    /** Saves the content to the local client store. */
    suspend fun save(content: Content) {
        client.contents.save(buildDigest(content), Content.ADAPTER.encode(content))
    }

    /**
     * Download any blobs in the list that we don't have locally, so blobs
     * of an identity eventually persist on every device in that identity.
     * Per-blob failures are logged but absorbed (best-effort, like js-core).
     */
    suspend fun pullBlobs(blobs: List<Blob>): Unit = coroutineScope {
        val digests = blobs.mapNotNull { it.digest }
        digests.map { digest ->
            async {
                try {
                    if (client.filestore.has(digest)) return@async
                    val bytes = client.fetchBlobBytes(digest) ?: return@async
                    client.filestore.put(digest, bytes)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    log.warning("pullBlobs failed: $e")
                }
            }
        }.awaitAll()
    }
}
