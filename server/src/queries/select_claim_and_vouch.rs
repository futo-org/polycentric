#[derive(PartialEq, Debug)]
pub(crate) struct Match {
    pub(crate) claim_event: crate::model::signed_event::SignedEvent,
    pub(crate) vouch_event: crate::model::signed_event::SignedEvent,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct Row {
    claim_event: ::std::vec::Vec<u8>,
    vouch_event: ::std::vec::Vec<u8>,
}

pub(crate) async fn select(
    transaction: &::deadpool_postgres::Transaction<'_>,
    vouching_system: &crate::model::public_key::PublicKey,
    claiming_system: &crate::model::public_key::PublicKey,
    claim_type: u64,
    fields: &[crate::protocol::ClaimFieldEntry],
) -> ::anyhow::Result<::std::option::Option<Match>> {
    let statement = transaction
        .prepare_cached(::std::include_str!(
            "../sql/select_claim_and_vouch.sql"
        ))
        .await?;

    let potential_row = transaction
        .query_opt(
            &statement,
            &[
                &i64::try_from(crate::model::known_message_types::CLAIM)?,
                &i64::try_from(crate::model::public_key::get_key_type(
                    claiming_system,
                ))?,
                &crate::model::public_key::get_key_bytes(claiming_system),
                &i64::try_from(claim_type)?,
                &crate::postgres::claim_fields_to_json_object(fields),
                &i64::try_from(crate::model::known_message_types::VOUCH)?,
                &i64::try_from(crate::model::public_key::get_key_type(
                    vouching_system,
                ))?,
                &crate::model::public_key::get_key_bytes(vouching_system),
            ],
        )
        .await?;

    match potential_row {
        Some(row) => Ok(Some(Match {
            claim_event: crate::model::signed_event::from_vec(row.try_get(0)?)?,
            vouch_event: crate::model::signed_event::from_vec(row.try_get(1)?)?,
        })),
        None => Ok(None),
    }
}

#[cfg(test)]
pub mod tests {
    use ::protobuf::Message;

    #[::sqlx::test]
    async fn test_expect_match(pool: ::sqlx::PgPool) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        crate::postgres::prepare_database(&mut transaction).await?;

        let mut claim_hacker_news = crate::protocol::ClaimFieldEntry::new();
        claim_hacker_news.key = 1;
        claim_hacker_news.value = "hello".to_string();

        let claim =
            crate::model::claim::Claim::new(1, &[claim_hacker_news.clone()]);

        let s1 = crate::model::tests::make_test_keypair();
        let s1p1 = crate::model::tests::make_test_process();

        let s1p1e1 = crate::model::tests::make_test_event_with_content(
            &s1,
            &s1p1,
            1,
            crate::model::known_message_types::CLAIM,
            &crate::model::claim::to_proto(&claim).write_to_bytes()?,
            vec![],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;

        let s2 = crate::model::tests::make_test_keypair();
        let s2p1 = crate::model::tests::make_test_process();

        let s2p1e1 = crate::model::tests::make_test_event_with_content(
            &s2,
            &s2p1,
            1,
            crate::model::known_message_types::VOUCH,
            &vec![],
            vec![crate::model::reference::Reference::Pointer(
                crate::model::pointer::Pointer::new(
                    crate::model::public_key::PublicKey::Ed25519(
                        s1.verifying_key().clone(),
                    ),
                    s1p1,
                    1,
                    crate::model::digest::compute(s1p1e1.event()),
                ),
            )],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e1).await?;

        let result =
            crate::queries::query_find_claim_and_vouch::query_find_claim_and_vouch(
                &mut transaction,
                &crate::model::public_key::PublicKey::Ed25519(
                    s2.verifying_key().clone()
                ),
                &crate::model::public_key::PublicKey::Ed25519(
                    s1.verifying_key().clone(),
                ),
                1,
                &[claim_hacker_news],
            )
            .await?;

        transaction.commit().await?;

        let expected =
            Some(crate::queries::query_find_claim_and_vouch::Match {
                vouch_event: s2p1e1.clone(),
                claim_event: s1p1e1.clone(),
            });

        assert!(result == expected);

        Ok(())
    }
}
