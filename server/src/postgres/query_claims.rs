#[derive(PartialEq, Debug)]
pub(crate) struct Match {
    pub(crate) claim: polycentric_protocol::model::signed_event::SignedEvent,
    pub(crate) path:
        ::std::vec::Vec<polycentric_protocol::model::signed_event::SignedEvent>,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
pub(crate) struct Row {
    claim_event: ::std::vec::Vec<u8>,
    vouch_event: ::std::vec::Vec<u8>,
}

pub(crate) async fn query_claims_match_any_field(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    claim_type: u64,
    trust_root: &polycentric_protocol::model::public_key::PublicKey,
    match_any_field: &String,
) -> ::anyhow::Result<::std::vec::Vec<Match>> {
    let query = "
        SELECT
            events.raw_event as claim_event,
            vouch_events.raw_event as vouch_event
        FROM
            events
        JOIN
            claims
        ON
            events.id = claims.event_id
        JOIN
            event_links
        ON
            (
                event_links.subject_system_key_type,
                event_links.subject_system_key,
                event_links.subject_process,
                event_links.subject_logical_clock
            )
            =
            (
                events.system_key_type,
                events.system_key,
                events.process,
                events.logical_clock
            )
        JOIN
            events vouch_events
        ON
            vouch_events.id = event_links.event_id
        WHERE
            events.content_type = $1
        AND
            claims.claim_type = $2
        AND
            jsonb_path_query_array(claims.fields, '$.*') ? $3
        AND
            vouch_events.content_type = $4
        AND
            vouch_events.system_key_type = $5
        AND
            vouch_events.system_key = $6
        ORDER BY
            vouch_events.unix_milliseconds DESC
    ";

    ::sqlx::query_as::<_, Row>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::known_message_types::CLAIM,
        )?)
        .bind(i64::try_from(claim_type)?)
        .bind(match_any_field)
        .bind(i64::try_from(
            polycentric_protocol::model::known_message_types::VOUCH,
        )?)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(trust_root),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            trust_root,
        ))
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|row| {
            Ok(Match {
                claim: polycentric_protocol::model::signed_event::from_vec(
                    &row.claim_event,
                )?,
                path: vec![
                    polycentric_protocol::model::signed_event::from_vec(
                        &row.vouch_event,
                    )?,
                ],
            })
        })
        .collect::<::anyhow::Result<::std::vec::Vec<Match>>>()
}

pub(crate) async fn query_claims_match_all_fields(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    claim_type: u64,
    trust_root: &polycentric_protocol::model::public_key::PublicKey,
    match_all_fields: &[polycentric_protocol::protocol::ClaimFieldEntry],
) -> ::anyhow::Result<::std::vec::Vec<Match>> {
    let query = "
        SELECT
            events.raw_event as claim_event,
            vouch_events.raw_event as vouch_event
        FROM
            events
        JOIN
            claims
        ON
            events.id = claims.event_id
        JOIN
            event_links
        ON
            (
                event_links.subject_system_key_type,
                event_links.subject_system_key,
                event_links.subject_process,
                event_links.subject_logical_clock
            )
            =
            (
                events.system_key_type,
                events.system_key,
                events.process,
                events.logical_clock
            )
        JOIN
            events vouch_events
        ON
            vouch_events.id = event_links.event_id
        WHERE
            events.content_type = $1
        AND
            claims.claim_type = $2
        AND
            claims.fields @> $3
        AND
            vouch_events.content_type = $4
        AND
            vouch_events.system_key_type = $5
        AND
            vouch_events.system_key = $6
        ORDER BY
            vouch_events.unix_milliseconds DESC
    ";

    ::sqlx::query_as::<_, Row>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::known_message_types::CLAIM,
        )?)
        .bind(i64::try_from(claim_type)?)
        .bind(crate::postgres::claim_fields_to_json_object(
            match_all_fields,
        ))
        .bind(i64::try_from(
            polycentric_protocol::model::known_message_types::VOUCH,
        )?)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(trust_root),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            trust_root,
        ))
        .fetch_all(&mut **transaction)
        .await?
        .iter()
        .map(|row| {
            Ok(Match {
                claim: polycentric_protocol::model::signed_event::from_vec(
                    &row.claim_event,
                )?,
                path: vec![
                    polycentric_protocol::model::signed_event::from_vec(
                        &row.vouch_event,
                    )?,
                ],
            })
        })
        .collect::<::anyhow::Result<::std::vec::Vec<Match>>>()
}

#[cfg(test)]
pub mod tests {
    use ::protobuf::Message;

