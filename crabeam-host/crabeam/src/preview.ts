async function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });
}

export async function attachCrabeemPreview(
  videoEl: HTMLVideoElement,
  previewOfferUrl: string,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  const stream = new MediaStream();
  videoEl.srcObject = stream;
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.muted = true;

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0]) {
      videoEl.srcObject = e.streams[0];
    } else {
      stream.addTrack(e.track);
    }
  };

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);

  const resp = await fetch(previewOfferUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer: pc.localDescription }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    pc.close();
    throw new Error(text);
  }

  const { answer } = await resp.json();
  await pc.setRemoteDescription(answer);

  return pc;
}
