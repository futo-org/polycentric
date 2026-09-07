package org.futo.polycentric.core

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Creates and versions the SQLite database backing the v2 storage driver.
 * Schema lives in [SqliteSchema]; future changes bump `SqliteSchema.VERSION`
 * and add branches to [onUpgrade].
 */
class PolycentricDbHelper(
    context: Context,
    name: String = "polycentric-v2.db",
) : SQLiteOpenHelper(context, name, null, SqliteSchema.VERSION) {

    override fun onConfigure(db: SQLiteDatabase) {
        // Enforce the FK/CHECK constraints declared in the schema.
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.beginTransaction()
        try {
            for (table in SqliteSchema.tables) db.execSQL(table)
            for (index in SqliteSchema.indexes) db.execSQL(index)
            db.insert(
                "schema_version",
                null,
                ContentValues().apply {
                    put("version", SqliteSchema.VERSION)
                    put("upgraded_on", "onCreate")
                },
            )
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            // Split "active session" out from the per-key identity binding so
            // logout can persist without forgetting the identity.
            db.execSQL(
                """CREATE TABLE IF NOT EXISTS active_session (
                    id INTEGER PRIMARY KEY CHECK (id = 0),
                    identity_key TEXT
                )""",
            )
            // Preserve existing sign-in: seed the session from the current
            // binding so an upgrading user isn't silently logged out.
            db.execSQL(
                "INSERT OR IGNORE INTO active_session (id, identity_key) " +
                    "SELECT 0, identity_key FROM active_identity_for_key " +
                    "WHERE identity_key IS NOT NULL LIMIT 1",
            )
        }
    }
}
