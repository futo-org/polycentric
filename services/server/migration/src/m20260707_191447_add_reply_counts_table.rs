use crate::old_entity::reply_count_model;
use ::entity::{
    content_delete_model, content_model, content_post_model, event_model,
};
use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260707_191447_add_reply_counts_table"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_table("reply_counts").await? {
            return Ok(());
        }

        let mut reply_counts = Table::create();
        reply_counts
            .table(Alias::new("reply_counts"))
            .if_not_exists()
            // The event key of the post whose replies we're counting:
            .col(small_integer(Alias::new("event_key_collection")))
            .col(string(Alias::new("event_key_identity")))
            .col(small_integer(Alias::new("event_key_public_key_type")))
            .col(binary(Alias::new("event_key_public_key")))
            .col(big_integer(Alias::new("event_key_sequence")))
            // Our estimated reply count:
            .col(big_integer(Alias::new("reply_count")).default(0))
            // Use the event key as the primary key for this table:
            .primary_key(
                Index::create()
                    .col(Alias::new("event_key_collection"))
                    .col(Alias::new("event_key_identity"))
                    .col(Alias::new("event_key_public_key_type"))
                    .col(Alias::new("event_key_public_key"))
                    .col(Alias::new("event_key_sequence")),
            );

        manager.create_table(reply_counts.to_owned()).await?;

        // Count pre-existing replies in the reply counts
        backfill_reply_counts(manager).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(Alias::new("reply_counts"))
                    .to_owned(),
            )
            .await
    }
}

/// Fill in reply counts table for existing events.
/// Events with no replies are not given a row.
async fn backfill_reply_counts(
    manager: &SchemaManager<'_>,
) -> Result<(), DbErr> {
    manager
        .get_connection()
        .execute(&backfill_reply_counts_stmt())
        .await?;
    Ok(())
}

fn backfill_reply_counts_stmt() -> InsertStatement {
    use content_delete_model::Column as Cd;
    use content_model::Column as C;
    use content_post_model::Column as Cp;
    use event_model::Column as E;

    // --- Table aliases ---
    let rp = "rp"; // reply post content body
    let rc = "rc"; // reply content row
    let re = "re"; // reply event
    let dd = "dd"; // deletion content body
    let dc = "dc"; // deletion content row
    let de = "de"; // deletion event

    // Subquery for checking whether a reply event `re` has been deleted.
    // It checks whether a deletion event by the author of the reply exists.
    // However, it does not handle revocations.
    // A reply should only be counted if this query does not find anything.
    let reply_is_deleted = Query::select()
        .expr(Expr::val(1))
        // Join from content delete -> content -> event
        .from_as(content_delete_model::Entity, dd)
        .join_as(
            JoinType::InnerJoin,
            content_model::Entity,
            dc,
            eq(dc, C::Id, dd, Cd::ContentId),
        )
        .join_as(
            JoinType::InnerJoin,
            event_model::Entity,
            de,
            Condition::all()
                .add(eq(de, E::ContentDigestType, dc, C::DigestType))
                .add(eq(de, E::ContentDigestBytes, dc, C::DigestBytes)),
        )
        // Keep only relevant deletions
        .cond_where(
            Condition::all()
                // Deletion target matches reply event
                .add(eq(dd, Cd::EventKeyCollection, re, E::Collection))
                .add(eq(dd, Cd::EventKeyIdentity, re, E::Identity))
                .add(eq(dd, Cd::EventKeyPublicKeyType, re, E::PublicKeyType))
                .add(eq(dd, Cd::EventKeyPublicKey, re, E::PublicKey))
                .add(eq(dd, Cd::EventKeySequence, re, E::Sequence))
                // Deletion event has the same author as the reply
                .add(eq(de, E::Identity, re, E::Identity)),
        )
        .to_owned();

    let reply_key_cols = [
        (rp, Cp::ReplyParentCollection),
        (rp, Cp::ReplyParentIdentity),
        (rp, Cp::ReplyParentPublicKeyType),
        (rp, Cp::ReplyParentPublicKey),
        (rp, Cp::ReplyParentSequence),
    ];

    // Select query to derive reply count rows to insert.
    let select = Query::select()
        // Select columns corresponding to the reply counts table
        .columns(reply_key_cols)
        .expr(Func::count(Expr::col((re, E::Id))))
        // For each post content with a parent, find the corresponding events.
        // Join from content post -> content -> event.
        .from_as(content_post_model::Entity, rp)
        .join_as(
            JoinType::InnerJoin,
            content_model::Entity,
            rc,
            eq(rc, C::Id, rp, Cp::ContentId),
        )
        .join_as(
            JoinType::InnerJoin,
            event_model::Entity,
            re,
            Condition::all()
                .add(eq(re, E::ContentDigestType, rc, C::DigestType))
                .add(eq(re, E::ContentDigestBytes, rc, C::DigestBytes))
                // Filter out deleted events
                .add(Expr::not_exists(reply_is_deleted)),
        )
        // Filter out post content rows that don't have parents
        .cond_where(
            reply_key_cols
                .into_iter()
                .fold(Condition::all(), |cond, col| {
                    cond.add(Expr::col(col).is_not_null())
                }),
        )
        // Group by parent keys
        .group_by_columns(reply_key_cols)
        .to_owned();

    // Build the final insertion statement
    Query::insert()
        .into_table(reply_count_model::Entity)
        .columns([
            reply_count_model::Column::EventKeyCollection,
            reply_count_model::Column::EventKeyIdentity,
            reply_count_model::Column::EventKeyPublicKeyType,
            reply_count_model::Column::EventKeyPublicKey,
            reply_count_model::Column::EventKeySequence,
            reply_count_model::Column::ReplyCount,
        ])
        .select_from(select)
        .expect("insert column count matches the select's column count")
        .to_owned()
}

/// Helper function for equality condition expressions `alias_a.col = alias_b.col`.
fn eq(
    a: &'static str,
    a_col: impl IntoIden,
    b: &'static str,
    b_col: impl IntoIden,
) -> Expr {
    Expr::col((a, a_col)).equals((b, b_col))
}
