use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "content")]
pub struct Model {
    // ID used on the server for relations only
    #[sea_orm(primary_key, auto_increment = true)]
    pub id: i64,

    #[sea_orm(unique_key = "digest")]
    pub digest_type: i32,

    #[sea_orm(unique_key = "digest")]
    pub digest_bytes: Vec<u8>,

    // We store the raw serialized bytes of the Content and send this back to clients
    pub serialized_bytes: Vec<u8>,

    // References to the individual content types
    #[sea_orm(has_one)]
    pub post: HasOne<super::content_post::Entity>,
    #[sea_orm(has_one)]
    pub delete: HasOne<super::content_delete::Entity>,
    #[sea_orm(has_one)]
    pub follow: HasOne<super::content_follow::Entity>,
    #[sea_orm(has_one)]
    pub block: HasOne<super::content_block::Entity>,
    #[sea_orm(has_one)]
    pub reaction: HasOne<super::content_reaction::Entity>,
    #[sea_orm(has_one)]
    pub profile_update: HasOne<super::content_profile_update::Entity>,
    #[sea_orm(has_one)]
    pub image: HasOne<super::content_image::Entity>,
    #[sea_orm(has_one)]
    pub blob: HasOne<super::content_blob::Entity>,
    #[sea_orm(has_one)]
    pub report: HasOne<super::content_report::Entity>,
    #[sea_orm(has_one)]
    pub repost: HasOne<super::content_repost::Entity>,
    #[sea_orm(has_one)]
    pub identity: HasOne<super::content_identity::Entity>,
    #[sea_orm(has_many)]
    pub labels: HasMany<super::content_label::Entity>,
    #[sea_orm(has_one)]
    pub verification_claim: HasOne<super::content_verification_claim::Entity>,
    #[sea_orm(has_many)]
    pub verification_targets:
        HasMany<super::content_verification_target::Entity>,
    #[sea_orm(has_one)]
    pub verification_verify: HasOne<super::content_verification_verify::Entity>,

    // Timestamp the server received the content
    pub synced_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
