import { AnimatePresence, motion } from "motion/react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate } from "react-router";
import { Menu } from "lucide-react";
import { connect_from_ticket } from "crabeam-viewer-core";

import { Button } from "@/components/ui/button";
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

type ViewerErrorState = {
  status: ViewerStatus;
  overlay: string;
  shouldReconnect: boolean;
};

type VideoStats = {
  width: number | null;
  height: number | null;
  fps: number | null;
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
const RECONNECT_DELAY_MS = 1500;
const ICE_COMPLETE_TIMEOUT_MS = 1000;

type PersistentNicknameState = {
  nickname: string;
  initialInput: string;
  menuInput: string;
  isInitialDialogOpen: boolean;
  setInitialInput: (value: string) => void;
  setMenuInput: (value: string) => void;
  setIsInitialDialogOpen: (open: boolean) => void;
  saveNickname: (rawValue: string) => string | null;
};

function readTicketFromHash() {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;

  const params = new URLSearchParams(raw);
  return params.get("ticket") ?? null;
}

async function waitIce(
  pc: RTCPeerConnection,
  timeoutMs = ICE_COMPLETE_TIMEOUT_MS,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    let finished = false;

    const complete = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timerId);
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
    case "ended":
      return "Ended";
    case "invalid_ticket":
      return "Invalid Link";
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
    case "ended":
      return "border-white/10 bg-white/5 text-white/55";
    case "invalid_ticket":
      return "border-amber-400/25 bg-amber-400/10 text-amber-200";
    case "error":
      return "border-red-400/25 bg-red-400/10 text-red-200";
    default:
      return "border-white/10 bg-white/5 text-white/40";
  }
}

function classifyViewerError(message: string): ViewerErrorState {
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

function getOverlayMessage(status: ViewerStatus, error: string): string {
  switch (status) {
    case "connecting":
      return "Connecting to stream...";
    case "disconnected":
      return "Reconnecting...";
    case "ended":
      return "This stream is ended.";
    case "invalid_ticket":
      return "This sharing link is invalid.";
    case "error":
      return classifyViewerError(error).overlay;
    default:
      return "Waiting for stream";
  }
}

function usePersistentNickname(): PersistentNicknameState {
  const [nickname, setNickname] = useState("");
  const [initialInput, setInitialInput] = useState("");
  const [menuInput, setMenuInput] = useState("");
  const [isInitialDialogOpen, setIsInitialDialogOpen] = useState(false);

  useEffect(() => {
    const savedNickname = window.localStorage.getItem(NICKNAME_STORAGE_KEY);

    if (savedNickname && savedNickname.trim()) {
      const trimmed = savedNickname.trim();
      setNickname(trimmed);
      setInitialInput(trimmed);
      setMenuInput(trimmed);
      return;
    }

    setIsInitialDialogOpen(true);
  }, []);

  const saveNickname = useCallback((rawValue: string) => {
    const trimmed = rawValue.trim();

    if (!trimmed) {
      return null;
    }

    window.localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed);
    setNickname(trimmed);
    setInitialInput(trimmed);
    setMenuInput(trimmed);
    setIsInitialDialogOpen(false);

    return trimmed;
  }, []);

  return {
    nickname,
    initialInput,
    menuInput,
    isInitialDialogOpen,
    setInitialInput,
    setMenuInput,
    setIsInitialDialogOpen,
    saveNickname,
  };
}

function useSplashState() {
  const splashTimerRef = useRef<number | null>(null);
  const [showSplash, setShowSplash] = useState(true);
  const [splashFading, setSplashFading] = useState(false);

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

  useEffect(() => {
    return () => {
      clearSplashTimer();
    };
  }, [clearSplashTimer]);

  return {
    showSplash,
    splashFading,
    showSplashNow,
    hideSplashWithFade,
  };
}

function useViewerVideoUi(
  videoRef: RefObject<HTMLVideoElement | null>,
  onError: (message: string) => void,
) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = isMuted;
  }, [isMuted, videoRef]);

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
  }, [videoRef]);

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
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError, videoRef]);

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
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError, videoRef]);

  const toggleMute = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const nextMuted = !isMuted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);

    if (nextMuted) return;

    try {
      await video.play();
    } catch {
      // autoplay policy may block playback when unmuting
    }
  }, [isMuted, videoRef]);

  return {
    isFullscreen,
    isPipActive,
    isMuted,
    togglePictureInPicture,
    toggleFullscreen,
    toggleMute,
  };
}

