use std::sync::Arc;

use anyhow::Context;
use iroh::{Endpoint, endpoint::Connection};
use iroh_tickets::endpoint::EndpointTicket;
use serde::Serialize;
use tokio::net::TcpListener;
use webrtc::{
    ice_transport::ice_server::RTCIceServer,
    peer_connection::{
        RTCPeerConnection, configuration::RTCConfiguration,
        peer_connection_state::RTCPeerConnectionState,
        sdp::session_description::RTCSessionDescription,
    },
};

use crate::{
    router,
    signaling::{HostSignalRequest, HostSignalResponse},
    utils,
    webrtc::{SessionRegistry, WebRtcService},
};

#[derive(Debug, Clone)]
pub struct ViewerInfo {
    pub username: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSnapshot {
    pub viewer_count: usize,
    pub viewers: Vec<String>,
}

#[derive(Debug)]
pub struct WhipSession {
    pub _id: String,
    pub pc: Arc<RTCPeerConnection>,
    pub etag: String,
}

#[derive(Clone)]
pub struct CrabeamServer {
    pub(crate) endpoint: Endpoint,
    pub(crate) session: Arc<SessionRegistry>,
    pub(crate) webrtc: Arc<WebRtcService>,
}

impl CrabeamServer {
    pub async fn new() -> anyhow::Result<Self> {
        let endpoint = crate::signaling::get_or_init_endpoint().await;
        let session = SessionRegistry::new();
        let webrtc = WebRtcService::new()?;

        Ok(Self {
            endpoint: endpoint.clone(),
            session: Arc::new(session),
            webrtc: Arc::new(webrtc),
        })
    }

    pub async fn run_server(&self) -> anyhow::Result<u16> {
        let router = router::create_router(self.clone());

        let listener = match TcpListener::bind("127.0.0.1:8924").await {
            Ok(l) => l,
            Err(_) => TcpListener::bind("127.0.0.1:0")
                .await
                .expect("Failed start server"),
        };
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("Failed start server")
        });

