use crate::old_entity::{reaction_summary_model, reaction_tally_model};
use ::entity::{
    content_delete_model, content_model, content_reaction_model, event_model,
};
use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260720_164457_add_reaction_counters"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let summaries_existed = manager.has_table("reaction_summaries").await?;
        let tallies_existed = manager.has_table("reaction_tallies").await?;

        // Create summaries table for overall reaction counters
        if !summaries_existed {
            let mut summaries = Table::create();
            summaries
                .table(Alias::new("reaction_summaries"))
                .if_not_exists()
                // The event key of the event whose reactions we're counting:
                .col(small_integer(Alias::new("event_key_collection")))
                .col(string(Alias::new("event_key_identity")))
                .col(small_integer(Alias::new("event_key_public_key_type")))
                .col(binary(Alias::new("event_key_public_key")))
                .col(big_integer(Alias::new("event_key_sequence")))
                // Our estimated positive/negative reaction counts:
                .col(big_integer(Alias::new("upvote_count")).default(0))
                .col(big_integer(Alias::new("downvote_count")).default(0))
                // Use the event key as the primary key for this table:
                .primary_key(
                    Index::create()
                        .col(Alias::new("event_key_collection"))
                        .col(Alias::new("event_key_identity"))
                        .col(Alias::new("event_key_public_key_type"))
                        .col(Alias::new("event_key_public_key"))
                        .col(Alias::new("event_key_sequence")),
                );

            manager.create_table(summaries.to_owned()).await?;
        }

        // Create tallies table for counting specific reactions
        if !tallies_existed {
            let mut tallies = Table::create();
            tallies
                .table(Alias::new("reaction_tallies"))
                .if_not_exists()
                // The event key of the event whose reactions we're counting:
                .col(small_integer(Alias::new("event_key_collection")))
                .col(string(Alias::new("event_key_identity")))
                .col(small_integer(Alias::new("event_key_public_key_type")))
                .col(binary(Alias::new("event_key_public_key")))
                .col(big_integer(Alias::new("event_key_sequence")))
                // The reaction's emoji and opinion:
                .col(string(Alias::new("emoji")))
                .col(boolean(Alias::new("positive")))
                // Our estimated count for this (emoji, positive) reaction:
                .col(big_integer(Alias::new("count")).default(0))
                // Use the event key + reaction as the primary key:
                .primary_key(
                    Index::create()
                        .col(Alias::new("event_key_collection"))
                        .col(Alias::new("event_key_identity"))
                        .col(Alias::new("event_key_public_key_type"))
                        .col(Alias::new("event_key_public_key"))
                        .col(Alias::new("event_key_sequence"))
                        .col(Alias::new("emoji"))
                        .col(Alias::new("positive")),
                );

            manager.create_table(tallies.to_owned()).await?;

            // Index for fetching the most popular reactions for an event.
            // Includes the target event key columns and then count.
            manager
                .create_index(
                    Index::create()
                        .if_not_exists()
                        .name("reaction_tallies_event_key_count_idx")
                        .table(reaction_tally_model::Entity)
                        .col(reaction_tally_model::Column::EventKeyCollection)
                        .col(reaction_tally_model::Column::EventKeyIdentity)
                        .col(
                            reaction_tally_model::Column::EventKeyPublicKeyType,
                        )
                        .col(reaction_tally_model::Column::EventKeyPublicKey)
                        .col(reaction_tally_model::Column::EventKeySequence)
                        .col(reaction_tally_model::Column::Count)
                        .to_owned(),
                )
                .await?;
        }

        // --- Backfill reaction counter data ---
        let db = manager.get_connection();

        if !summaries_existed {
            // Backfill upvote and downvote counts
            db.execute(&backfill_summaries_stmt(true)).await?;
            db.execute(&backfill_summaries_stmt(false)).await?;
        }

        if !tallies_existed {
            // Backfill specific reaction tallies
            db.execute(&backfill_tallies_stmt()).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(Alias::new("reaction_tallies"))
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .if_exists()
                    .table(Alias::new("reaction_summaries"))
                    .to_owned(),
            )
            .await
    }
}

// --- Table aliases used throughout the backfill queries ---
const CR: &str = "cr"; // reaction content body (content_reaction)
const CRC: &str = "crc"; // reaction content row
const CRE: &str = "cre"; // reaction event
const DD: &str = "dd"; // deletion content body
const DC: &str = "dc"; // deletion content row
const DE: &str = "de"; // deletion event

