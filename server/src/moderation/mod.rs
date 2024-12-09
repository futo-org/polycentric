use crate::{config::ModerationMode, model::moderation_tag::ModerationTagName};

pub mod moderation_queue;
pub mod providers;

#[derive(::sqlx::Type)]
#[sqlx(type_name = "moderation_filter_type")]
#[derive(::serde::Deserialize, ::serde::Serialize, Debug, Clone)]
pub(crate) struct ModerationFilter {
    name: ModerationTagName,
    max_level: i16,
    strict_mode: bool,
}

impl sqlx::postgres::PgHasArrayType for ModerationFilter {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        sqlx::postgres::PgTypeInfo::with_name("_moderation_filter_type")
    }
}

#[derive(::serde::Deserialize, Clone, Debug)]
pub(crate) struct ModerationFilters(Vec<ModerationFilter>);

// We don't want to implement `sqlx::Type<T>` for `ModerationFilters` because it's not a valid SQL type.
// Rather, have it inherit all needed traits from `Vec<ModerationFilter>` so that we can use it in queries.
impl<T: sqlx::Database> sqlx::Type<T> for ModerationFilters
where
    Vec<ModerationFilter>: sqlx::Type<T>,
{
    fn type_info() -> T::TypeInfo {
        <Vec<ModerationFilter> as sqlx::Type<T>>::type_info()
    }
}

impl<'q, T: sqlx::Database> sqlx::Encode<'q, T> for ModerationFilters
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

impl Default for ModerationFilters {
    fn default() -> Self {
        ModerationFilters(vec![
            ModerationFilter {
                name: ModerationTagName::new(String::from("violence")),
                max_level: 1,
                strict_mode: true,
            },
            ModerationFilter {
                name: ModerationTagName::new(String::from("hate")),
                max_level: 1,
                strict_mode: true,
            },
            ModerationFilter {
                name: ModerationTagName::new(String::from("self_harm")),
                max_level: 1,
                strict_mode: true,
            },
            ModerationFilter {
                name: ModerationTagName::new(String::from("sexual")),
                max_level: 1,
                strict_mode: true,
            },
        ])
    }
}

impl ModerationFilters {
    pub fn empty() -> Self {
        ModerationFilters(vec![])
    }
}

pub(crate) struct ModerationOptions {
    pub(crate) filters: Option<ModerationFilters>,
    pub(crate) mode: ModerationMode,
}
