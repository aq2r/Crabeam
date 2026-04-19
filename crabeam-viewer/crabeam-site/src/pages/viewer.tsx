import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router";
import { Menu } from "lucide-react";
import { connect_from_ticket } from "crabeam-viewer-core";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type ViewerStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "ended"
  | "invalid_ticket"
  | "error";

type SignalingAnswer = {
  type: "answer";
  answer: RTCSessionDescriptionInit;
  message?: string;
};

type VideoWithWebkitExtensions = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSetPresentationMode?: (
    mode: "inline" | "picture-in-picture" | "fullscreen",
  ) => void;
  webkitSupportsPresentationMode?: (
    mode: "inline" | "picture-in-picture" | "fullscreen",
  ) => boolean;
  requestPictureInPicture?: () => Promise<PictureInPictureWindow>;
};

const NICKNAME_STORAGE_KEY = "crabeam.viewer.nickname";

function readTicketFromHash() {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  const params = new URLSearchParams(raw);
  return params.get("ticket") ?? null;
}

async function waitIceComplete(
  pc: RTCPeerConnection,
  timeoutMs = 1000,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    let finished = false;

    const complete = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timerId);
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };

    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") {
        complete();
      }
    };

    const timerId = window.setTimeout(complete, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

function getStatusLabel(status: ViewerStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function getStatusTone(status: ViewerStatus): string {
  switch (status) {
    case "connected":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    case "connecting":
      return "border-white/20 bg-white/10 text-white/80";
    case "disconnected":
      return "border-yellow-400/25 bg-yellow-400/10 text-yellow-200";
    case "error":
      return "border-red-400/25 bg-red-400/10 text-red-200";
    default:
      return "border-white/10 bg-white/5 text-white/40";
  }
}

function classifyViewerError(message: string): {
  status: ViewerStatus;
  overlay: string;
  shouldReconnect: boolean;
} {
  const text = message.toLowerCase();

  if (
    text.includes("timed out") ||
    text.includes("host stopped") ||
    text.includes("stream closed") ||
    text.includes("session ended") ||
    text.includes("host is not started") ||
    text.includes("closed by peer")
  ) {
    return {
      status: "ended",
      overlay: "この配信は終了しました",
      shouldReconnect: false,
    };
  }

  if (
    text.includes("invalid ticket") ||
    text.includes("unknown ticket") ||
    text.includes("ticket not found") ||
    text.includes("expired ticket")
  ) {
    return {
      status: "invalid_ticket",
      overlay: "この共有リンクは無効です",
      shouldReconnect: false,
    };
  }

  if (
    text.includes("failed to connect") ||
    text.includes("ice connection failed") ||
    text.includes("webrtc connection failed") ||
    text.includes("network")
  ) {
    return {
      status: "error",
      overlay: "接続に失敗しました。再接続しています…",
      shouldReconnect: true,
    };
  }

  return {
    status: "error",
    overlay: "再生に失敗しました",
    shouldReconnect: true,
  };
}

export function ViewerPage() {
  const ticket = readTicketFromHash();
  if (!ticket) {
    return <Navigate to="/" replace />;
  }

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const autoStartedRef = useRef(false);
  const splashTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [error, setError] = useState("");

  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  const [nickname, setNickname] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [isInitialNicknameOpen, setIsInitialNicknameOpen] = useState(false);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuNicknameInput, setMenuNicknameInput] = useState("");

  const statusLabel = useMemo(() => getStatusLabel(status), [status]);

  const [videoStats, setVideoStats] = useState<{
    width: number | null;
    height: number | null;
    fps: number | null;
  }>({
    width: null,
    height: null,
    fps: null,
  });

  const clearSplashTimer = useCallback(() => {
    if (splashTimerRef.current !== null) {
      window.clearTimeout(splashTimerRef.current);
      splashTimerRef.current = null;
    }
  }, []);

  const showSplashNow = useCallback(() => {
    clearSplashTimer();
    setShowSplash(true);
    setSplashFading(false);
  }, [clearSplashTimer]);

  const hideSplashWithFade = useCallback(
    (delayMs = 0) => {
      clearSplashTimer();

      splashTimerRef.current = window.setTimeout(() => {
        setSplashFading(true);

        splashTimerRef.current = window.setTimeout(() => {
          setShowSplash(false);
          setSplashFading(false);
          splashTimerRef.current = null;
        }, 900);
      }, delayMs);
    },
    [clearSplashTimer],
  );

  const closeConnection = useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
      pcRef.current = null;
    }

    const stream = remoteStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      remoteStreamRef.current = null;
    }

    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
  }, []);

  const prepareVideoElement = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      throw new Error("video element is not ready");
    }

    video.autoplay = true;
    video.muted = isMuted;
    video.playsInline = true;

    return video;
  }, [isMuted]);

  const resumePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (status !== "connected" && status !== "connecting") {
      return;
    }

    try {
      await video.play();
    } catch {}
  }, [status]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let retryTimer: number | null = null;

    const scheduleResume = (delay = 150) => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }

      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void resumePlayback();
      }, delay);
    };

    const onPause = () => {
      scheduleResume(100);
    };

    const onEnded = () => {
      scheduleResume(100);
    };

    const onStalled = () => {
      scheduleResume(300);
    };

    const onSuspend = () => {
      scheduleResume(300);
    };

    const onWaiting = () => {
      scheduleResume(300);
    };

    const onCanPlay = () => {
      scheduleResume(0);
    };

    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("suspend", onSuspend);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);

    return () => {
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("suspend", onSuspend);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [resumePlayback]);

  const saveInitialNickname = useCallback(() => {
    const trimmed = nicknameInput.trim();

    if (!trimmed) {
      setError("ニックネームを入力してください");
      return;
    }

    window.localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed);
    setNickname(trimmed);
    setNicknameInput(trimmed);
    setMenuNicknameInput(trimmed);
    setIsInitialNicknameOpen(false);
    setError("");
  }, [nicknameInput]);

  const saveNicknameFromMenu = useCallback(() => {
    const trimmed = menuNicknameInput.trim();

    if (!trimmed) {
      setError("ニックネームを入力してください");
      return;
    }

    window.localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed);
    window.location.reload();
  }, [menuNicknameInput]);

  const connect = useCallback(async () => {
    const actualTicket = ticket.trim();

    if (!actualTicket) {
      setError("ticket is empty");
      setStatus("error");
      return;
    }

    if (!nickname.trim()) {
      setIsInitialNicknameOpen(true);
      setError("ニックネームを設定してください");
      return;
    }

    const scheduleReconnect = (delayMs = 1500) => {
      if (reconnectTimerRef.current !== null) return;
      if (!actualTicket || !nickname.trim()) return;

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delayMs);
    };

    try {
      setError("");
      setStatus("connecting");
      showSplashNow();

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      closeConnection();

      const video = prepareVideoElement();
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      const remoteStream = new MediaStream();

      pcRef.current = pc;
      remoteStreamRef.current = remoteStream;
      video.srcObject = remoteStream;

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;

        if (state === "connected") {
          setStatus("connected");
          return;
        }

        if (state === "connecting") {
          setStatus("connecting");
          return;
        }

        if (state === "failed") {
          const classified = classifyViewerError("WebRTC connection failed");
          setStatus(classified.status);
          setError("WebRTC connection failed");
          if (classified.shouldReconnect) {
            scheduleReconnect();
          }
          return;
        }

        if (state === "disconnected") {
          setStatus("disconnected");
          scheduleReconnect();
          return;
        }

        if (state === "closed") {
          const classified = classifyViewerError("stream closed");
          setStatus(classified.status);
          setError("stream closed");
          if (classified.shouldReconnect) {
            scheduleReconnect();
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          const classified = classifyViewerError("ICE connection failed");
          setStatus(classified.status);
          setError("ICE connection failed");
          if (classified.shouldReconnect) {
            scheduleReconnect();
          }
        }
      };

      pc.ontrack = async (event) => {
        const [stream] = event.streams;

        if (stream) {
          for (const mediaTrack of stream.getTracks()) {
            const exists = remoteStream
              .getTracks()
              .some((existing) => existing.id === mediaTrack.id);

            if (!exists) {
              remoteStream.addTrack(mediaTrack);
            }
          }
        } else if (event.track) {
          const exists = remoteStream
            .getTracks()
            .some((existing) => existing.id === event.track.id);

          if (!exists) {
            remoteStream.addTrack(event.track);
          }
        }

        void resumePlayback();
      };

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceComplete(pc);

      const responseJson = await connect_from_ticket(
        actualTicket,
        JSON.stringify({
          viewer_name: nickname,
          offer: pc.localDescription,
        }),
      );

      const response = JSON.parse(responseJson) as
        | SignalingAnswer
        | { type?: string; message?: string };

      if (response.type !== "answer" || !("answer" in response)) {
        throw new Error(response.message ?? "unexpected signaling response");
      }

      await pc.setRemoteDescription(response.answer);
    } catch (err) {
      closeConnection();

      const message = err instanceof Error ? err.message : String(err);
      const classified = classifyViewerError(message);

      setStatus(classified.status);
      setError(message);
      hideSplashWithFade(0);

      if (classified.shouldReconnect) {
        scheduleReconnect();
      }
    }
  }, [
    ticket,
    nickname,
    closeConnection,
    hideSplashWithFade,
    prepareVideoElement,
    showSplashNow,
  ]);

  const togglePictureInPicture = useCallback(async () => {
    const video = videoRef.current as VideoWithWebkitExtensions | null;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPipActive(false);
        return;
      }

      if (typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
        setIsPipActive(true);
        return;
      }

      if (
        video.webkitSupportsPresentationMode?.("picture-in-picture") &&
        video.webkitSetPresentationMode
      ) {
        video.webkitSetPresentationMode("picture-in-picture");
        setIsPipActive(true);
        return;
      }

      throw new Error("Picture-in-Picture is not supported in this browser");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const video = videoRef.current as VideoWithWebkitExtensions | null;
    if (!video) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
        return;
      }

      if (typeof video.requestFullscreen === "function") {
        await video.requestFullscreen();
        setIsFullscreen(true);
        return;
      }

      if (typeof video.webkitEnterFullscreen === "function") {
        video.webkitEnterFullscreen();
        setIsFullscreen(true);
        return;
      }

      throw new Error("Fullscreen is not supported in this browser");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const toggleMute = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !isMuted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);

    if (!nextMuted) {
      try {
        await video.play();
      } catch {
        //
      }
    }
  }, [isMuted]);

  const updateVideoStats = useCallback(async () => {
    const pc = pcRef.current;
    const video = videoRef.current;

    if (!pc) return;

    try {
      const report = await pc.getStats();

      let width: number | null = null;
      let height: number | null = null;
      let fps: number | null = null;

      report.forEach((stat) => {
        if (stat.type !== "inbound-rtp") return;
        if ((stat as RTCInboundRtpStreamStats).kind !== "video") return;

        const inbound = stat as RTCInboundRtpStreamStats;

        if (typeof inbound.frameWidth === "number") {
          width = inbound.frameWidth;
        }

        if (typeof inbound.frameHeight === "number") {
          height = inbound.frameHeight;
        }

        if (typeof inbound.framesPerSecond === "number") {
          fps = inbound.framesPerSecond;
        }
      });

      if ((!width || !height) && video) {
        if (video.videoWidth > 0) width = video.videoWidth;
        if (video.videoHeight > 0) height = video.videoHeight;
      }

      setVideoStats((prev) => {
        const next = {
          width: width ?? prev.width,
          height: height ?? prev.height,
          fps: fps ?? prev.fps,
        };

        if (
          next.width === prev.width &&
          next.height === prev.height &&
          next.fps === prev.fps
        ) {
          return prev;
        }

        return next;
      });
    } catch {
      //
    }
  }, []);

  useEffect(() => {
    if (status !== "connected" && status !== "connecting") {
      setVideoStats({
        width: null,
        height: null,
        fps: null,
      });
      return;
    }

    const timer = window.setInterval(() => {
      void updateVideoStats();
    }, 1000);

    void updateVideoStats();

    return () => {
      window.clearInterval(timer);
    };
  }, [status, updateVideoStats]);

  useEffect(() => {
    const savedNickname = window.localStorage.getItem(NICKNAME_STORAGE_KEY);

    if (savedNickname && savedNickname.trim()) {
      setNickname(savedNickname);
      setNicknameInput(savedNickname);
      setMenuNicknameInput(savedNickname);
    } else {
      setIsInitialNicknameOpen(true);
    }
  }, []);

  useEffect(() => {
    if (status === "connected") {
      hideSplashWithFade(150);
    } else if (status === "connecting") {
      showSplashNow();
    }
  }, [status, hideSplashWithFade, showSplashNow]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    const onEnterPip = () => {
      setIsPipActive(true);
    };

    const onLeavePip = () => {
      setIsPipActive(false);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);

    const video = videoRef.current;
    video?.addEventListener(
      "enterpictureinpicture",
      onEnterPip as EventListener,
    );
    video?.addEventListener(
      "leavepictureinpicture",
      onLeavePip as EventListener,
    );

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      video?.removeEventListener(
        "enterpictureinpicture",
        onEnterPip as EventListener,
      );
      video?.removeEventListener(
        "leavepictureinpicture",
        onLeavePip as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (!nickname.trim()) return;

    autoStartedRef.current = true;
    void connect();
  }, [connect, nickname]);

  useEffect(() => {
    return () => {
      clearSplashTimer();
      closeConnection();
    };
  }, [clearSplashTimer, closeConnection]);

  const overlayMessage = useMemo(() => {
    if (status === "connecting") {
      return "Connecting to stream...";
    }

    if (status === "disconnected") {
      return "Reconnecting...";
    }

    if (status === "ended") {
      return "This stream is ended.";
    }

    if (status === "invalid_ticket") {
      return "This sharing link is invalid.";
    }

    if (status === "error") {
      return classifyViewerError(error).overlay;
    }

    return "Waiting for stream";
  }, [status, error]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950 text-white">
      <Dialog open={isInitialNicknameOpen}>
        <DialogContent
          showCloseButton={false}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="border-white/10 bg-neutral-950 text-white"
        >
          <DialogHeader>
            <DialogTitle>ニックネームを設定してください</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              value={nicknameInput}
              onChange={(e) => setNicknameInput(e.target.value)}
              placeholder="nickname"
              className="border-white/10 bg-black/30 text-white placeholder:text-white/30"
            />

            <Button className="w-full" onClick={saveInitialNickname}>
              保存して開始
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 -top-48 h-112 w-lg -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-32 h-80 w-[20rem] rounded-full bg-white/3 blur-3xl" />
      </div>

      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1, scale: 1 }}
            animate={{
              opacity: splashFading ? 0 : 1,
              scale: splashFading ? 1.02 : 1,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black"
          >
            <div className="flex flex-col items-center gap-5">
              <div className="relative">
                <div className="absolute inset-0 scale-125 rounded-full bg-white/10 blur-3xl" />
                <img
                  src="/crabeam.png"
                  alt="Crabeam"
                  className="relative h-28 w-28 object-contain drop-shadow-[0_0_30px_rgba(255,255,255,0.15)]"
                />
              </div>

              <div className="text-sm uppercase tracking-[0.35em] text-white/85">
                Crabeam
              </div>

              <div className="text-xs text-white/50">
                {status === "connecting"
                  ? "Connecting..."
                  : status === "connected"
                    ? "Ready"
                    : "Preparing..."}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>

              <SheetContent
                side="left"
                className="border-white/10 bg-neutral-950 text-white"
              >
                <SheetHeader>
                  <SheetTitle className="text-white">Viewer Menu</SheetTitle>
                </SheetHeader>

                <div className="mt-6 mx-4 space-y-6">
                  <div>
                    <p className="mb-2 text-xs text-white/50">Nickname</p>
                    <Input
                      value={menuNicknameInput}
                      onChange={(e) => setMenuNicknameInput(e.target.value)}
                      placeholder="nickname"
                      className="border-white/10 bg-black/30 text-white placeholder:text-white/30"
                    />
                  </div>

                  <Button className="w-full" onClick={saveNicknameFromMenu}>
                    ニックネームを保存
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

            <img
              src="/crabeam.png"
              alt="Crabewm"
              className="h-9 w-9 object-contain opacity-90"
            />
            <div>
              <h1 className="text-lg font-semibold tracking-wide text-white/95">
                Crabeam
              </h1>
              <p className="text-xs text-white/40">Browser Viewer</p>
            </div>
          </div>

          <div
            className={[
              "rounded-full border px-3 py-1 text-xs tracking-wide",
              getStatusTone(status),
            ].join(" ")}
          >
            {statusLabel}
          </div>
        </header>

        <section className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-5xl">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/3 shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div className="text-sm text-white/75">Live Preview</div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="border-white/15 bg-black/30 text-white/80 hover:border-white/25 hover:bg-black/40 hover:text-white"
                    onClick={() => void toggleMute()}
                  >
                    {isMuted ? "Unmute" : "Mute"}
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="border-white/15 bg-black/30 text-white/80 hover:border-white/25 hover:bg-black/40 hover:text-white"
                    onClick={() => void togglePictureInPicture()}
                  >
                    {isPipActive ? "PiP On" : "PiP"}
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="border-white/15 bg-black/30 text-white/80 hover:border-white/25 hover:bg-black/40 hover:text-white"
                    onClick={() => void toggleFullscreen()}
                  >
                    {isFullscreen ? "Exit Full" : "Maximize"}
                  </Button>
                </div>
              </div>

              <div className="relative aspect-video w-full bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  controls={false}
                  className="h-full w-full bg-black object-contain"
                />

                <div className="pointer-events-none absolute right-3 top-3 z-10">
                  {(videoStats.width ||
                    videoStats.height ||
                    videoStats.fps) && (
                    <div className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs text-white/75 backdrop-blur-md">
                      {videoStats.width && videoStats.height
                        ? `${videoStats.width}×${videoStats.height}`
                        : "--×--"}
                      {" · "}
                      {typeof videoStats.fps === "number"
                        ? `${Math.round(videoStats.fps)} fps`
                        : "-- fps"}
                    </div>
                  )}
                </div>

                {status !== "connected" && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                    <div className="rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white/55 backdrop-blur-md">
                      {overlayMessage}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/*{error ? (
              <Card className="mt-4 border-red-400/20 bg-red-400/10 text-red-100 shadow-none">
                <CardContent className="pt-6">
                  <pre className="whitespace-pre-wrap font-sans text-sm">
                    {error}
                  </pre>
                </CardContent>
              </Card>
            ) : null}*/}
          </div>
        </section>
      </div>

      <a
        href="/ThirdPartyLicenses.html"
        className="fixed bottom-4 right-4 z-20 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/35 backdrop-blur-md transition hover:border-white/20 hover:text-white/60"
      >
        ThirdPartyLicense
      </a>
    </main>
  );
}
