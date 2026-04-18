use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, Response, StatusCode},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

use crate::{
    CrabeamServer, SessionSnapshot,
    whip::{whip_delete_impl, whip_patch_impl, whip_post_impl},
};

pub(crate) async fn whip_post_handler(
    State(state): State<CrabeamServer>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    match whip_post_impl(state, &headers, body).await {
        Ok(resp) => resp,
        Err(err) => {
            eprintln!("WHIP POST failed: {err:#}");
            Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(format!("WHIP POST failed: {err:#}"))
                .unwrap()
        }
    }
}

pub(crate) async fn whip_options_handler() -> impl IntoResponse {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header("Accept-Post", "application/sdp")
        .header("Accept-Patch", "application/trickle-ice-sdpfrag")
        .body(String::new())
        .unwrap()
}

pub(crate) async fn whip_patch_handler(
    State(state): State<CrabeamServer>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
    body: String,
) -> impl IntoResponse {
    match whip_patch_impl(state, &session_id, &headers, &body).await {
        Ok(status) => status,
        Err(err) => {
            eprintln!("WHIP PATCH failed: {err:#}");
            StatusCode::BAD_REQUEST
        }
    }
}

pub(crate) async fn whip_delete_handler(
    State(state): State<CrabeamServer>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    match whip_delete_impl(state, &session_id, &headers).await {
        Ok(status) => status,
        Err(err) => {
            eprintln!("WHIP DELETE failed: {err:#}");
            StatusCode::BAD_REQUEST
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct PreviewOfferRequest {
    pub offer: RTCSessionDescription,
}

#[derive(Debug, Serialize)]
pub struct PreviewOfferResponse {
    pub answer: RTCSessionDescription,
}

pub async fn preview_offer_handler(
    State(state): State<CrabeamServer>,
    Json(req): Json<PreviewOfferRequest>,
) -> impl IntoResponse {
    match state.answer_preview_offer(req.offer).await {
        Ok(answer) => Json(PreviewOfferResponse { answer }).into_response(),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            format!("preview offer failed: {err:#}"),
        )
            .into_response(),
    }
}

pub async fn session_handler(State(state): State<CrabeamServer>) -> Json<SessionSnapshot> {
    Json(state.session.session_snapshot().await)
}
