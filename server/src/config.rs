use ::envconfig::Envconfig;

pub(crate) enum Mode {
    ServeAPI,
    BackfillSearch,
    BackfillRemoteServer,
}

#[derive(::envconfig::Envconfig)]
pub(crate) struct Config {
    #[envconfig(from = "HTTP_PORT_API", default = "8081")]
    pub http_port_api: u16,

    #[envconfig(
        from = "DATABASE_URL",
        default = "postgres://postgres:testing@postgres"
    )]
    pub postgres_string: String,

    #[envconfig(from = "DATABASE_URL_READ_ONLY")]
    pub postgres_string_read_only: Option<String>,

    #[envconfig(
        from = "OPENSEARCH_STRING",
        default = "http://opensearch-node1:9200"
    )]
    pub opensearch_string: String,

    #[envconfig(from = "ADMIN_TOKEN")]
    pub admin_token: String,

    #[envconfig(from = "STATSD_ADDRESS", default = "telegraf")]
    pub statsd_address: String,

    #[envconfig(from = "STATSD_PORT", default = "8125")]
    pub statsd_port: u16,

    #[envconfig(from = "CHALLENGE_KEY")]
    pub challenge_key: String,

    #[envconfig(from = "MODE", default = "SERVE_API")]
    pub mode: Mode,

    #[envconfig(from = "BACKFILL_REMOTE_SERVER_ADDRESS")]
    pub backfill_remote_server_address: Option<String>,

    #[envconfig(from = "BACKFILL_REMOTE_SERVER_POSITION")]
    pub backfill_remote_server_position: Option<u64>,

    #[envconfig(from = "CSAM_INTERFACE")]
    pub csam_interface: String,

    #[envconfig(from = "TAG_INTERFACE")]
    pub tag_interface: Option<String>,

    #[envconfig(from = "AZURE_TAGGING_ENDPOINT")]
    pub azure_tagging_endpoint: Option<String>,

    #[envconfig(from = "AZURE_TAGGING_SUBSCRIPTION_KEY")]
    pub azure_tagging_subscription_key: Option<String>,

    #[envconfig(
        from = "AZURE_TAGGING_API_VERSION",
    )]
    pub azure_tagging_api_version: Option<String>,

    #[envconfig(from = "PHOTODNA_KEY")]
    pub photodna_key: Option<String>,

    #[envconfig(from = "TAGGING_REQUEST_RATE_LIMIT", default = "10")]
    pub tagging_request_rate_limit: u16,

    #[envconfig(from = "CSAM_REQUEST_RATE_LIMIT", default = "4")]
    pub csam_request_rate_limit: u16,
}
