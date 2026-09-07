package org.futo.polycentric.core

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.futo.polycentric.core.IContentRepository
import org.futo.polycentric.core.IEventAckRepository
import org.futo.polycentric.core.IEventRepository
import org.futo.polycentric.core.IKeysRepository
import org.futo.polycentric.core.IStorageDriver
import polycentric.v2.EventKey

/**
 * SQLite-backed [IStorageDriver], a port of js-storage-sqlite's
 * `DrizzleStorageDriver`. Pair it with a filesystem
 * [org.futo.polycentric.core.IFileStoreDriver] (e.g.
 * [org.futo.polycentric.core.AndroidFileStoreDriver]) when
 * constructing a client — blobs are deliberately not kept in SQLite.
 */
class SqliteStorageDriver(
    context: Context,
    databaseName: String = "polycentric-v2.db",
) : IStorageDriver {
    private val helper = PolycentricDbHelper(context.applicationContext, databaseName)
    private val db: SQLiteDatabase get() = helper.writableDatabase

    override fun createEventRepository(): IEventRepository =
        SqlEventRepository(db)

    override fun createContentRepository(): IContentRepository =
        SqlContentRepository(db)

    override fun createKeysRepository(): IKeysRepository =
        SqlKeysRepository(db)

    // EventAcks aren't currently used (same as js-storage-sqlite).
    override fun createEventAckRepository(): IEventAckRepository =
        NoopEventAckRepository

    override suspend fun saveActiveIdentityKey(
        publicKey: ByteArray,
        identityKey: String?,
    ) = withContext(Dispatchers.IO) {
        if (identityKey == null) {
            db.execSQL(
                "DELETE FROM active_identity_for_key WHERE hex(public_key) = ?",
                arrayOf(publicKey.toHexUpper()),
            )
            return@withContext
        }
        db.insertWithOnConflict(
            "active_identity_for_key",
            null,
            ContentValues().apply {
                put("public_key", publicKey)
                put("identity_key", identityKey)
            },
            SQLiteDatabase.CONFLICT_REPLACE,
        )
        Unit
    }

    override suspend fun loadActiveIdentityKey(publicKey: ByteArray): String? =
        withContext(Dispatchers.IO) {
            db.rawQuery(
                "SELECT identity_key FROM active_identity_for_key WHERE hex(public_key) = ? LIMIT 1",
                arrayOf(publicKey.toHexUpper()),
            ).use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) {
                    cursor.getString(0)
                } else {
                    null
                }
            }
        }

    override suspend fun saveActiveSession(identityKey: String?) =
        withContext(Dispatchers.IO) {
            db.insertWithOnConflict(
                "active_session",
                null,
                ContentValues().apply {
                    put("id", 0)
                    put("identity_key", identityKey)
                },
                SQLiteDatabase.CONFLICT_REPLACE,
            )
            Unit
        }

    override suspend fun loadActiveSession(): String? =
        withContext(Dispatchers.IO) {
            db.rawQuery(
                "SELECT identity_key FROM active_session WHERE id = 0 LIMIT 1",
                null,
            ).use { cursor ->
                if (cursor.moveToFirst() && !cursor.isNull(0)) {
                    cursor.getString(0)
                } else {
                    null
                }
            }
        }

    fun close() = helper.close()
}

/** Ack tracking is unused today; mirrors js-storage-sqlite's no-op impl. */
private object NoopEventAckRepository : IEventAckRepository {
    override suspend fun recordAck(server: String, key: EventKey) {}
    override suspend fun isAcked(server: String, key: EventKey): Boolean = false
}
