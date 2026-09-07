package org.futo.polycentric.core

import android.content.ContentValues
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okio.ByteString.Companion.toByteString
import org.futo.polycentric.core.IEventRepository
import polycentric.v2.Event
import polycentric.v2.EventKey
import polycentric.v2.PublicKey
import polycentric.v2.SignedEvent

/**
 * Port of js-storage-sqlite `EventRepository`. Rows are keyed by the v2
 * EventKey; `public_key_bytes` is the serialized signer `PublicKey`, and
 * signature + event bytes are stored separately (recombined into a
 * `SignedEvent` on read).
 */
internal class SqlEventRepository(private val db: SQLiteDatabase) :
    IEventRepository {

    override suspend fun save(signedEvent: SignedEvent) =
        withContext(Dispatchers.IO) {
            val event = Event.ADAPTER.decode(signedEvent.event_bytes)
            val key = event.key ?: error("Event missing key")
            val signedBy = key.signed_by ?: error("Event key missing signedBy")
            val publicKeyBytes = PublicKey.ADAPTER.encode(signedBy)

            val values = ContentValues().apply {
                put("identity", key.identity)
                put("public_key_bytes", publicKeyBytes)
                put("collection", key.collection)
                put("sequence", key.sequence)
                put("signature", signedEvent.signature.toByteArray())
                put("event_bytes", signedEvent.event_bytes.toByteArray())
            }
            // Upsert (js does ON CONFLICT DO UPDATE); events are immutable
            // per key, so replace is equivalent and idempotent.
            db.insertWithOnConflict(
                "events",
                null,
                values,
                SQLiteDatabase.CONFLICT_REPLACE,
            )
            Unit
        }

    override suspend fun getAll(): List<SignedEvent> =
        withContext(Dispatchers.IO) {
            db.rawQuery(
                "SELECT signature, event_bytes FROM events",
                null,
            ).use { readSignedEvents(it) }
        }

    override suspend fun getByEventKey(key: EventKey): SignedEvent? =
        withContext(Dispatchers.IO) {
            val signedBy = key.signed_by ?: return@withContext null
            val publicKeyBytes = PublicKey.ADAPTER.encode(signedBy)
            db.rawQuery(
                """SELECT signature, event_bytes FROM events
                   WHERE identity = ?
                     AND hex(public_key_bytes) = ?
                     AND collection = ?
                     AND sequence = ?
                   LIMIT 1""",
                arrayOf(
                    key.identity,
                    publicKeyBytes.toHexUpper(),
                    key.collection.toString(),
                    key.sequence.toString(),
                ),
            ).use { readSignedEvents(it).firstOrNull() }
        }

    override suspend fun getByIdentity(
        identity: String,
        signer: PublicKey?,
        collection: Int?,
        headsOnly: Boolean,
    ): List<SignedEvent> = withContext(Dispatchers.IO) {
        // Build the shared WHERE (identity + optional signer/collection),
        // mirroring js-storage-sqlite's getByIdentity.
        val conditions = StringBuilder("identity = ?")
        val args = ArrayList<String>()
        args.add(identity)
        if (signer != null) {
            conditions.append(" AND hex(public_key_bytes) = ?")
            args.add(PublicKey.ADAPTER.encode(signer).toHexUpper())
        }
        if (collection != null) {
            conditions.append(" AND collection = ?")
            args.add(collection.toString())
        }

        val sql = if (headsOnly) {
            // Heads = highest sequence per (signer, collection). js uses a
            // ROW_NUMBER() window function; a correlated MAX() subquery is
            // the equivalent that also works on the older SQLite bundled
            // with minSdk 24.
            """SELECT signature, event_bytes FROM events e
               WHERE $conditions
                 AND e.sequence = (
                     SELECT MAX(e2.sequence) FROM events e2
                     WHERE e2.identity = e.identity
                       AND e2.public_key_bytes = e.public_key_bytes
                       AND e2.collection = e.collection
                 )"""
        } else {
            "SELECT signature, event_bytes FROM events e WHERE $conditions"
        }
        db.rawQuery(sql, args.toTypedArray()).use { readSignedEvents(it) }
    }

    private fun readSignedEvents(
        cursor: android.database.Cursor,
    ): List<SignedEvent> {
        val out = ArrayList<SignedEvent>(cursor.count)
        val sigIdx = cursor.getColumnIndexOrThrow("signature")
        val evtIdx = cursor.getColumnIndexOrThrow("event_bytes")
        while (cursor.moveToNext()) {
            out.add(
                SignedEvent(
                    signature = cursor.getBlob(sigIdx).toByteString(),
                    event_bytes = cursor.getBlob(evtIdx).toByteString(),
                ),
            )
        }
        return out
    }
}
