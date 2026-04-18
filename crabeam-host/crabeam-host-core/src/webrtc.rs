use std::{collections::HashMap, sync::Arc};

use tokio::sync::{Mutex, RwLock};
use webrtc::{
    api::{
        API, APIBuilder,
        interceptor_registry::register_default_interceptors,
        media_engine::{MIME_TYPE_H264, MIME_TYPE_OPUS, MediaEngine},
    },
    interceptor::registry::Registry,
    peer_connection::RTCPeerConnection,
    rtp_transceiver::rtp_codec::RTCRtpCodecCapability,
    track::track_local::track_local_static_rtp::TrackLocalStaticRTP,
};

use crate::{SessionSnapshot, ViewerInfo, WhipSession};

pub(crate) struct WebRtcService {
    pub(crate) api: Arc<API>,
    pub(crate) relay_video: Arc<TrackLocalStaticRTP>,
    pub(crate) relay_audio: Arc<TrackLocalStaticRTP>,
}

impl WebRtcService {
    pub(crate) fn new() -> anyhow::Result<Self> {
        let mut media_engine = MediaEngine::default();
        media_engine.register_default_codecs()?;

        let mut registry = Registry::new();
        registry = register_default_interceptors(registry, &mut media_engine)?;

        let api = Arc::new(
            APIBuilder::new()
                .with_media_engine(media_engine)
                .with_interceptor_registry(registry)
                .build(),
        );

        let relay_video = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_H264.to_owned(),
                ..Default::default()
            },
            "video".to_owned(),
            "crabeam".to_owned(),
        ));

        let relay_audio = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_OPUS.to_owned(),
                ..Default::default()
            },
            "audio".to_owned(),
            "crabeam".to_owned(),
        ));

        Ok(Self {
            api,
            relay_video,
            relay_audio,
        })
    }
}

#[derive(Debug)]
pub(crate) struct SessionRegistry {
    pub(crate) viewers: RwLock<HashMap<u64, ViewerInfo>>,
    pub(crate) viewer_ids: Mutex<u64>,
    pub(crate) host_started: Mutex<bool>,
    pub(crate) peer_connections: RwLock<HashMap<u64, Arc<RTCPeerConnection>>>,
    pub(crate) whip_sessions: RwLock<HashMap<String, WhipSession>>,
    pub(crate) preview_peer: RwLock<Option<Arc<RTCPeerConnection>>>,
}

impl SessionRegistry {
    pub(crate) async fn session_snapshot(&self) -> SessionSnapshot {
        let names = {
            let lock = self.viewers.read().await;
            lock.values()
                .map(|v| v.username.clone())
                .collect::<Vec<_>>()
        };

        SessionSnapshot {
            viewer_count: names.len(),
            viewers: names,
        }
    }

    pub(crate) async fn next_viewer_id(&self) -> u64 {
        let mut lock = self.viewer_ids.lock().await;
        *lock += 1;
        *lock
    }
}

impl SessionRegistry {
    pub(crate) fn new() -> Self {
        let viewers = RwLock::new(HashMap::new());
        let viewer_ids = Mutex::new(0);
        let host_started = Mutex::new(false);
        let peer_connections = RwLock::new(HashMap::new());
        let whip_sessions = RwLock::new(HashMap::new());
        let preview_peer = RwLock::new(None);

        Self {
            viewers,
            viewer_ids,
            host_started,
            peer_connections,
            whip_sessions,
            preview_peer,
        }
    }
}
