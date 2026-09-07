use crate::service::content::content_filestore::ContentFilestore;
use crate::service::context::ServiceContext;
use crate::service::server::rpc::ServerConfig;
use crate::service::{self, notifications::rpc::build_notifications_service};
use axum::Router;
use common_kafka::FutureProducer;
use http::header::HeaderName;
use sea_orm::DatabaseConnection;
use tonic::service::Routes;
use tonic_web::GrpcWebLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_layer::Layer;

/// Builds reflection for gRPC docs. The file descriptors are created in ./build.rs.
fn build_reflection_service() -> Result<
    tonic_reflection::server::v1::ServerReflectionServer<
        impl tonic_reflection::server::v1::ServerReflection,
    >,
    Box<dyn std::error::Error>,
> {
    let service = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(
            service::proto::FILE_DESCRIPTOR_SET,
        )
        .build_v1()?;
    Ok(service)
}

/// Build the gRPC services as an `axum::Router` so they can be merged with
/// the HTTP router and served on a single port.
pub fn build_grpc_router(
    db: DatabaseConnection,
    ro_db: DatabaseConnection,
    kafka_producer: FutureProducer,
    filestore: ContentFilestore,
    server_config: ServerConfig,
) -> Result<Router, Box<dyn std::error::Error>> {
    let ctx = ServiceContext::new(db, ro_db, kafka_producer);
    let feeds_service = service::feeds::rpc::build_feeds_service(ctx.clone());
    let events_service =
        service::events::rpc::build_events_service(ctx.clone());
    let content_service =
        service::content::rpc::build_content_service(ctx.clone(), filestore);
    let pairing_service =
        service::identity::pairing::rpc::build_pairing_service(ctx.clone());
    let identity_service =
        service::identity::rpc::build_identity_service(ctx.clone());
    let server_info_service =
        service::server::rpc::build_server_service(server_config);
    let search_service =
        service::search::rpc::build_search_service(ctx.clone());
    let verifications_service =
        service::verifications::rpc::build_verifications_service(ctx.clone());
    let graph_service = service::graph::rpc::build_graph_service(ctx.clone());
    let profile_service =
        service::profile::rpc::build_profile_service(ctx.clone());
    let reflection_service = build_reflection_service()?;
    let notifications_service = build_notifications_service(ctx.clone());
    let grpc_web = GrpcWebLayer::new();

    let routes = Routes::default()
        .add_service(grpc_web.layer(reflection_service))
        .add_service(grpc_web.layer(events_service))
        .add_service(grpc_web.layer(feeds_service))
        .add_service(grpc_web.layer(content_service))
        .add_service(grpc_web.layer(notifications_service))
        .add_service(grpc_web.layer(pairing_service))
        .add_service(grpc_web.layer(identity_service))
        .add_service(grpc_web.layer(server_info_service))
        .add_service(grpc_web.layer(search_service))
        .add_service(grpc_web.layer(verifications_service))
        .add_service(grpc_web.layer(graph_service))
        .add_service(grpc_web.layer(profile_service));

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::any())
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("x-grpc-web"),
            HeaderName::from_static("grpc-timeout"),
            HeaderName::from_static("authorization"),
        ])
        .expose_headers([
            HeaderName::from_static("grpc-status"),
            HeaderName::from_static("grpc-message"),
        ])
        .allow_methods([http::Method::POST, http::Method::OPTIONS])
        .max_age(std::time::Duration::from_secs(86400));

    // Populates the authenticated identity from `authorization` bearer
    // tokens. Inside CORS so preflight requests skip it.
    let auth = axum::middleware::from_fn_with_state(
        service::auth::AuthState {
            ctx,
            allow_hosts: crate::config::get().allow_hosts.clone(),
        },
        service::auth::auth_middleware,
    );

    Ok(routes.into_axum_router().layer(auth).layer(cors))
}
