use iroh::{Endpoint, endpoint::presets};
use serde::{Deserialize, Serialize};
use tokio::sync::OnceCell;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

pub(crate) const ALPN: &[u8] = b"crabeam/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostSignalRequest {
    pub viewer_name: String,
    pub offer: RTCSessionDescription,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum HostSignalResponse {
    Answer { answer: RTCSessionDescription },
    Error { message: String },
}

static ENDPOINT: OnceCell<Endpoint> = OnceCell::const_new();

pub(crate) async fn get_or_init_endpoint() -> &'static Endpoint {
    ENDPOINT
        .get_or_init(async || {
            Endpoint::builder(presets::N0)
                .alpns(vec![ALPN.to_vec()])
                .bind()
                .await
                .expect("Failed to create endpoint")
        })
        .await
}