// A competing reaction (to compare against when filtering superseded reactions)
const CR2: &str = "cr2"; // competing reaction content body
const CRC2: &str = "crc2"; // competing reaction content row
const CRE2: &str = "cre2"; // competing reaction event

/// Select statement for reaction events that should be counted.
/// These events have reactions that are:
/// - not deleted
/// - not superseded by a later reaction from the same identity
fn reaction_events_select() -> SelectStatement {
    use content_model::Column as C;
    use content_reaction_model::Column as Cr;

    Query::select()
        // Join from reaction content -> content -> event
        .from_as(content_reaction_model::Entity, CR)
        .join_as(
            JoinType::InnerJoin,
            content_model::Entity,
            CRC,
            eq(CRC, C::Id, CR, Cr::ContentId),
        )
        .join_as(
            JoinType::InnerJoin,
            event_model::Entity,
            CRE,
            event_matches_content(CRE, CRC)
                // Filter out deleted reactions
                .add(Expr::not_exists(deletion_for(CRE)))
                // Keep only each identity's latest reaction per target
                .add(Expr::not_exists(newer_reaction())),
        )
        .to_owned()
}

/// Subquery for checking whether the reaction event aliased `reaction` has been
/// deleted.
/// It checks whether a deletion event by the author of the reaction exists.
/// However, it does not handle revocations.
/// A reaction should only be counted if this query does not find anything.
fn deletion_for(reaction: &'static str) -> SelectStatement {
    use content_delete_model::Column as Cd;
    use content_model::Column as C;
    use event_model::Column as E;

    Query::select()
        .expr(Expr::val(1))
        // Join from content delete -> content -> event
        .from_as(content_delete_model::Entity, DD)
        .join_as(
            JoinType::InnerJoin,
            content_model::Entity,
            DC,
            eq(DC, C::Id, DD, Cd::ContentId),
        )
        .join_as(
            JoinType::InnerJoin,
            event_model::Entity,
            DE,
            event_matches_content(DE, DC),
        )
        // Keep only relevant deletions
        .cond_where(
            Condition::all()
                // Deletion target matches the reaction event
                .add(eq(DD, Cd::EventKeyCollection, reaction, E::Collection))
                .add(eq(DD, Cd::EventKeyIdentity, reaction, E::Identity))
                .add(eq(
                    DD,
                    Cd::EventKeyPublicKeyType,
                    reaction,
                    E::PublicKeyType,
                ))
                .add(eq(DD, Cd::EventKeyPublicKey, reaction, E::PublicKey))
                .add(eq(DD, Cd::EventKeySequence, reaction, E::Sequence))
                // Deletion event has the same author as the reaction
                .add(eq(DE, E::Identity, reaction, E::Identity)),
        )
        .to_owned()
}

/// Subquery detecting a newer, non-deleted reaction from the same identity
/// to the same target event as the reaction event being counted.
/// A reaction should only be counted if this query does not find anything.
fn newer_reaction() -> SelectStatement {
    use content_model::Column as C;
    use content_reaction_model::Column as Cr;
    use event_model::Column as E;

    Query::select()
        .expr(Expr::val(1))
        // Join from the competing reaction content -> content -> event
        .from_as(content_reaction_model::Entity, CR2)
        .join_as(
            JoinType::InnerJoin,
            content_model::Entity,
            CRC2,
            eq(CRC2, C::Id, CR2, Cr::ContentId),
        )
        .join_as(
            JoinType::InnerJoin,
            event_model::Entity,
            CRE2,
            event_matches_content(CRE2, CRC2)
                // Filter out deleted reactions
                .add(Expr::not_exists(deletion_for(CRE2))),
        )
        .cond_where(
            Condition::all()
                // Same target event key:
                .add(eq(
                    CR2,
                    Cr::EventKeyCollection,
                    CR,
                    Cr::EventKeyCollection,
                ))
                .add(eq(CR2, Cr::EventKeyIdentity, CR, Cr::EventKeyIdentity))
                .add(eq(
                    CR2,
                    Cr::EventKeyPublicKeyType,
                    CR,
                    Cr::EventKeyPublicKeyType,
                ))
                .add(eq(CR2, Cr::EventKeyPublicKey, CR, Cr::EventKeyPublicKey))
                .add(eq(CR2, Cr::EventKeySequence, CR, Cr::EventKeySequence))
                // Same identity created both events:
                .add(eq(CRE2, E::Identity, CRE, E::Identity))
                // Newer according to (created_at, id):
                .add(
                    Condition::any()
                        .add(
                            Expr::col((CRE2, E::CreatedAt))
                                .gt(Expr::col((CRE, E::CreatedAt))),
                        )
                        .add(
                            Condition::all()
                                .add(eq(CRE2, E::CreatedAt, CRE, E::CreatedAt))
                                .add(
                                    Expr::col((CRE2, E::Id))
                                        .gt(Expr::col((CRE, E::Id))),
                                ),
                        ),
                ),
        )
        .to_owned()
}

