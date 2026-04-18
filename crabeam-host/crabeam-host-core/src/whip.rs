use std::sync::Arc;

use anyhow::{Context, anyhow};
use axum::{
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
};
use uuid::Uuid;
use webrtc::{
    ice_transport::{ice_candidate::RTCIceCandidateInit, ice_server::RTCIceServer},
    peer_connection::{
        RTCPeerConnection, configuration::RTCConfiguration,
        peer_connection_state::RTCPeerConnectionState,
        sdp::session_description::RTCSessionDescription,
    },
    rtp_transceiver::rtp_codec::RTPCodecType,
    track::{track_local::TrackLocalWriter, track_remote::TrackRemote},
};

use crate::{CrabeamServer, WhipSession};

pub(crate) async fn whip_post_impl(
    state: CrabeamServer,
    headers: &HeaderMap,
    body: String,
) -> anyhow::Result<Response<String>> {
    validate_whip_request_headers(headers)?;

    let offer = RTCSessionDescription::offer(body)?;

    let pc = Arc::new(
        state
            .webrtc
            .api
            .new_peer_connection(RTCConfiguration {
                ice_servers: vec![RTCIceServer {
                    urls: vec!["stun:stun.l.google.com:19302".to_owned()],
                    ..Default::default()
                }],
                ..Default::default()
            })
            .await?,
    );

    install_obs_track_forwarders(state.clone(), pc.clone()).await?;
    install_whip_state_cleanup(state.clone(), pc.clone()).await;

    pc.set_remote_description(offer).await?;

    let answer = pc.create_answer(None).await?;
    let mut gather_complete = pc.gathering_complete_promise().await;
    pc.set_local_description(answer).await?;
    let _ = gather_complete.recv().await;

    let local = pc
        .local_description()
        .await
        .context("missing local description after set_local_description")?;

    let session_id = Uuid::new_v4().to_string();
    let etag = format!("\"{}\"", Uuid::new_v4());
    let location = format!("/whip/{session_id}");

    state.session.whip_sessions.write().await.insert(
        session_id.clone(),
        WhipSession {
            _id: session_id,
            pc,
            etag: etag.clone(),
        },
    );

    Ok(Response::builder()
        .status(StatusCode::CREATED)
        .header(header::CONTENT_TYPE, "application/sdp")
        .header(header::LOCATION, location)
        .header(header::ETAG, etag)
        .body(local.sdp)
        .unwrap())
}

pub(crate) async fn whip_patch_impl(
    state: CrabeamServer,
    session_id: &str,
    headers: &HeaderMap,
    body: &str,
) -> anyhow::Result<StatusCode> {
    validate_patch_headers(headers)?;

    let (pc, etag) = {
        let sessions = state.session.whip_sessions.read().await;
        let session = sessions
            .get(session_id)
            .with_context(|| format!("unknown WHIP session: {session_id}"))?;
        (session.pc.clone(), session.etag.clone())
    };

    if let Some(if_match) = headers.get(header::IF_MATCH) {
        let if_match = if_match.to_str().context("invalid If-Match header")?;
        if if_match != "*" && if_match != etag {
            return Ok(StatusCode::PRECONDITION_FAILED);
        }
    }

    let candidates = parse_trickle_ice_sdpfrag(body)?;
    for candidate in candidates {
        pc.add_ice_candidate(candidate).await?;
    }

    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn whip_delete_impl(
    state: CrabeamServer,
    session_id: &str,
    _headers: &HeaderMap,
) -> anyhow::Result<StatusCode> {
    let removed = state.session.whip_sessions.write().await.remove(session_id);
    let Some(session) = removed else {
        return Ok(StatusCode::NOT_FOUND);
    };

    session.pc.close().await?;
    Ok(StatusCode::OK)
}

async fn install_obs_track_forwarders(
    state: CrabeamServer,
    pc: Arc<RTCPeerConnection>,
) -> anyhow::Result<()> {
    pc.on_track(Box::new(
        move |track: Arc<TrackRemote>, _receiver, _transceiver| {
            let state = state.clone();

            Box::pin(async move {
                let relay = match track.kind() {
                    RTPCodecType::Video => state.webrtc.relay_video.clone(),
                    RTPCodecType::Audio => state.webrtc.relay_audio.clone(),
                    _ => return,
                };

                tokio::spawn(async move {
                    loop {
                        match track.read_rtp().await {
                            Ok((pkt, _)) => {
                                if let Err(_) = relay.write_rtp(&pkt).await {
                                    break;
                                }
                            }
                            Err(_) => {
                                break;
                            }
                        }
                    }
                });
            })
        },
    ));

    Ok(())
}

async fn install_whip_state_cleanup(state: CrabeamServer, pc: Arc<RTCPeerConnection>) {
    let pc_cloned = pc.clone();

    pc.on_peer_connection_state_change(Box::new(move |peer_state: RTCPeerConnectionState| {
        let pc = pc_cloned.clone();
        let state = state.clone();

        Box::pin(async move {
            if matches!(
                peer_state,
                RTCPeerConnectionState::Failed
                    | RTCPeerConnectionState::Closed
                    | RTCPeerConnectionState::Disconnected
            ) {
                let mut sessions = state.session.whip_sessions.write().await;
                let key = sessions
                    .iter()
                    .find(|(_, session)| Arc::ptr_eq(&session.pc, &pc))
                    .map(|(id, _)| id.clone());

                if let Some(key) = key {
                    sessions.remove(&key);
                }
            }
        })
    }));
}

fn validate_whip_request_headers(headers: &HeaderMap) -> anyhow::Result<()> {
    match headers.get(header::CONTENT_TYPE) {
        Some(value) if value == HeaderValue::from_static("application/sdp") => Ok(()),
        Some(value) => Err(anyhow!(
            "invalid Content-Type for WHIP POST: {}",
            value.to_str().unwrap_or("<non-utf8>")
        )),
        None => Err(anyhow!("missing Content-Type header")),
    }
}

fn validate_patch_headers(headers: &HeaderMap) -> anyhow::Result<()> {
    match headers.get(header::CONTENT_TYPE) {
        Some(value) if value == HeaderValue::from_static("application/trickle-ice-sdpfrag") => {
            Ok(())
        }
        Some(value) => Err(anyhow!(
            "invalid Content-Type for WHIP PATCH: {}",
            value.to_str().unwrap_or("<non-utf8>")
        )),
        None => Err(anyhow!("missing Content-Type header")),
    }
}

fn parse_trickle_ice_sdpfrag(body: &str) -> anyhow::Result<Vec<RTCIceCandidateInit>> {
    let mut current_mid: Option<String> = None;
    let mut current_ufrag: Option<String> = None;
    let mut out = Vec::new();

    for line in body.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(mid) = line.strip_prefix("a=mid:") {
            current_mid = Some(mid.to_owned());
            continue;
        }

        if let Some(ufrag) = line.strip_prefix("a=ice-ufrag:") {
            current_ufrag = Some(ufrag.to_owned());
            continue;
        }

        if let Some(candidate) = line.strip_prefix("a=candidate:") {
            out.push(RTCIceCandidateInit {
                candidate: format!("candidate:{candidate}"),
                sdp_mid: current_mid.clone(),
                sdp_mline_index: None,
                username_fragment: current_ufrag.clone(),
                ..Default::default()
            });
            continue;
        }

        if line == "a=end-of-candidates" {
            continue;
        }
    }

    if out.is_empty() {
        return Err(anyhow!("no ICE candidates found in PATCH body"));
    }

    Ok(out)
}