function useViewerConnection({
  ticket,
  nickname,
  isMuted,
  videoRef,
  onConnecting,
  onConnectError,
}: {
  ticket: string;
  nickname: string;
  isMuted: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onConnecting: () => void;
  onConnectError: () => void;
}) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectAttemptRef = useRef(0);
  const statusRef = useRef<ViewerStatus>("idle");
  const connectRef = useRef<() => Promise<void>>(async () => {});

  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [error, setError] = useState("");
  const [videoStats, setVideoStats] = useState<VideoStats>({
    width: null,
    height: null,
    fps: null,
  });

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

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
  }, [videoRef]);

  const prepareVideoElement = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      throw new Error("video element is not ready");
    }

    video.autoplay = true;
    video.muted = isMuted;
    video.playsInline = true;

    return video;
  }, [isMuted, videoRef]);

  const resumePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const currentStatus = statusRef.current;
    if (currentStatus !== "connected" && currentStatus !== "connecting") {
      return;
    }

    try {
      await video.play();
    } catch {
      // browser autoplay policy or transient media state
    }
  }, [videoRef]);

  const scheduleReconnect = useCallback(
    (delayMs = RECONNECT_DELAY_MS) => {
      if (reconnectTimerRef.current !== null) return;
      if (!ticket.trim() || !nickname.trim()) return;

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void connectRef.current();
      }, delayMs);
    },
    [nickname, ticket],
  );

  const connect = useCallback(async () => {
    const actualTicket = ticket.trim();
    const actualNickname = nickname.trim();

    if (!actualTicket) {
      setError("ticket is empty");
      setStatus("error");
      return;
    }

    if (!actualNickname) {
      setError("ニックネームを設定してください");
      setStatus("idle");
      return;
    }

    const attemptId = ++connectAttemptRef.current;

    try {
      setError("");
      setStatus("connecting");
      onConnecting();
      clearReconnectTimer();
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
        if (pcRef.current !== pc) return;

        switch (pc.connectionState) {
          case "connected":
            clearReconnectTimer();
            setStatus("connected");
            void resumePlayback();
            return;
          case "connecting":
            setStatus("connecting");
            return;
          case "disconnected":
            setStatus("disconnected");
            scheduleReconnect();
            return;
          case "failed": {
            const classified = classifyViewerError("WebRTC connection failed");
            setStatus(classified.status);
            setError("WebRTC connection failed");
            if (classified.shouldReconnect) {
              scheduleReconnect();
            }
            return;
          }
          case "closed": {
            const classified = classifyViewerError("stream closed");
            setStatus(classified.status);
            setError("stream closed");
            if (classified.shouldReconnect) {
              scheduleReconnect();
            }
            return;
          }
          default:
            return;
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pcRef.current !== pc) return;

        if (pc.iceConnectionState === "failed") {
          const classified = classifyViewerError("ICE connection failed");
          setStatus(classified.status);
          setError("ICE connection failed");
          if (classified.shouldReconnect) {
            scheduleReconnect();
          }
        }
      };

      pc.ontrack = (event) => {
        if (pcRef.current !== pc) return;

        const [stream] = event.streams;
        const tracks = stream ? stream.getTracks() : [event.track];

        for (const mediaTrack of tracks) {
          const exists = remoteStream
            .getTracks()
            .some((existing) => existing.id === mediaTrack.id);

          if (!exists) {
            remoteStream.addTrack(mediaTrack);
          }
        }

        void resumePlayback();
      };

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);

      if (connectAttemptRef.current !== attemptId) {
        pc.close();
        return;
      }

      const responseJson = await connect_from_ticket(
        actualTicket,
        JSON.stringify({
          viewer_name: actualNickname,
          offer: pc.localDescription,
        }),
      );

      if (connectAttemptRef.current !== attemptId) {
        pc.close();
        return;
      }

      const response = JSON.parse(responseJson) as
        | SignalingAnswer
        | { type?: string; message?: string };

      if (response.type !== "answer" || !("answer" in response)) {
        throw new Error(response.message ?? "unexpected signaling response");
      }

      await pc.setRemoteDescription(response.answer);
      void resumePlayback();
    } catch (err) {
      if (connectAttemptRef.current !== attemptId) {
        return;
      }

      closeConnection();

      const message = err instanceof Error ? err.message : String(err);
      const classified = classifyViewerError(message);

      setStatus(classified.status);
      setError(message);
      onConnectError();

      if (classified.shouldReconnect) {
        scheduleReconnect();
      }
    }
  }, [
    clearReconnectTimer,
    closeConnection,
    isMuted,
    nickname,
    onConnectError,
    onConnecting,
    prepareVideoElement,
    resumePlayback,
    scheduleReconnect,
    ticket,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

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
      // ignore stats polling errors
    }
  }, [videoRef]);

  useEffect(() => {
    if (status !== "connected" && status !== "connecting") {
      setVideoStats({
        width: null,
        height: null,
        fps: null,
      });
      return;
    }

    const timerId = window.setInterval(() => {
      void updateVideoStats();
    }, 1000);

    void updateVideoStats();

    return () => {
      window.clearInterval(timerId);
    };
  }, [status, updateVideoStats]);

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

    const onPause = () => scheduleResume(100);
    const onEnded = () => scheduleResume(100);
    const onStalled = () => scheduleResume(300);
    const onSuspend = () => scheduleResume(300);
    const onWaiting = () => scheduleResume(300);
    const onCanPlay = () => scheduleResume(0);

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
  }, [resumePlayback, videoRef]);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      connectAttemptRef.current += 1;
      closeConnection();
    };
  }, [clearReconnectTimer, closeConnection]);

  return {
    status,
    error,
    videoStats,
    connect,
    setError,
  };
}

