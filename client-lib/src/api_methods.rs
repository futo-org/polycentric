#![allow(dead_code)]

use anyhow::{anyhow, Result};
use protobuf::Message;
use reqwest::{Client, RequestBuilder};

use polycentric_protocol::protocol::{
    ClaimFieldEntry, ClaimHandleRequest, Events, FindClaimAndVouchRequest,
    FindClaimAndVouchResponse, HarborChallengeResponse, HarborValidateRequest,
    PublicKey, QueryClaimToSystemRequest, QueryClaimToSystemResponse,
    QueryIndexResponse, QueryReferencesRequest,
    QueryReferencesRequestCountLWWElementReferences,
    QueryReferencesRequestCountReferences, QueryReferencesRequestEvents,
    QueryReferencesResponse, RangesForSystem, Reference, RepeatedUInt64,
};

use polycentric_protocol::model::signed_event::SignedEvent;

pub struct ApiMethods {
    user_agent: String,
    client: Client,
}

impl ApiMethods {
    pub fn new() -> Self {
        ApiMethods {
            user_agent: format!(
                "polycentric-client-{}",
                env!("CARGO_PKG_VERSION")
            ),
            client: Client::new(),
        }
    }

    fn get_request_builder(&self, url: &str) -> RequestBuilder {
        self.client
            .get(url)
            .header("x-polycentric-user-agent", &self.user_agent)
    }

    fn post_request_builder(&self, url: &str) -> RequestBuilder {
        self.client
            .post(url)
            .header("x-polycentric-user-agent", &self.user_agent)
    }

    async fn check_response(
        name: &str,
        response: &reqwest::Response,
    ) -> Result<()> {
        if !response.status().is_success() {
            let status = response.status();
            let url = response.url().clone();
            return Err(anyhow!(
                "{} to {} failed with status code {}.",
                name,
                url,
                status
            ));
        }
        Ok(())
    }

    pub async fn post_events(
        &self,
        server: &str,
        events: &[SignedEvent],
    ) -> Result<()> {
        let body = Events {
            events: events
                .iter()
                .map(polycentric_protocol::model::signed_event::to_proto)
                .collect(),
            ..Default::default()
        }
        .write_to_bytes()?;

        let response = self
            .post_request_builder(&format!("{}/events", server))
            .body(body)
            .send()
            .await?;

        Self::check_response("postEvents", &response).await
    }

    pub async fn post_censor(
        &self,
        server: &str,
        censorship_type: &str,
        url_info: &str,
        authorization: &str,
    ) -> Result<()> {
        let response = self
            .post_request_builder(&format!(
                "{}/censor?censorship_type={}",
                server, censorship_type
            ))
            .header("authorization", authorization)
            .body(url_info.to_string())
            .send()
            .await?;

        Self::check_response("postCensor", &response).await
    }

    pub async fn get_ranges(
        &self,
        server: &str,
        system: &PublicKey,
    ) -> Result<RangesForSystem> {
        let system_query =
            base64::encode_config(system.write_to_bytes()?, base64::URL_SAFE);
        let request = self.get_request_builder(&format!(
            "{}/ranges?system={}",
            server, system_query
        ));

        let response = request.send().await?;
        Self::check_response("getRanges", &response).await?;

        let ranges =
            RangesForSystem::parse_from_bytes(&response.bytes().await?)?;
        Ok(ranges)
    }

    pub async fn get_events(
        &self,
        server: &str,
        system: &PublicKey,
        ranges: &RangesForSystem,
    ) -> Result<Events> {
        let system_query =
            base64::encode_config(system.write_to_bytes()?, base64::URL_SAFE);
        let ranges_query =
            base64::encode_config(ranges.write_to_bytes()?, base64::URL_SAFE);
        let request = self.get_request_builder(&format!(
            "{}/events?system={}&ranges={}",
            server, system_query, ranges_query
        ));

        let response = request.send().await?;
        Self::check_response("getEvents", &response).await?;

        let events = Events::parse_from_bytes(&response.bytes().await?)?;
        Ok(events)
    }

    pub async fn get_resolve_claim(
        &self,
        server: &str,
        trust_root: &PublicKey,
        claim_type: u64,
        match_any_field: &str,
    ) -> Result<QueryClaimToSystemResponse> {
        let query = QueryClaimToSystemRequest {
            claim_type,
            trust_root: protobuf::MessageField::some(trust_root.clone()),
            query: Some(polycentric_protocol::protocol::query_claim_to_system_request::Query::MatchAnyField(match_any_field.to_string())),
            ..Default::default()
        };
        let encoded_query =
            base64::encode_config(query.write_to_bytes()?, base64::URL_SAFE);
        let url = format!("{}/resolve_claim?query={}", server, encoded_query);
        let request = self.get_request_builder(&url);

        let response = request.send().await?;
        Self::check_response("getResolveClaim", &response).await?;

        let query_response = QueryClaimToSystemResponse::parse_from_bytes(
            &response.bytes().await?,
        )?;
        Ok(query_response)
    }

