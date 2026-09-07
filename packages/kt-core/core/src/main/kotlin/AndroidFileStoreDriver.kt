package org.futo.polycentric.core

import java.io.File
import java.security.SecureRandom
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.futo.polycentric.core.IFileStoreDriver
import polycentric.v2.ContentDigest

/**
 * Filesystem-backed [IFileStoreDriver], a port of js-node's
 * `NodeFileStoreDriver`. One file per digest under [directory], named
 * `{type}_{hex(value)}` to match the CDN `/blob/` URL convention. Writes
 * are atomic (temp file + rename).
 *
 * Pass an app-private directory, e.g. `File(context.filesDir, "blobs")`.
 */
class AndroidFileStoreDriver(private val directory: File) : IFileStoreDriver {

    init {
        directory.mkdirs()
    }

    private fun pathFor(digest: ContentDigest): File =
        File(directory, "${digest.type.value}_${digest.value_.hex()}")

    override suspend fun has(digest: ContentDigest): Boolean =
        withContext(Dispatchers.IO) { pathFor(digest).exists() }

    override suspend fun get(digest: ContentDigest): ByteArray? =
        withContext(Dispatchers.IO) {
            val file = pathFor(digest)
            if (file.exists()) file.readBytes() else null
        }

    override suspend fun put(digest: ContentDigest, bytes: ByteArray): Unit =
        withContext(Dispatchers.IO) {
            val final = pathFor(digest)
            val suffix = ByteArray(8).also { SecureRandom().nextBytes(it) }
                .joinToString("") { "%02x".format(it) }
            val tmp = File(directory, "${final.name}.tmp.$suffix")
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(final)) {
                tmp.delete()
                error("Failed to move blob into place: ${final.name}")
            }
        }

    override suspend fun delete(digest: ContentDigest): Unit =
        withContext(Dispatchers.IO) {
            pathFor(digest).delete()
            Unit
        }
}
