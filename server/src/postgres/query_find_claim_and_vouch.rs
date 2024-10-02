#[derive(PartialEq, Debug)]
pub(crate) struct Match {
    pub(crate) claim_event:
        polycentric_protocol::model::signed_event::SignedEvent,
    pub(crate) vouch_event:
        polycentric_protocol::model::signed_event::SignedEvent,
}

#[allow(dead_code)]
#[derive(::sqlx::FromRow)]
struct Row {
    claim_event: ::std::vec::Vec<u8>,
    vouch_event: ::std::vec::Vec<u8>,
}

pub(crate) async fn query_find_claim_and_vouch(
    transaction: &mut ::sqlx::Transaction<'_, ::sqlx::Postgres>,
    vouching_system: &polycentric_protocol::model::public_key::PublicKey,
    claiming_system: &polycentric_protocol::model::public_key::PublicKey,
    claim_type: u64,
    fields: &[polycentric_protocol::protocol::ClaimFieldEntry],
) -> ::anyhow::Result<::std::option::Option<Match>> {
    let query = "
        SELECT
            claim_events.raw_event as claim_event,
            vouch_events.raw_event as vouch_event
        FROM
            events as claim_events
        JOIN
            claims
        ON
            claim_events.id = claims.event_id
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
                claim_events.system_key_type,
                claim_events.system_key,
                claim_events.process,
                claim_events.logical_clock
            )
        JOIN
            events vouch_events
        ON
            vouch_events.id = event_links.event_id
        WHERE
            claim_events.content_type = $1
        AND
            claim_events.system_key_type = $2
        AND
            claim_events.system_key = $3
        AND
            claims.claim_type = $4
        AND
            claims.fields @> $5
        AND
            vouch_events.content_type = $6
        AND
            vouch_events.system_key_type = $7
        AND
            vouch_events.system_key = $8
        ORDER BY
            vouch_events.unix_milliseconds DESC
        LIMIT 1;
    ";

    let potential_row = ::sqlx::query_as::<_, Row>(query)
        .bind(i64::try_from(
            polycentric_protocol::model::known_message_types::CLAIM,
        )?)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(
                claiming_system,
            ),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            claiming_system,
        ))
        .bind(i64::try_from(claim_type)?)
        .bind(crate::postgres::claim_fields_to_json_object(fields))
        .bind(i64::try_from(
            polycentric_protocol::model::known_message_types::VOUCH,
        )?)
        .bind(i64::try_from(
            polycentric_protocol::model::public_key::get_key_type(
                vouching_system,
            ),
        )?)
        .bind(polycentric_protocol::model::public_key::get_key_bytes(
            vouching_system,
        ))
        .fetch_optional(&mut **transaction)
        .await?;

    match potential_row {
        Some(row) => Ok(Some(Match {
            claim_event: polycentric_protocol::model::signed_event::from_vec(
                &row.claim_event,
            )?,
            vouch_event: polycentric_protocol::model::signed_event::from_vec(
                &row.vouch_event,
            )?,
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

        let mut claim_hacker_news =
            polycentric_protocol::protocol::ClaimFieldEntry::new();
        claim_hacker_news.key = 1;
        claim_hacker_news.value = "hello".to_string();

        let claim = polycentric_protocol::model::claim::Claim::new(
            1,
            &[claim_hacker_news.clone()],
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

        let result =
            crate::postgres::query_find_claim_and_vouch::query_find_claim_and_vouch(
                &mut transaction,
                &polycentric_protocol::model::public_key::PublicKey::Ed25519(
                    s2.verifying_key()
                ),
                &polycentric_protocol::model::public_key::PublicKey::Ed25519(
                    s1.verifying_key(),
                ),
                1,
                &[claim_hacker_news],
            )
            .await?;

        transaction.commit().await?;

        let expected =
            Some(crate::postgres::query_find_claim_and_vouch::Match {
                vouch_event: s2p1e1.clone(),
                claim_event: s1p1e1.clone(),
            });

        assert!(result == expected);

        Ok(())
    }
}