    pub async fn get_query_latest(
        &self,
        server: &str,
        system: &PublicKey,
        event_types: &[u64],
    ) -> Result<Events> {
        let system_query =
            base64::encode_config(system.write_to_bytes()?, base64::URL_SAFE);
        let event_types_proto = RepeatedUInt64 {
            numbers: event_types.to_vec(),
            ..Default::default()
        };
        let event_types_query = base64::encode_config(
            event_types_proto.write_to_bytes()?,
            base64::URL_SAFE,
        );
        let url = format!(
            "{}/query_latest?system={}&event_types={}",
            server, system_query, event_types_query
        );
        let request = self.get_request_builder(&url);

        let response = request.send().await?;
        Self::check_response("getQueryLatest", &response).await?;

        let events = Events::parse_from_bytes(&response.bytes().await?)?;
        Ok(events)
    }

    pub async fn get_query_index(
        &self,
        server: &str,
        system: &PublicKey,
        content_type: u64,
        after: Option<i64>,
        limit: Option<i64>,
    ) -> Result<QueryIndexResponse> {
        let system_query =
            base64::encode_config(system.write_to_bytes()?, base64::URL_SAFE);
        let mut url = format!(
            "{}/query_index?system={}&content_type={}",
            server, system_query, content_type
        );

        if let Some(after_val) = after {
            url.push_str(&format!("&after={}", after_val));
        }
        if let Some(limit_val) = limit {
            url.push_str(&format!("&limit={}", limit_val));
        }

        let request = self.get_request_builder(&url);

        let response = request.send().await?;
        Self::check_response("getQueryIndex", &response).await?;

        let query_index_response =
            QueryIndexResponse::parse_from_bytes(&response.bytes().await?)?;
        Ok(query_index_response)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_query_references(
        &self,
        server: &str,
        reference: &Reference,
        cursor: Option<&[u8]>,
        request_events: Option<&QueryReferencesRequestEvents>,
        count_lww_element_references: Option<
            &[QueryReferencesRequestCountLWWElementReferences],
        >,
        count_references: Option<&[QueryReferencesRequestCountReferences]>,
        extra_byte_references: Option<&[Vec<u8>]>,
    ) -> Result<QueryReferencesResponse> {
        let mut query = QueryReferencesRequest {
            reference: protobuf::MessageField::some(reference.clone()),
            ..Default::default()
        };

        if let Some(c) = cursor {
            query.cursor = Some(c.to_vec());
        }
        if let Some(re) = request_events {
            query.request_events = protobuf::MessageField::some(re.clone());
        }
        if let Some(clr) = count_lww_element_references {
            query.count_lww_element_references = clr.to_vec();
        }
        if let Some(cr) = count_references {
            query.count_references = cr.to_vec();
        }
        if let Some(ebr) = extra_byte_references {
            query.extra_byte_references = ebr.to_vec();
        }

        let encoded_query =
            base64::encode_config(query.write_to_bytes()?, base64::URL_SAFE);
        let url =
            format!("{}/query_references?query={}", server, encoded_query);
        let request = self.get_request_builder(&url);

        let response = request.send().await?;
        Self::check_response("getQueryReferences", &response).await?;

        let query_references_response =
            QueryReferencesResponse::parse_from_bytes(
                &response.bytes().await?,
            )?;
        Ok(query_references_response)
    }

    pub async fn get_search(
        &self,
        server: &str,
        search_query: &str,
        limit: Option<u32>,
        cursor: Option<&[u8]>,
        search_type: Option<&str>,
    ) -> Result<Events> {
        // TODO: Check if search_query works right here
        let mut url = format!(
            "{}/search?search={}",
            server,
            base64::encode_config(search_query.as_bytes(), base64::URL_SAFE)
        );

        if let Some(c) = cursor {
            url.push_str(&format!(
                "&cursor={}",
                base64::encode_config(c, base64::URL_SAFE)
            ));
        }
        if let Some(l) = limit {
            url.push_str(&format!("&limit={}", l));
        }
        if let Some(st) = search_type {
            url.push_str(&format!("&search_type={}", st));
        }

        let response = self.get_request_builder(&url).send().await?;
        Self::check_response("getSearch", &response).await?;

        let events = Events::parse_from_bytes(&response.bytes().await?)?;
        Ok(events)
    }

    pub async fn get_top_string_references(
        &self,
        server: &str,
        query: Option<&str>,
        time_range: Option<&str>,
        limit: Option<u32>,
    ) -> Result<Events> {
        let mut url = format!("{}/top_string_references?", server);

        if let Some(q) = query {
            url.push_str(&format!("query={}&", q));
        }
        if let Some(tr) = time_range {
            url.push_str(&format!("time_range={}&", tr));
        }
        if let Some(l) = limit {
            url.push_str(&format!("limit={}&", l));
        }

        let response = self.get_request_builder(&url).send().await?;
        Self::check_response("getTopStringReferences", &response).await?;

        let events = Events::parse_from_bytes(&response.bytes().await?)?;
        Ok(events)
    }

    pub async fn get_head(
        &self,
        server: &str,
        system: &PublicKey,
    ) -> Result<Events> {
        let system_query =
            base64::encode_config(system.write_to_bytes()?, base64::URL_SAFE);
        let url = format!("{}/head?system={}", server, system_query);

        let response = self.get_request_builder(&url).send().await?;
        Self::check_response("getHead", &response).await?;

        let events = Events::parse_from_bytes(&response.bytes().await?)?;
        Ok(events)
    }

    pub async fn get_explore(
        &self,
        server: &str,
        limit: Option<u32>,
        cursor: Option<&[u8]>,
    ) -> Result<Events> {
        let mut url = format!("{}/explore?", server);

        if let Some(c) = cursor {
            url.push_str(&format!(
                "cursor={}&",
                base64::encode_config(c, base64::URL_SAFE)
            ));
        }
        if let Some(l) = limit {
            url.push_str(&format!("limit={}&", l));
        }

        let response = self.get_request_builder(&url).send().await?;
        Self::check_response("getExplore", &response).await?;

        let events = Events::parse_from_bytes(&response.bytes().await?)?;
        Ok(events)
    }

    pub async fn get_find_claim_and_vouch(
        &self,
        server: &str,
        vouching_system: &PublicKey,
        claiming_system: &PublicKey,
        fields: &[ClaimFieldEntry],
        claim_type: u64,
    ) -> Result<Option<FindClaimAndVouchResponse>> {
        let query = FindClaimAndVouchRequest {
            vouching_system: protobuf::MessageField::some(
                vouching_system.clone(),
            ),
            claiming_system: protobuf::MessageField::some(
                claiming_system.clone(),
            ),
            fields: fields.to_vec(),
            claim_type,
            ..Default::default()
        };

        let encoded_query =
            base64::encode_config(query.write_to_bytes()?, base64::URL_SAFE);
        let url =
            format!("{}/find_claim_and_vouch?query={}", server, encoded_query);

        let response = self.get_request_builder(&url).send().await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        Self::check_response("getFindClaimAndVouch", &response).await?;

        let find_claim_and_vouch_response =
            FindClaimAndVouchResponse::parse_from_bytes(
                &response.bytes().await?,
            )?;
        Ok(Some(find_claim_and_vouch_response))
    }

    pub async fn get_challenge(
        &self,
        server: &str,
    ) -> Result<HarborChallengeResponse> {
        let response = self
            .get_request_builder(&format!("{}/challenge", server))
            .send()
            .await?;
        Self::check_response("getChallenge", &response).await?;

        let challenge_response = HarborChallengeResponse::parse_from_bytes(
            &response.bytes().await?,
        )?;
        Ok(challenge_response)
    }

    pub async fn post_purge(
        &self,
        server: &str,
        solved_challenge: HarborValidateRequest,
    ) -> Result<()> {
        let response = self
            .post_request_builder(&format!("{}/purge", server))
            .body(solved_challenge.write_to_bytes()?)
            .send()
            .await?;

        Self::check_response("postPurge", &response).await
    }

    pub async fn post_claim_handle(
        &self,
        server: &str,
        claim_request: ClaimHandleRequest,
    ) -> Result<()> {
        let response = self
            .post_request_builder(&format!("{}/claim_handle", server))
            .body(claim_request.write_to_bytes()?)
            .send()
            .await?;

        Self::check_response("postClaimHandle", &response).await
    }

    pub async fn get_resolve_handle(
        &self,
        server: &str,
        handle: &str,
    ) -> Result<PublicKey> {
        let response = self
            .get_request_builder(&format!(
                "{}/resolve_handle?handle={}",
                server, handle
            ))
            .send()
            .await?;

        Self::check_response("getResolveHandle", &response).await?;

        let public_key = PublicKey::parse_from_bytes(&response.bytes().await?)?;
        Ok(public_key)
    }
}