function SplashScreen({
  show,
  fading,
  status,
}: {
  show: boolean;
  fading: boolean;
  status: ViewerStatus;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1, scale: 1 }}
          animate={{
            opacity: fading ? 0 : 1,
            scale: fading ? 1.02 : 1,
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
  );
}

function InitialNicknameDialog({
  open,
  value,
  onChange,
  onSave,
}: {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open}>
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
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="nickname"
            className="border-white/10 bg-black/30 text-white placeholder:text-white/30"
          />

          <Button className="w-full" onClick={onSave}>
            保存して開始
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ViewerMenuSheet({
  open,
  onOpenChange,
  nickname,
  onNicknameChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nickname: string;
  onNicknameChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
              value={nickname}
              onChange={(e) => onNicknameChange(e.target.value)}
              placeholder="nickname"
              className="border-white/10 bg-black/30 text-white placeholder:text-white/30"
            />
          </div>

          <Button className="w-full" onClick={onSave}>
            ニックネームを保存
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VideoStatsBadge({ stats }: { stats: VideoStats }) {
  const hasStats = stats.width && stats.height && stats.fps;
  if (!hasStats) return null;

  return (
    <div className="rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-xs text-white/75 backdrop-blur-md">
      {stats.width}×{stats.height} · {Math.round(stats.fps ?? 0)} fps
    </div>
  );
}

export function ViewerPage() {
  const ticket = readTicketFromHash();
  if (!ticket) {
    return <Navigate to="/" replace />;
  }

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const startedTicketRef = useRef<string | null>(null);

  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const {
    nickname,
    initialInput,
    menuInput,
    isInitialDialogOpen,
    setInitialInput,
    setMenuInput,
    setIsInitialDialogOpen,
    saveNickname,
  } = usePersistentNickname();

  const [controlError, setControlError] = useState("");
  const {
    isFullscreen,
    isPipActive,
    isMuted,
    togglePictureInPicture,
    toggleFullscreen,
    toggleMute,
  } = useViewerVideoUi(videoRef, setControlError);

  const splash = useSplashState();
  const { showSplash, splashFading, showSplashNow, hideSplashWithFade } =
    splash;

  const { status, error, videoStats, connect, setError } = useViewerConnection({
    ticket,
    nickname,
    isMuted,
    videoRef,
    onConnecting: showSplashNow,
    onConnectError: () => hideSplashWithFade(0),
  });

  useEffect(() => {
    if (controlError) {
      setError(controlError);
    }
  }, [controlError, setError]);

  useEffect(() => {
    if (status === "connected") {
      hideSplashWithFade(150);
      return;
    }

    if (status === "connecting") {
      showSplashNow();
    }
  }, [hideSplashWithFade, showSplashNow, status]);

  useEffect(() => {
    if (!nickname.trim()) return;
    if (startedTicketRef.current === ticket) return;

    startedTicketRef.current = ticket;
    void connect();
  }, [connect, nickname, ticket]);

  const handleSaveInitialNickname = useCallback(() => {
    const saved = saveNickname(initialInput);

    if (!saved) {
      setError("ニックネームを入力してください");
      setIsInitialDialogOpen(true);
      return;
    }

    setError("");
    startedTicketRef.current = null;
  }, [initialInput, saveNickname, setError, setIsInitialDialogOpen]);

  const handleSaveMenuNickname = useCallback(() => {
    const saved = saveNickname(menuInput);

    if (!saved) {
      setError("ニックネームを入力してください");
      return;
    }

    setError("");
    setIsMenuOpen(false);
    void connect();
  }, [connect, menuInput, saveNickname, setError]);

  const statusLabel = useMemo(() => getStatusLabel(status), [status]);
  const overlayMessage = useMemo(
    () => getOverlayMessage(status, error),
    [error, status],
  );
  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950 text-white">
      <InitialNicknameDialog
        open={isInitialDialogOpen}
        value={initialInput}
        onChange={setInitialInput}
        onSave={handleSaveInitialNickname}
      />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 -top-48 h-112 w-lg -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-32 h-80 w-[20rem] rounded-full bg-white/3 blur-3xl" />
      </div>

      <SplashScreen show={showSplash} fading={splashFading} status={status} />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ViewerMenuSheet
              open={isMenuOpen}
              onOpenChange={setIsMenuOpen}
              nickname={menuInput}
              onNicknameChange={setMenuInput}
              onSave={handleSaveMenuNickname}
            />

            <img
              src="/crabeam.png"
              alt="Crabeam"
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
                  muted={isMuted}
                  controls={false}
                  className="h-full w-full bg-black object-contain"
                />

                <div className="pointer-events-none absolute right-3 top-3 z-10">
                  <VideoStatsBadge stats={videoStats} />
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

            {/*
            {effectiveError ? (
              <Card className="mt-4 border-red-400/20 bg-red-400/10 text-red-100 shadow-none">
                <CardContent className="pt-6">
                  <pre className="whitespace-pre-wrap font-sans text-sm">
                    {effectiveError}
                  </pre>
                </CardContent>
              </Card>
            ) : null}
            */}
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