        Ok(port)
    }

    pub async fn start_host(&self) -> anyhow::Result<EndpointTicket> {
        let should_start = {
            let mut started = self.session.host_started.lock().await;
            if *started {
                false
            } else {
                *started = true;
                true
            }
        };

        if should_start {
            let state = self.clone();
            tokio::spawn(async move {
                if let Err(err) = state.signaling_accept_loop().await {
                    eprintln!("host signaling loop crashed: {err:#}");
                }
            });
        }

        Ok(EndpointTicket::new(self.endpoint.addr()))
    }

    pub async fn session_snapshot(&self) -> SessionSnapshot {
        self.session.session_snapshot().await
    }

    async fn create_sender_peer_connection(
        &self,
        viewer_id: u64,
    ) -> anyhow::Result<Arc<RTCPeerConnection>> {
        let config = RTCConfiguration {
            ice_servers: vec![RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_owned()],
                ..Default::default()
            }],
            ..Default::default()
        };
        let pc = Arc::new(self.webrtc.api.new_peer_connection(config).await?);

        let video_sender = pc.add_track(self.webrtc.relay_video.clone()).await?;

        tokio::spawn(async move {
            let mut rtcp_buf = vec![0u8; 1500];
            while video_sender.read(&mut rtcp_buf).await.is_ok() {}
        });

        let audio_sender = pc.add_track(self.webrtc.relay_audio.clone()).await?;
        tokio::spawn(async move {
            let mut rtcp_buf = vec![0u8; 1500];
            while audio_sender.read(&mut rtcp_buf).await.is_ok() {}
        });

        let session = self.session.clone();
        let pc_clone = pc.clone();
        pc.on_peer_connection_state_change(Box::new(move |state| {
            let pc = pc_clone.clone();
            let session = session.clone();

            Box::pin(async move {
                if state == RTCPeerConnectionState::Disconnected {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;

                    if pc.connection_state() == RTCPeerConnectionState::Disconnected {
                        session.peer_connections.write().await.remove(&viewer_id);
                        session.viewers.write().await.remove(&viewer_id);
                        let _ = pc.close().await;
                    }

                    return;
                }

                if matches!(
                    state,
                    RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
                ) {
                    session.peer_connections.write().await.remove(&viewer_id);
                    session.viewers.write().await.remove(&viewer_id);
                    let _ = pc.close().await;
                }
            })
        }));

        self.session
            .peer_connections
            .write()
            .await
            .insert(viewer_id, pc.clone());
        Ok(pc)
    }

    async fn answer_with_peer_connection(
        &self,
        pc: Arc<RTCPeerConnection>,
        offer: RTCSessionDescription,
    ) -> anyhow::Result<RTCSessionDescription> {
        pc.set_remote_description(offer).await?;

        let answer = pc.create_answer(None).await?;
        let mut gather_complete = pc.gathering_complete_promise().await;

        pc.set_local_description(answer).await?;
        let _ = gather_complete.recv().await;

        let local = pc
            .local_description()
            .await
            .context("local_description missing after set_local_description")?;

        Ok(local)
    }

    async fn answer_offer(
        &self,
        viewer_id: u64,
        offer: RTCSessionDescription,
    ) -> anyhow::Result<RTCSessionDescription> {
        let pc = self.create_sender_peer_connection(viewer_id).await?;
        self.answer_with_peer_connection(pc, offer).await
    }

    async fn signaling_accept_loop(&self) -> anyhow::Result<()> {
        loop {
            let Some(connecting) = self.endpoint.accept().await else {
                return Ok(());
            };

            let conn = match connecting.await {
                Ok(conn) => conn,
                Err(err) => {
                    eprintln!("iroh accept error: {err:#}");
                    continue;
                }
            };

            let state = self.clone();
            tokio::spawn(async move {
                if let Err(err) = state.handle_signal_connection(conn).await {
                    eprintln!("signaling connection ended: {err:#}");
                }
            });
        }
    }

    async fn handle_signal_connection(&self, conn: Connection) -> anyhow::Result<()> {
        loop {
            let slf = self.clone();

            let (mut send, mut recv) = match conn.accept_bi().await {
                Ok(streams) => streams,
                Err(_) => return Ok(()),
            };

            let req: HostSignalRequest = match utils::read_json(&mut recv).await {
                Ok(v) => v,
                Err(err) => {
                    let _ = utils::write_json(
                        &mut send,
                        &HostSignalResponse::Error {
                            message: format!("invalid signaling request: {err:#}"),
                        },
                    )
                    .await;
                    continue;
                }
            };

            let viewer_id = slf.session.next_viewer_id().await;

            slf.session.viewers.write().await.insert(
                viewer_id,
                ViewerInfo {
                    username: req.viewer_name.clone(),
                },
            );

            match slf.answer_offer(viewer_id, req.offer).await {
                Ok(answer) => {
                    utils::write_json(&mut send, &HostSignalResponse::Answer { answer }).await?;
                }
                Err(err) => {
                    self.session.viewers.write().await.remove(&viewer_id);
                    self.session
                        .peer_connections
                        .write()
                        .await
                        .remove(&viewer_id);

                    let _ = utils::write_json(
                        &mut send,
                        &HostSignalResponse::Error {
                            message: format!("{err:#}"),
                        },
                    )
                    .await;
                }
            }
        }
    }

    async fn create_preview_peer_connection(&self) -> anyhow::Result<Arc<RTCPeerConnection>> {
        let config = RTCConfiguration {
            ice_servers: vec![RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_owned()],
                ..Default::default()
            }],
            ..Default::default()
        };

        let pc = Arc::new(self.webrtc.api.new_peer_connection(config).await?);

        let video_sender = pc.add_track(self.webrtc.relay_video.clone()).await?;
        tokio::spawn(async move {
            let mut rtcp_buf = vec![0u8; 1500];
            while video_sender.read(&mut rtcp_buf).await.is_ok() {}
        });

        let audio_sender = pc.add_track(self.webrtc.relay_audio.clone()).await?;
        tokio::spawn(async move {
            let mut rtcp_buf = vec![0u8; 1500];
            while audio_sender.read(&mut rtcp_buf).await.is_ok() {}
        });

        let session = self.session.clone();
        let pc_clone = pc.clone();

        pc.on_peer_connection_state_change(Box::new(move |state| {
            let pc = pc_clone.clone();
            let session = session.clone();

            Box::pin(async move {
                if matches!(
                    state,
                    RTCPeerConnectionState::Failed
                        | RTCPeerConnectionState::Closed
                        | RTCPeerConnectionState::Disconnected
                ) {
                    let mut preview = session.preview_peer.write().await;
                    if preview
                        .as_ref()
                        .is_some_and(|current| Arc::ptr_eq(current, &pc))
                    {
                        *preview = None;
                    }

                    let _ = pc.close().await;
                }
            })
        }));

        Ok(pc)
    }

    pub(crate) async fn answer_preview_offer(
        &self,
        offer: RTCSessionDescription,
    ) -> anyhow::Result<RTCSessionDescription> {
        let pc = self.create_preview_peer_connection().await?;

        {
            let mut preview = self.session.preview_peer.write().await;

            if let Some(old) = preview.take() {
                let _ = old.close().await;
            }

            *preview = Some(pc.clone());
        }

        self.answer_with_peer_connection(pc, offer).await
    }
}
