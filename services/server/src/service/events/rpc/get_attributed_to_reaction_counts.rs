use crate::service::context::ServiceContext;
use crate::service::proto::{
    GetAttributedToReactionCountsRequest,
    GetAttributedToReactionCountsResponse, attributed_to::To,
};
use crate::service::stats::repository::Mutation;
use tonic::Status;

/// Return the maintained upvote/downvote counts for an out-of-network target
/// (e.g. a video URL). Counts are kept up to date by the stats worker in
/// `attributed_to_reaction_summaries`; this just reads them.
pub async fn handle(
    ctx: &ServiceContext,
    req: GetAttributedToReactionCountsRequest,
) -> Result<GetAttributedToReactionCountsResponse, Status> {
    let url = match req.attributed_to.and_then(|a| a.to) {
        Some(To::Link(link)) => link.url,
        _ => {
            return Err(Status::invalid_argument(
                "attributed_to link url is required",
            ));
        }
    };

    let (upvote_count, downvote_count) =
        Mutation::get_attributed_reaction_summary(&ctx.ro_db, &url)
            .await
            .map_err(|_| Status::internal("internal server error"))?;

    Ok(GetAttributedToReactionCountsResponse {
        upvote_count,
        downvote_count,
    })
}
