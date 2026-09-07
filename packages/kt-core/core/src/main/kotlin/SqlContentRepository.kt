package org.futo.polycentric.core

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.futo.polycentric.core.IContentRepository
import polycentric.v2.ContentDigest

/**
 * Port of js-storage-sqlite `ContentRepository`. Content is addressed by
 * the serialized `ContentDigest`; bodies are stored/returned as raw bytes
 * (the caller decodes `Content` when needed).
 */
internal class SqlContentRepository(private val db: SQLiteDatabase) :
    IContentRepository {

    override suspend fun save(digest: ContentDigest, contentBytes: ByteArray) =
        withContext(Dispatchers.IO) {
            val values = ContentValues().apply {
                put("digest_bytes", ContentDigest.ADAPTER.encode(digest))
                put("content_bytes", contentBytes)
            }
            db.insertWithOnConflict(
                "content",
                null,
                values,
                SQLiteDatabase.CONFLICT_REPLACE,
            )
            Unit
        }

    override suspend fun get(digest: ContentDigest): ByteArray? =
        withContext(Dispatchers.IO) {
            db.rawQuery(
                "SELECT content_bytes FROM content WHERE hex(digest_bytes) = ? LIMIT 1",
                arrayOf(ContentDigest.ADAPTER.encode(digest).toHexUpper()),
            ).use { cursor ->
                if (cursor.moveToFirst()) cursor.getBlob(0) else null
            }
        }

    override suspend fun getAll(): List<Pair<ContentDigest, ByteArray>> =
        withContext(Dispatchers.IO) {
            db.rawQuery(
                "SELECT digest_bytes, content_bytes FROM content",
                null,
            ).use { cursor ->
                val out =
                    ArrayList<Pair<ContentDigest, ByteArray>>(cursor.count)
                while (cursor.moveToNext()) {
                    out.add(
                        ContentDigest.ADAPTER.decode(cursor.getBlob(0)) to
                            cursor.getBlob(1),
                    )
                }
                out
            }
        }
}
