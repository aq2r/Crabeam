use iroh::endpoint::{RecvStream, SendStream};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

const MAX_SIGNAL_BYTES: usize = 1024 * 1024;

pub(crate) async fn read_json<T: for<'de> Deserialize<'de>>(
    recv: &mut RecvStream,
) -> anyhow::Result<T> {
    let buf = recv.read_to_end(MAX_SIGNAL_BYTES).await?;
    if buf.len() > MAX_SIGNAL_BYTES {
        anyhow::bail!("signaling payload too large");
    }
    let value = serde_json::from_slice::<T>(&buf)?;
    Ok(value)
}

pub(crate) async fn write_json<T: Serialize>(
    send: &mut SendStream,
    value: &T,
) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    send.write_all(&bytes).await?;
    send.shutdown().await?;
    Ok(())
}
