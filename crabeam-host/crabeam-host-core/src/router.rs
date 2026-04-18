use axum::{
    Router,
    http::{HeaderValue, Method},
    routing,
};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::{
    CrabeamServer,
    handlers::{
        preview_offer_handler, session_handler, whip_delete_handler, whip_options_handler,
        whip_patch_handler, whip_post_handler,
    },
};

pub(crate) fn create_router(state: CrabeamServer) -> Router {
    Router::new()
        .route(
            "/whip",
            routing::post(whip_post_handler).options(whip_options_handler),
        )
        .route(
            "/whip/{session_id}",
            routing::patch(whip_patch_handler).delete(whip_delete_handler),
        )
        .route("/preview/offer", routing::post(preview_offer_handler))
        .route("/session", routing::get(session_handler))
        .layer(cors_layer())
        .with_state(state)
}

fn cors_layer() -> CorsLayer {
    let allowed_dev_origins = [
        HeaderValue::from_static("http://localhost:1420"),
        HeaderValue::from_static("http://127.0.0.1:1420"),
    ];

    CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any)
        .allow_origin(AllowOrigin::predicate(move |origin: &HeaderValue, _| {
            // 開発用
            if allowed_dev_origins.contains(origin) {
                return true;
            }

            // 本番用
            let origin = match origin.to_str() {
                Ok(v) => v,
                Err(_) => return false,
            };

            origin == "tauri://localhost"
                || origin == "http://tauri.localhost"
                || origin == "https://tauri.localhost"
                || origin.ends_with("://tauri.localhost")
                || origin.ends_with("://localhost")
        }))
}
