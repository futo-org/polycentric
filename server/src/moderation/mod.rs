use crate::model::moderation_tag::ModerationTagName;

pub mod moderation_queue;
pub mod providers;

#[derive(::sqlx::Type)]
#[sqlx(type_name = "moderation_filter_type")]
#[derive(::serde::Deserialize, ::serde::Serialize, Debug, Clone)]
pub(crate) struct ModerationFilter {
    tag: ModerationTagName,
    max_level: i16,
    strict_mode: bool,
}

impl sqlx::postgres::PgHasArrayType for ModerationFilter {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        sqlx::postgres::PgTypeInfo::with_name("_moderation_filter_type")
    }
}

#[derive(::serde::Deserialize, Clone)]
pub(crate) struct ModerationOptions(Vec<ModerationFilter>);

// We don't want to implement `sqlx::Type<T>` for `ModerationOptions` because it's not a valid SQL type.
// Rather, have it inherit all needed traits from `Vec<ModerationFilter>` so that we can use it in queries.
impl<T: sqlx::Database> sqlx::Type<T> for ModerationOptions
where
    Vec<ModerationFilter>: sqlx::Type<T>,
{
    fn type_info() -> T::TypeInfo {
        <Vec<ModerationFilter> as sqlx::Type<T>>::type_info()
    }
}

impl<'q, T: sqlx::Database> sqlx::Encode<'q, T> for ModerationOptions
where
    Vec<ModerationFilter>: sqlx::Encode<'q, T>,
{
    fn encode_by_ref(
        &self,
        buf: &mut <T as sqlx::database::HasArguments<'q>>::ArgumentBuffer,
    ) -> sqlx::encode::IsNull {
        self.0.encode_by_ref(buf) // Delegate encoding to the inner Vec
    }
}

impl Default for ModerationOptions {
    fn default() -> Self {
        ModerationOptions(vec![
            ModerationFilter {
                tag: ModerationTagName::new(String::from("violence")),
                max_level: 1,
                strict_mode: true,
            },
            ModerationFilter {
                tag: ModerationTagName::new(String::from("hate")),
                max_level: 1,
                strict_mode: true,
            },
            ModerationFilter {
                tag: ModerationTagName::new(String::from("self-harm")),
                max_level: 1,
                strict_mode: true,
            },
            ModerationFilter {
                tag: ModerationTagName::new(String::from("sexual")),
                max_level: 1,
                strict_mode: true,
            },
        ])
    }
}

impl ModerationOptions {
    pub fn empty() -> Self {
        ModerationOptions(vec![])
    }
}
