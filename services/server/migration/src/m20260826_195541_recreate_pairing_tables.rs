//! Recreates the pairing tables for the redesigned pairing protocol.
//! Existing pairing sessions are deleted by this migration.

use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260826_195541_recreate_pairing_tables"
    }
}

const SESSION: &str = "pairing_session";
const CLAIMER: &str = "pairing_session_claimer";
const OLD_SESSION: &str = "pair_identity_session";
const OLD_CLAIMER: &str = "pair_identity_session_claimer";

const DIGEST_INDEX: &str = "pairing_session_digest_sha256_idx";
const CLAIMER_IDENTITY_INDEX: &str =
    "pairing_session_claimer_issuer_identity_idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Delete any tables from the original pairing tables migration
        manager
            .drop_table(drop_tables([
                OLD_CLAIMER,
                OLD_SESSION,
                CLAIMER,
                SESSION,
            ]))
            .await?;

        let mut session = Table::create();
        session
            .table(Alias::new(SESSION))
            .if_not_exists()
            .col(string(Alias::new("issuer_identity")).primary_key())
            .col(binary(Alias::new("digest_sha256")))
            .col(binary(Alias::new("issuer_state_bytes")))
            .col(binary(Alias::new("issuer_state_signature")))
            .col(timestamp_with_time_zone(Alias::new("initial_timestamp")))
            .col(big_integer(Alias::new("sequence")));

        manager.create_table(session.to_owned()).await?;

        // We need to be able to look up pairing sessions by digest hash
        // efficiently.
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .unique()
                    .name(DIGEST_INDEX)
                    .table(Alias::new(SESSION))
                    .col(Alias::new("digest_sha256"))
                    .to_owned(),
            )
            .await?;

        let mut claimer = Table::create();
        claimer
            .table(Alias::new(CLAIMER))
            .if_not_exists()
            .col(binary(Alias::new("digest_sha256")))
            .col(integer(Alias::new("claimer_key_type")))
            .col(binary(Alias::new("claimer_key")))
            .col(string(Alias::new("issuer_identity")))
            .primary_key(
                Index::create()
                    .col(Alias::new("digest_sha256"))
                    .col(Alias::new("claimer_key_type"))
                    .col(Alias::new("claimer_key")),
            );

        manager.create_table(claimer.to_owned()).await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name(CLAIMER_IDENTITY_INDEX)
                    .table(Alias::new(CLAIMER))
                    .col(Alias::new("issuer_identity"))
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_table(drop_tables([CLAIMER, SESSION])).await?;

        Ok(())
    }
}

/// Builds a statement dropping each named table
fn drop_tables<'a>(
    tables: impl IntoIterator<Item = &'a str>,
) -> TableDropStatement {
    let mut statement = Table::drop();
    statement.if_exists();

    for table in tables {
        statement.table(Alias::new(table));
    }

    statement
}