    #[::sqlx::test]
    async fn test_match_any_field(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        crate::postgres::prepare_database(&mut transaction).await?;

        let mut claim_hacker_news =
            polycentric_protocol::protocol::ClaimFieldEntry::new();
        claim_hacker_news.key = 1;
        claim_hacker_news.value = "hello".to_string();

        let claim = polycentric_protocol::model::claim::Claim::new(
            1,
            &[claim_hacker_news],
        );

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s1p1 = polycentric_protocol::test_utils::make_test_process();

        let s1p1e1 =
            polycentric_protocol::test_utils::make_test_event_with_content(
                &s1,
                &s1p1,
                1,
                polycentric_protocol::model::known_message_types::CLAIM,
                &polycentric_protocol::model::claim::to_proto(&claim)
                    .write_to_bytes()?,
                vec![],
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;

        let s2 = polycentric_protocol::test_utils::make_test_keypair();
        let s2p1 = polycentric_protocol::test_utils::make_test_process();

        let s2p1e1 = polycentric_protocol::test_utils::make_test_event_with_content(
            &s2,
            &s2p1,
            1,
            polycentric_protocol::model::known_message_types::VOUCH,
            &[],
            vec![polycentric_protocol::model::reference::Reference::Pointer(
                polycentric_protocol::model::pointer::Pointer::new(
                    polycentric_protocol::model::public_key::PublicKey::Ed25519(
                        s1.verifying_key(),
                    ),
                    s1p1,
                    1,
                    polycentric_protocol::model::digest::compute(s1p1e1.event()),
                ),
            )],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e1).await?;

        let start = ::std::time::Instant::now();

        let result =
            crate::postgres::query_claims::query_claims_match_any_field(
                &mut transaction,
                1,
                &polycentric_protocol::model::public_key::PublicKey::Ed25519(
                    s2.verifying_key(),
                ),
                &"hello".to_string(),
            )
            .await?;

        let duration = start.elapsed();
        println!("Query took: {:?}", duration);

        let expected = vec![crate::postgres::query_claims::Match {
            claim: s1p1e1.clone(),
            path: vec![s2p1e1.clone()],
        }];

        transaction.commit().await?;

        assert!(result == expected);

        Ok(())
    }

    #[::sqlx::test]
    async fn test_match_all_fields(
        pool: ::sqlx::PgPool,
    ) -> ::anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        crate::postgres::prepare_database(&mut transaction).await?;

        let mut claim_field_1 =
            polycentric_protocol::protocol::ClaimFieldEntry::new();
        claim_field_1.key = 1;
        claim_field_1.value = "alpha".to_string();

        let mut claim_field_2 =
            polycentric_protocol::protocol::ClaimFieldEntry::new();
        claim_field_2.key = 2;
        claim_field_2.value = "bravo".to_string();

        let claim_fields = [claim_field_1, claim_field_2];

        let claim =
            polycentric_protocol::model::claim::Claim::new(1, &claim_fields);

        let s1 = polycentric_protocol::test_utils::make_test_keypair();
        let s1p1 = polycentric_protocol::test_utils::make_test_process();

        let s1p1e1 =
            polycentric_protocol::test_utils::make_test_event_with_content(
                &s1,
                &s1p1,
                1,
                polycentric_protocol::model::known_message_types::CLAIM,
                &polycentric_protocol::model::claim::to_proto(&claim)
                    .write_to_bytes()?,
                vec![],
            );

        crate::ingest::ingest_event_postgres(&mut transaction, &s1p1e1).await?;

        let s2 = polycentric_protocol::test_utils::make_test_keypair();
        let s2p1 = polycentric_protocol::test_utils::make_test_process();

        let s2p1e1 = polycentric_protocol::test_utils::make_test_event_with_content(
            &s2,
            &s2p1,
            1,
            polycentric_protocol::model::known_message_types::VOUCH,
            &[],
            vec![polycentric_protocol::model::reference::Reference::Pointer(
                polycentric_protocol::model::pointer::Pointer::new(
                    polycentric_protocol::model::public_key::PublicKey::Ed25519(
                        s1.verifying_key(),
                    ),
                    s1p1,
                    1,
                    polycentric_protocol::model::digest::compute(s1p1e1.event()),
                ),
            )],
        );

        crate::ingest::ingest_event_postgres(&mut transaction, &s2p1e1).await?;

        let result =
            crate::postgres::query_claims::query_claims_match_all_fields(
                &mut transaction,
                1,
                &polycentric_protocol::model::public_key::PublicKey::Ed25519(
                    s2.verifying_key(),
                ),
                &claim_fields,
            )
            .await?;

        let expected = vec![crate::postgres::query_claims::Match {
            claim: s1p1e1.clone(),
            path: vec![s2p1e1.clone()],
        }];

        transaction.commit().await?;

        assert!(result == expected);

        Ok(())
    }
}
