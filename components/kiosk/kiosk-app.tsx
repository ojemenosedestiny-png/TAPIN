"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CloudOff, Maximize, Nfc, Settings, WifiOff, XCircle } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { initials } from "@/components/dashboard/person-avatar";
import { NFC_ERROR_MESSAGES, nfcSupported, startNfcScan, type NfcErrorKind } from "@/lib/nfc";
import { createWedgeReader } from "@/lib/keyboard-wedge";
import { enqueue, flushQueue, loadQueue, newClientId, saveQueue, type QueuedTap } from "@/lib/offline-queue";
import { speak, spokenGreeting } from "@/lib/greeting";
import { playError, playSuccess } from "@/lib/sound";
import { cn } from "@/lib/utils";
import type { TapResponse } from "@/app/api/tap/route";
import { clockSnapshot, readToken, subscribeClock, subscribeToken, writeToken } from "./kiosk-store";

const RESULT_MS = 3000;
const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 20_000;
const REQUEST_TIMEOUT_MS = 8000;

type SchoolInfo = { name: string; logo_url: string | null; timezone: string };
type Screen =
  | { kind: "idle" }
  | { kind: "result"; data: TapResponse }
  | { kind: "saved_offline" };

const noop = () => () => {};

async function api(path: string, token: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } finally {
    clearTimeout(t);
  }
}

export function KioskApp() {
  const token = useSyncExternalStore(subscribeToken, readToken, () => null);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  if (!hydrated) return <div className="min-h-dvh bg-brand" />;
  if (!token) return <Setup />;
  return <Kiosk token={token} />;
}

