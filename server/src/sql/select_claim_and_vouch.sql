SELECT
    claim_events.raw_event AS claim_event,
    vouch_events.raw_event AS vouch_event
FROM
    events AS claim_events
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
LIMIT 1;
