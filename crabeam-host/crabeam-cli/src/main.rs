use crabeam_host_core::CrabeamServer;
use tokio::signal;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let server = CrabeamServer::new().await?;
    let port = server.run_server().await?;
    let ticket = server.start_host().await?;

    println!("Crabeam host started");
    println!();
    println!("endpoint ticket:");
    println!("{}", ticket.to_string());
    println!();
    println!("local endpoints:");
    println!("  WHIP         http://127.0.0.1:{port}/whip");
    println!("  Preview SDP  http://127.0.0.1:{port}/preview/offer");
    println!("  Session      http://127.0.0.1:{port}/session");
    println!();
    println!("Press Ctrl+C to stop.");

    signal::ctrl_c().await?;
    println!("Stopping.");

    Ok(())
}