/// Insert statement for backfilling reaction summary data for a given value
/// of `positive`.
/// The caller should run the query for inserting upvote counts first and
/// then run the query for inserting downvote counts.
fn backfill_summaries_stmt(positive: bool) -> InsertStatement {
    use content_reaction_model::Column as Cr;
    use event_model::Column as E;
    use reaction_summary_model::Column as Rs;

    let reaction_target_cols = [
        (CR, Cr::EventKeyCollection),
        (CR, Cr::EventKeyIdentity),
        (CR, Cr::EventKeyPublicKeyType),
        (CR, Cr::EventKeyPublicKey),
        (CR, Cr::EventKeySequence),
    ];

    // Select statement for the rows to insert
    let select = reaction_events_select()
        .columns(reaction_target_cols)
        .expr(Func::count(Expr::col((CRE, E::Id))))
        .cond_where(Expr::col((CR, Cr::Positive)).eq(positive))
        .group_by_columns(reaction_target_cols)
        .to_owned();

    let key_cols = [
        Rs::EventKeyCollection,
        Rs::EventKeyIdentity,
        Rs::EventKeyPublicKeyType,
        Rs::EventKeyPublicKey,
        Rs::EventKeySequence,
    ];

    let count_col = if positive {
        Rs::UpvoteCount
    } else {
        Rs::DownvoteCount
    };

    let mut insert = Query::insert();

    insert
        .into_table(reaction_summary_model::Entity)
        .columns(key_cols.iter().copied().chain([count_col]))
        .select_from(select)
        .expect("insert column count matches the select's column count");

    // We do the upvote pass first, and then the downvote pass can conflict.
    // The conflict target is the primary key (the event key columns); when a
    // row already exists we update only the downvote count:
    if !positive {
        insert.on_conflict(
            OnConflict::columns(key_cols)
                .update_column(Rs::DownvoteCount)
                .to_owned(),
        );
    }

    insert
}

/// Insert statement for backfilling reaction tallies.
fn backfill_tallies_stmt() -> InsertStatement {
    use content_reaction_model::Column as Cr;
    use event_model::Column as E;
    use reaction_tally_model::Column as Rt;

    let group_cols = [
        // Target event:
        (CR, Cr::EventKeyCollection),
        (CR, Cr::EventKeyIdentity),
        (CR, Cr::EventKeyPublicKeyType),
        (CR, Cr::EventKeyPublicKey),
        (CR, Cr::EventKeySequence),
        // Reaction:
        (CR, Cr::Emoji),
        (CR, Cr::Positive),
    ];

    let select = reaction_events_select()
        .columns(group_cols)
        .expr(Func::count(Expr::col((CRE, E::Id))))
        .cond_where(Expr::col((CR, Cr::Emoji)).is_not_null())
        .group_by_columns(group_cols)
        .to_owned();

    Query::insert()
        .into_table(reaction_tally_model::Entity)
        .columns([
            Rt::EventKeyCollection,
            Rt::EventKeyIdentity,
            Rt::EventKeyPublicKeyType,
            Rt::EventKeyPublicKey,
            Rt::EventKeySequence,
            Rt::Emoji,
            Rt::Positive,
            Rt::Count,
        ])
        .select_from(select)
        .expect("insert column count matches the select's column count")
        .to_owned()
}

/// Join condition where `event` has a content digest that matches `content`.
fn event_matches_content(
    event: &'static str,
    content: &'static str,
) -> Condition {
    use content_model::Column as C;
    use event_model::Column as E;

    Condition::all()
        .add(eq(event, E::ContentDigestType, content, C::DigestType))
        .add(eq(event, E::ContentDigestBytes, content, C::DigestBytes))
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