// ---------------------------------------------------------------------------
// First-time setup: paste the device token from Dashboard → Devices
// ---------------------------------------------------------------------------
function Setup({ message }: { message?: string }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(message ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    setBusy(true);
    setError(null);
    try {
      const res = await api("/api/kiosk", t);
      if (res.ok) writeToken(t);
      else setError((await res.json().catch(() => ({}))).error ?? "That token didn't work.");
    } catch {
      setError("No connection to TapIn. Check the internet and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-brand-dark via-brand to-teal-500 p-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-card p-8 shadow-xl">
        <Logo className="size-14" />
        <h1 className="mt-4 text-2xl font-semibold text-ink">Set up this kiosk</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          In the TapIn dashboard, go to <strong>Devices → Register kiosk</strong>, then paste the device token here. You only do this once.
        </p>
        <label htmlFor="token" className="mt-6 block text-sm font-medium text-ink">Device token</label>
        <input id="token" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false}
          className="mt-1.5 h-11 w-full rounded-lg border border-input px-3 font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" placeholder="tapin_dev_…" />
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={busy || value.trim().length < 20}
          className="mt-6 h-12 w-full rounded-lg bg-brand font-semibold text-white disabled:opacity-50">
          {busy ? "Checking…" : "Connect kiosk"}
        </button>
      </form>
    </main>
  );
}

// ---------------------------------------------------------------------------
// The kiosk
// ---------------------------------------------------------------------------
function Kiosk({ token }: { token: string }) {
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [deviceName, setDeviceName] = useState<string>("");
  const [screen, setScreen] = useState<Screen>({ kind: "idle" });
  const [scanning, setScanning] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const queueRef = useRef<QueuedTap[]>([]);
  const busyRef = useRef<Promise<void>>(Promise.resolve());
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopNfc = useRef<(() => void) | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const flushing = useRef(false);
  const supported = useSyncExternalStore(noop, nfcSupported, () => false);

  const show = (s: Screen) => {
    setScreen(s);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (s.kind !== "idle") resetTimer.current = setTimeout(() => setScreen({ kind: "idle" }), RESULT_MS);
  };

  const handleAuthFailure = (status: number, error?: string) => {
    if (status === 401) {
      writeToken(null);
      return true;
    }
    if (status === 403) {
      setFatal(error ?? "This kiosk has been revoked. Ask the school admin to register it again.");
      return true;
    }
    return false;
  };

  const persistQueue = (q: QueuedTap[]) => {
    queueRef.current = q;
    saveQueue(localStorage, q);
    setQueued(q.length);
  };

  const flush = async () => {
    if (flushing.current || queueRef.current.length === 0) return;
    flushing.current = true;
    try {
      const { remaining } = await flushQueue(queueRef.current, async (t) => {
        const res = await api("/api/tap", token, { method: "POST", body: JSON.stringify({ uid: t.uid, tapped_at: t.tapped_at, client_id: t.client_id }) });
        if (res.status === 401 || res.status === 403) return 500; // keep taps until the kiosk is fixed
        return res.status;
      });
      persistQueue(remaining);
      if (remaining.length === 0) setOnline(true);
    } finally {
      flushing.current = false;
    }
  };

  const onTap = (uid: string) => {
    // One tap at a time, in order.
    busyRef.current = busyRef.current.then(async () => {
      const tappedAt = new Date().toISOString();
      const clientId = newClientId();
      try {
        const res = await api("/api/tap", token, { method: "POST", body: JSON.stringify({ uid, tapped_at: tappedAt, client_id: clientId }) });
        if (res.status >= 500 || res.status === 429) throw new Error("server");
        const body = await res.json();
        if (!res.ok) {
          if (!handleAuthFailure(res.status, body.error)) show({ kind: "result", data: { action: "unknown", time: "" } });
          return;
        }
        setOnline(true);
        presentResult(body as TapResponse);
        void flush();
      } catch {
        // Offline or server trouble: keep the tap and send it later.
        setOnline(false);
        persistQueue(enqueue(queueRef.current, { client_id: clientId, uid, tapped_at: tappedAt }));
        playSuccess();
        show({ kind: "saved_offline" });
      }
    });
  };

  const presentResult = (data: TapResponse) => {
    show({ kind: "result", data });
    if (data.action === "unknown" || data.action === "blocked") {
      playError();
      speak("Card not recognised. Please see the admin office.");
    } else if (data.action === "signed_in" || data.action === "signed_out") {
      playSuccess();
      const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: school?.timezone ?? "Africa/Lagos" }).format(new Date()));
      speak(spokenGreeting(data.action, data.first_name ?? "", hour));
    } else {
      speak(data.reason === "already_signed_out" ? "You have already signed out." : "You are already signed in.");
    }
  };

  // Heartbeat + queue restore + periodic flush.
  useEffect(() => {
    queueRef.current = loadQueue(localStorage);
    setQueued(queueRef.current.length);
    let cancelled = false;
    const beat = async () => {
      try {
        const res = await api("/api/kiosk", token);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          if (!handleAuthFailure(res.status, body.error)) setOnline(false);
          return;
        }
        setSchool(body.school);
        setDeviceName(body.device.name);
        setOnline(true);
        void flush();
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    void beat();
    const hb = setInterval(beat, HEARTBEAT_MS);
    const fl = setInterval(() => void flush(), FLUSH_MS);
    const onOnline = () => void beat();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", () => setOnline(false));
    return () => {
      cancelled = true;
      clearInterval(hb);
      clearInterval(fl);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // USB keyboard-style readers work at all times.
  useEffect(() => {
    const read = createWedgeReader((uid) => onTap(uid));
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (read(e.key, e.timeStamp)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Keep the screen awake while scanning (re-acquired when the tab becomes visible again).
  useEffect(() => {
    if (!scanning) return;
    const acquire = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        // not supported / denied — screen-always-on setting covers it
      }
    };
    void acquire();
    const onVis = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void wakeLock.current?.release().catch(() => {});
    };
  }, [scanning]);

  useEffect(() => () => stopNfc.current?.(), []);

  const startScanning = async () => {
    setNfcError(null);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // fullscreen is optional
    }
    // Prime speech on a user gesture so later greetings are allowed to play.
    speak(" ");
    if (supported) {
      let failed = false;
      stopNfc.current = await startNfcScan({
        onUid: onTap,
        onError: (kind: NfcErrorKind) => {
          if (kind === "read_failed") return;
          failed = true;
          setNfcError(NFC_ERROR_MESSAGES[kind]);
          setScanning(false);
        },
      });
      if (!failed) setScanning(true);
    } else {
      setScanning(true); // USB reader mode
    }
  };

  if (fatal) {
    return (
      <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-900 p-8 text-center text-white">
        <XCircle className="size-20 text-red-400" aria-hidden />
        <h1 className="text-4xl font-semibold">Kiosk not active</h1>
        <p className="max-w-lg text-xl text-white/80">{fatal}</p>
        <button className="rounded-lg bg-white/10 px-5 py-3 text-lg" onClick={() => { writeToken(null); setFatal(null); }}>Set up again</button>
      </main>
    );
  }

  return (
    <main id="main" className="relative min-h-dvh select-none overflow-hidden">
      {screen.kind === "idle" && (
        <Idle school={school} deviceName={deviceName} scanning={scanning} supported={supported} nfcError={nfcError} onStart={startScanning} />
      )}
      {screen.kind === "result" && <Result data={screen.data} />}
      {screen.kind === "saved_offline" && <SavedOffline />}

      {/* Status badges */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
        {(!online || queued > 0) && (
          <span className="flex items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 shadow" role="status">
            <WifiOff className="size-4" aria-hidden /> Offline — taps are being saved{queued ? ` (${queued})` : ""}
          </span>
        )}
      </div>

      {screen.kind === "idle" && (
        <div className="absolute bottom-4 right-4 flex gap-2">
          <button aria-label="Full screen" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} className="rounded-full bg-white/10 p-3 text-white/70 hover:bg-white/20">
            <Maximize className="size-5" />
          </button>
          <button aria-label="Kiosk settings" onClick={() => setShowSettings(true)} className="rounded-full bg-white/10 p-3 text-white/70 hover:bg-white/20">
            <Settings className="size-5" />
          </button>
        </div>
      )}

      {showSettings && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/70 p-6" role="dialog" aria-modal="true" aria-label="Kiosk settings">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 text-ink shadow-xl">
            <h2 className="text-xl font-semibold">Kiosk settings</h2>
            <p className="mt-2 text-sm text-muted-foreground">{deviceName || "This kiosk"} · {school?.name ?? "Connecting…"}</p>
            {queued > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">{queued} taps waiting to send. Don&apos;t disconnect the kiosk until they&apos;re sent.</p>}
            <div className="mt-6 flex flex-col gap-2">
              <button className="h-11 rounded-lg bg-brand font-semibold text-white" onClick={() => setShowSettings(false)}>Back to scanning</button>
              <button className="h-11 rounded-lg border border-red-200 font-semibold text-red-700"
                onClick={() => { if (confirm("Disconnect this kiosk? You'll need a device token to set it up again.")) { writeToken(null); } }}>
                Disconnect kiosk
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Clock({ timeZone }: { timeZone: string }) {
  const sec = useSyncExternalStore(subscribeClock, clockSnapshot, () => 0);
  if (!sec) return <div className="h-32" />;
  const d = new Date(sec * 1000);
  const time = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(d);
  const date = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone }).format(d);
  return (
    <div className="text-center">
      <p className="text-7xl font-semibold tabular-nums tracking-tight sm:text-8xl">{time.toUpperCase()}</p>
      <p className="mt-2 text-2xl text-white/85">{date}</p>
    </div>
  );
}

function Idle({ school, deviceName, scanning, supported, nfcError, onStart }: {
  school: SchoolInfo | null; deviceName: string; scanning: boolean; supported: boolean; nfcError: string | null; onStart: () => void;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-between bg-gradient-to-br from-brand-dark via-brand to-teal-500 px-6 py-10 text-white">
      <header className="flex flex-col items-center gap-3 text-center">
        {school?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={school.logo_url} alt="" className="size-20 rounded-2xl bg-white object-contain p-2" />
        ) : (
          <Logo variant="inverse" className="size-20 shadow-lg" />
        )}
        <p className="text-2xl font-semibold">{school?.name ?? "TapIn"}</p>
        {deviceName && <p className="text-sm text-white/70">{deviceName}</p>}
      </header>

      <Clock timeZone={school?.timezone ?? "Africa/Lagos"} />

      <div className="flex flex-col items-center gap-6">
        {scanning ? (
          <>
            <div className="relative flex size-48 items-center justify-center">
              <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-white/20 motion-reduce:hidden" />
              <span aria-hidden className="absolute inset-4 rounded-full bg-white/10" />
              <div className="relative flex h-24 w-36 items-center justify-center rounded-2xl bg-white shadow-2xl">
                <Nfc className="size-12 text-brand" aria-hidden />
              </div>
            </div>
            <p className="text-4xl font-semibold">Tap your ID card</p>
            {!supported && <p className="text-white/70">USB card reader mode</p>}
          </>
        ) : (
          <>
            <button onClick={onStart} className="flex h-20 items-center gap-3 rounded-2xl bg-white px-10 text-2xl font-semibold text-brand shadow-xl active:scale-95">
              <Nfc className="size-8" aria-hidden /> Start scanning
            </button>
            <p className="max-w-md text-center text-white/80">
              {supported ? "Tap once each morning. The kiosk then keeps listening for cards." : "This browser can't use NFC. Plug in a USB card reader, or use Chrome on an Android phone."}
            </p>
          </>
        )}
        {nfcError && <p role="alert" className="max-w-md rounded-xl bg-red-600/90 px-5 py-3 text-center text-lg">{nfcError}</p>}
      </div>
    </div>
  );
}

function Result({ data }: { data: TapResponse }) {
  if (data.action === "unknown" || data.action === "blocked") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-danger px-6 text-center text-white" role="alert">
        <XCircle className="size-32" aria-hidden />
        <p className="text-5xl font-semibold sm:text-6xl">Card not recognised</p>
        <p className="text-2xl text-white/90">Please see the admin office.</p>
      </div>
    );
  }

  const isOut = data.action === "signed_out";
  const dup = data.action === "duplicate";
  const status = dup
    ? data.reason === "already_signed_out" ? "Already signed out" : data.reason === "already_signed_in" ? "Already signed in" : "Already tapped"
    : isOut ? "Signed out" : "Signed in";

  return (
    <div className={cn("flex min-h-dvh flex-col items-center justify-center px-6 text-center text-white", dup ? "bg-brand" : "bg-success")} role="status">
      <div className="size-56 overflow-hidden rounded-full border-8 border-white/80 bg-white/20 shadow-2xl sm:size-72">
        {data.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.photo_url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-7xl font-semibold">{initials(data.name ?? "?")}</span>
        )}
      </div>
      {!dup && !isOut && data.greeting && <p className="mt-6 text-3xl text-white/90">{data.greeting},</p>}
      {isOut && <p className="mt-6 text-3xl text-white/90">Goodbye,</p>}
      <p className={cn("text-5xl font-semibold leading-tight sm:text-6xl", dup && "mt-6")}>{data.name}</p>
      {data.late && (
        <p className="mt-4 rounded-full bg-warn px-6 py-2 text-2xl font-semibold text-amber-950">Late arrival</p>
      )}
      <p className="mt-4 text-2xl text-white/90">{data.class}</p>
      <p className="mt-6 text-3xl font-semibold tabular-nums">{status} · {data.time}</p>
    </div>
  );
}

function SavedOffline() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-amber-500 px-6 text-center text-amber-950" role="status">
      <CloudOff className="size-28" aria-hidden />
      <p className="text-5xl font-semibold">Tap saved</p>
      <p className="max-w-xl text-2xl">No connection right now. Your tap will be sent as soon as the kiosk is back online.</p>
    </div>
  );
}
