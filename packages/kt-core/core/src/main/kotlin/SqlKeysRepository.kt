package org.futo.polycentric.core

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.futo.polycentric.core.IKeysRepository
import org.futo.polycentric.core.StoredKeyPair

/**
 * Port of js-storage-sqlite `KeysRepository`. Keyed by the raw public-key
 * bytes; stores key type and the private key alongside.
 */
internal class SqlKeysRepository(private val db: SQLiteDatabase) :
    IKeysRepository {

    override suspend fun save(
        publicKey: ByteArray,
        keyType: Int,
        privateKey: ByteArray,
    ) = withContext(Dispatchers.IO) {
        val values = ContentValues().apply {
            put("public_key", publicKey)
            put("key_type", keyType)
            put("private_key", privateKey)
        }
        db.insertWithOnConflict(
            "keys",
            null,
            values,
            SQLiteDatabase.CONFLICT_REPLACE,
        )
        Unit
    }

    override suspend fun getByPublicKey(publicKey: ByteArray): StoredKeyPair? =
        withContext(Dispatchers.IO) {
            db.rawQuery(
                "SELECT key_type, private_key FROM keys WHERE hex(public_key) = ? LIMIT 1",
                arrayOf(publicKey.toHexUpper()),
            ).use { cursor ->
                if (!cursor.moveToFirst()) return@withContext null
                StoredKeyPair(
                    keyType = cursor.getInt(0),
                    publicKey = publicKey,
                    privateKey = cursor.getBlob(1),
                )
            }
        }

    override suspend fun getAll(): List<StoredKeyPair> =
        withContext(Dispatchers.IO) {
            db.rawQuery(
                "SELECT key_type, public_key, private_key FROM keys",
                null,
            ).use { cursor ->
                val out = ArrayList<StoredKeyPair>(cursor.count)
                while (cursor.moveToNext()) {
                    out.add(
                        StoredKeyPair(
                            keyType = cursor.getInt(0),
                            publicKey = cursor.getBlob(1),
                            privateKey = cursor.getBlob(2),
                        ),
                    )
                }
                out
            }
        }

    override suspend fun delete(publicKey: ByteArray) =
        withContext(Dispatchers.IO) {
            db.execSQL(
                "DELETE FROM keys WHERE hex(public_key) = ?",
                arrayOf(publicKey.toHexUpper()),
            )
        }
}
