use super::deconstruct_event_key;
use crate::service::proto::{Post, attributed_to::To};
use entity::{content_post, content_post_attributed_url};
use sea_orm::DbErr;
use sea_orm::sea_query::{
    CommonTableExpression, DynIden, Expr, InsertStatement, OnConflict,
    SelectStatement, WithClause,
};

pub(super) fn add_query(
    with: &mut WithClause,
    post: Post,
    content_id: (DynIden, DynIden),
) -> Result<InsertStatement, DbErr> {
    let Post {
        text,
        reply,
        images: _,
        quote,
        links: _,
        labels: _,
        attributed_to,
    } = post;
    let (reply_root, reply_parent) = match reply {
        Some(reply) => (
            deconstruct_event_key(reply.root),
            deconstruct_event_key(reply.parent),
        ),
        None => (deconstruct_event_key(None), deconstruct_event_key(None)),
    };
    let quote = deconstruct_event_key(quote);

    let mut query = InsertStatement::new();
    query
        .into_table(content_post::Entity)
        .columns([
            content_post::Column::ContentId,
            content_post::Column::Text,
            content_post::Column::ReplyRootCollection,
            content_post::Column::ReplyRootIdentity,
            content_post::Column::ReplyRootPublicKeyType,
            content_post::Column::ReplyRootPublicKey,
            content_post::Column::ReplyRootSequence,
            content_post::Column::ReplyParentCollection,
            content_post::Column::ReplyParentIdentity,
            content_post::Column::ReplyParentPublicKeyType,
            content_post::Column::ReplyParentPublicKey,
            content_post::Column::ReplyParentSequence,
            content_post::Column::QuoteCollection,
            content_post::Column::QuoteIdentity,
            content_post::Column::QuotePublicKeyType,
            content_post::Column::QuotePublicKey,
            content_post::Column::QuoteSequence,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .expr(Expr::col(content_id.clone()))
                .expr(Expr::from(text))
                .expr(Expr::from(reply_root.collection))
                .expr(Expr::from(reply_root.identity))
                .expr(Expr::from(reply_root.public_key_type))
                .expr(Expr::from(reply_root.public_key))
                .expr(Expr::from(reply_root.sequence))
                .expr(Expr::from(reply_parent.collection))
                .expr(Expr::from(reply_parent.identity))
                .expr(Expr::from(reply_parent.public_key_type))
                .expr(Expr::from(reply_parent.public_key))
                .expr(Expr::from(reply_parent.sequence))
                .expr(Expr::from(quote.collection))
                .expr(Expr::from(quote.identity))
                .expr(Expr::from(quote.public_key_type))
                .expr(Expr::from(quote.public_key))
                .expr(Expr::from(quote.sequence));
            q
        })
        .map_err(|err| {
            DbErr::Custom(format!("incorrect amount of values: {err}"))
        })?;

    if attributed_to.is_empty() {
        // SeaORM gets unhappy when we don't have any values to pass.
        return Ok(query);
    }

    const POST_ATTRIBUTED_TO_LINK: &str = "post_attributed_to_links";
    let mut post_attributed_to_links = SelectStatement::new();
    post_attributed_to_links
        .expr_as(Expr::col(("values", "column1")), "url")
        .from_values(
            attributed_to.into_iter().filter_map(|attributed_to| {
                let Some(To::Link(link)) = attributed_to.to else {
                    return None;
                };
                if link.url.is_empty() {
                    return None;
                }
                Some(link.url)
            }),
            "values",
        );
    let mut cte = CommonTableExpression::new();
    cte.table_name(POST_ATTRIBUTED_TO_LINK)
        .query(post_attributed_to_links);
    with.cte(cte);

    // Index each URL the post is attributed to so GetAttributionFeed can
    // find it. The (content_id, url) primary key makes a given
    // attribution unique per post, so a repeated URL just no-ops on
    // conflict rather than failing the ingest. Empty URLs are skipped.
    let mut post_attributed_to = InsertStatement::new();
    post_attributed_to
        .into_table(content_post_attributed_url::Entity)
        .columns([
            content_post_attributed_url::Column::ContentId,
            content_post_attributed_url::Column::Url,
        ])
        .select_from({
            let mut q = SelectStatement::new();
            q.from(content_id.0.clone())
                .from(POST_ATTRIBUTED_TO_LINK)
                .expr(Expr::col(content_id))
                .expr(Expr::col((POST_ATTRIBUTED_TO_LINK, "url")));
            q
        })
        .map_err(|err| {
            DbErr::Custom(format!("incorrect amount of values: {err}"))
        })?
        .on_conflict({
            let mut c = OnConflict::columns([
                content_post_attributed_url::Column::ContentId,
                content_post_attributed_url::Column::Url,
            ]);
            c.do_nothing();
            c
        });
    let mut cte = CommonTableExpression::new();
    cte.table_name("post_attributed_to")
        .query(post_attributed_to);
    with.cte(cte);

    Ok(query)
}
