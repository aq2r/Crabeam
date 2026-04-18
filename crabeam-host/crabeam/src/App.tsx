import { useEffect, useRef, useState } from "react";
import "./App.css";
import { attachCrabeemPreview } from "./preview";
import {
  getSessionSnapshot,
  startHosting,
  type HostInfo,
  type SessionSnapshot,
} from "./bindings";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium text-zinc-400">{label}</div>
      <div className="flex gap-1.5">
        <code className="flex-1 break-all rounded-md bg-zinc-800 px-2 py-1.5 text-[10px] leading-4 text-zinc-100">
          {value || "-"}
        </code>
        <button
          onClick={handleCopy}
          disabled={!value}
          className="rounded-md bg-zinc-700 px-2 py-1.5 text-[10px] text-white disabled:opacity-50"
        >
          {copied ? "OK" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [session, setSession] = useState<SessionSnapshot>({
    viewer_count: 0,
    viewers: [],
  });
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;

    async function boot() {
      try {
        setError("");
        setStatus("starting");

        const info = await startHosting();
        if (disposed) return;
        setHostInfo(info);

        if (videoRef.current) {
          const pc = await attachCrabeemPreview(
            videoRef.current,
            `http://127.0.0.1:${info.port}/preview/offer`,
          );

          if (disposed) {
            pc.close();
            return;
          }

          pcRef.current = pc;

          pc.onconnectionstatechange = () => {
            if (!disposed) {
              setStatus(pc.connectionState || "connected");
            }
          };
        }

        const refresh = async () => {
          try {
            const snapshot = await getSessionSnapshot();
            if (!disposed) setSession(snapshot);
          } catch (e) {
            if (!disposed) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }
        };

        await refresh();
        timer = window.setInterval(refresh, 2000);
        setStatus("ready");
      } catch (e) {
        if (!disposed) {
          setStatus("error");
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }

    boot();

    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, []);

  const whipUrl = hostInfo ? `http://127.0.0.1:${hostInfo.port}/whip` : "";
  const ticket = hostInfo?.ticket ?? "";

  return (
    <main className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="grid h-full grid-cols-[1.1fr_0.9fr] gap-2.5 p-2.5">
        <section className="flex min-h-0 flex-col rounded-xl bg-zinc-900 p-2.5 shadow">
          <div className="mb-2 flex items-center justify-between">
            <h1 className="text-xs font-semibold tracking-wide">
              Crabeem Host
            </h1>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
              {status}
            </span>
          </div>

          <div className="flex-1 overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-contain"
            />
          </div>

          {error ? (
            <pre className="mt-2 max-h-16 overflow-auto rounded-md bg-red-950/40 p-2 text-[10px] leading-4 text-red-300">
              {error}
            </pre>
          ) : null}
        </section>

        <aside className="flex min-h-0 flex-col gap-2.5">
          <section className="rounded-xl bg-zinc-900 p-3 shadow">
            <div className="text-[10px] font-medium text-zinc-400">Viewer</div>
            <div className="mt-1 text-3xl font-bold leading-none">
              {session.viewer_count}
            </div>

            <div className="mt-2">
              <div className="mb-1 text-[10px] font-medium text-zinc-400">
                Connected
              </div>
              <div className="max-h-20 overflow-auto rounded-md bg-zinc-800 p-2 text-[10px] leading-4 text-zinc-200">
                {session.viewers.length > 0 ? (
                  <ul className="space-y-0.5">
                    {session.viewers.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-zinc-400">No viewers</div>
                )}
              </div>
            </div>
          </section>

          <section className="flex-1 rounded-xl bg-zinc-900 p-3 shadow">
            <h2 className="mb-2 text-xs font-semibold tracking-wide">Share</h2>

            <div className="space-y-3">
              <CopyField label="OBS URL" value={whipUrl} />
              <CopyField
                label="Viewer URL"
                value={`https://crabeam.aquaquick.workers.dev/viewer#ticket=${ticket}`}
              />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
