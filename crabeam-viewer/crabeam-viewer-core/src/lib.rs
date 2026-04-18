use std::str::FromStr;

use iroh::{Endpoint, endpoint::presets};
use iroh_tickets::endpoint::EndpointTicket;
use wasm_bindgen::prelude::*;

pub const ALPN: &[u8] = b"crabeam/v1";

#[wasm_bindgen]
pub async fn connect_from_ticket(
    ticket_str: String,
    request_json: String,
) -> Result<String, JsValue> {
    let ticket = EndpointTicket::from_str(&ticket_str)
        .map_err(|e| js_sys::Error::new(&format!("invalid ticket: {e}")))?;

    let endpoint = Endpoint::builder(presets::N0)
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| js_sys::Error::new(&format!("endpoint bind failed: {e}")))?;

    let conn = endpoint
        .connect(ticket, ALPN)
        .await
        .map_err(|e| js_sys::Error::new(&format!("iroh connect failed: {e}")))?;

    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| js_sys::Error::new(&format!("open_bi failed: {e}")))?;

    send.write_all(request_json.as_bytes())
        .await
        .map_err(|e| js_sys::Error::new(&format!("send failed: {e}")))?;

    send.finish()
        .map_err(|e| js_sys::Error::new(&format!("finish failed: {e}")))?;

    let response = recv
        .read_to_end(1024 * 1024)
        .await
        .map_err(|e| js_sys::Error::new(&format!("recv failed: {e}")))?;

    String::from_utf8(response)
        .map_err(|e| js_sys::Error::new(&format!("utf8 decode failed: {e}")).into())
}
