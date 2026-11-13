"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, BookOpen, Check, CloudOff, Delete, KeyRound, LogOut, Maximize, Nfc, Play, Settings, QrCode, ShieldX, Siren, Volume2, WifiOff, XCircle } from "lucide-react";
import { Logo, TapInWord } from "@/components/brand/logo";
import { Ripple } from "@/components/brand/ripple";
import { PoweredBy } from "@/components/brand/powered-by";
import { initials } from "@/components/dashboard/person-avatar";
import { NFC_ERROR_MESSAGES, nfcSupported, startNfcScan, type NfcErrorKind } from "@/lib/nfc";
import { createWedgeReader } from "@/lib/keyboard-wedge";
import { enqueue, flushQueue, loadQueue, newClientId, saveQueue, type QueuedTap } from "@/lib/offline-queue";
import { speak, warmUpVoices } from "@/lib/greeting";
import { phraseForTap, phraseText, type Phrase } from "@/lib/voice-phrases";
import { prefetchPhrases, sayPhrase } from "@/lib/voice-client";
import { play, soundLengthMs, unlockAudio } from "@/lib/sound";
import { cn } from "@/lib/utils";
import type { LessonChoice, TapResponse } from "@/app/api/tap/route";
import { FLAG_LABEL, formatMinutes } from "@/lib/lessons";
import { createQrReader } from "@/lib/qr-reader";
import { clockSnapshot, readToken, subscribeClock, subscribeToken, writeToken } from "./kiosk-store";

/** How long a tap's result stays on screen before the kiosk is ready for the next child. */
const RESULT_MS = 4000;
/** The teacher menu waits this long for a choice (each touch restarts it). */
const MENU_MS = 15_000;
/** Pickup confirmation and code entry wait longer: staff check faces before releasing a child. */
const PICKUP_MS = 60_000;
/** How often the kiosk checks for a roll call (faster while one is running). */
const EMERGENCY_POLL_MS = 10_000;
const EMERGENCY_POLL_ACTIVE_MS = 4_000;

type EmergencyState = { available: boolean; active: { id: string; kind: "real" | "drill"; started_at: string; counts: { total: number; safe: number; missing: number } } | null };
const HEARTBEAT_MS = 60_000;
const FLUSH_MS = 20_000;
const REQUEST_TIMEOUT_MS = 8000;

type SchoolInfo = { name: string; logo_url: string | null; timezone: string };
type Screen =
  | { kind: "idle" }
  | { kind: "result"; data: TapResponse }
  | { kind: "menu"; data: TapResponse; error?: string }
  | { kind: "pickup"; data: TapResponse; error?: string }
  | { kind: "code"; error?: string }
  | { kind: "pin"; error?: string }
  | { kind: "qr"; error?: string }
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
    <main id="main" className="theme-light relative flex min-h-dvh flex-col items-center justify-center gap-8 overflow-hidden bg-[#03201e] p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_600px_at_80%_-10%,rgb(45_212_191/0.32),transparent_60%),radial-gradient(700px_500px_at_10%_110%,rgb(245_158_11/0.16),transparent_60%)]" />
      <form onSubmit={submit} className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
        <Logo className="size-14" animated />
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
      <PoweredBy onDark className="relative" />
    </main>
  );
}

// ---------------------------------------------------------------------------
// The kiosk
// ---------------------------------------------------------------------------
function Kiosk({ token }: { token: string }) {
  // Last known school (name and timezone) so an offline start still shows the right school.
  const [school, setSchool] = useState<SchoolInfo | null>(() => {
    try {
      const raw = localStorage.getItem("tapin.kiosk.school");
      return raw ? ({ ...JSON.parse(raw), logo_url: null } as SchoolInfo) : null;
    } catch {
      return null;
    }
  });
  const [deviceName, setDeviceName] = useState<string>("");
  const [screen, setScreen] = useState<Screen>({ kind: "idle" });
  const [scanning, setScanning] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [fatal, setFatal] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [emergency, setEmergency] = useState<EmergencyState>({ available: false, active: null });

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
    if (s.kind !== "idle") resetTimer.current = setTimeout(() => setScreen({ kind: "idle" }), s.kind === "menu" ? MENU_MS : s.kind === "pickup" || s.kind === "code" || s.kind === "pin" || s.kind === "qr" ? PICKUP_MS : RESULT_MS);
  };

  /** A one-day pickup code typed on the kiosk. */
  const submitCode = async (code: string) => {
    try {
      const res = await api("/api/pickup/code", token, { method: "POST", body: JSON.stringify({ code }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) return presentResult(out as TapResponse);
      if (handleAuthFailure(res.status, out.error)) return;
      play("error");
      show({ kind: "code", error: out.error ?? "That code didn't work." });
    } catch {
      show({ kind: "code", error: "No connection. Pickup needs the kiosk to be online." });
    }
  };

  /** A pickup QR code seen by the camera (a person's pass, or a one-day code). */
  const submitQr = async (text: string) => {
    try {
      const res = await api("/api/pickup/qr", token, { method: "POST", body: JSON.stringify({ text }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) return presentResult(out as TapResponse);
      if (handleAuthFailure(res.status, out.error)) return;
      play("error");
      show({ kind: "qr", error: out.error ?? "That QR code didn't work." });
    } catch {
      show({ kind: "qr", error: "No connection. Pickup needs the kiosk to be online." });
    }
  };

  /** Staff confirmed which children are leaving. */
  const confirmPickup = async (data: TapResponse, studentIds: string[]) => {
    try {
      const res = await api("/api/pickup", token, { method: "POST", body: JSON.stringify({ tap_id: data.tap_id, student_ids: studentIds }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) return presentResult(out as TapResponse);
      if (handleAuthFailure(res.status, out.error)) return;
      show({ kind: "pickup", data, error: out.error ?? "That didn't work. Please try again." });
    } catch {
      show({ kind: "pickup", data, error: "No connection. Pickup needs the kiosk to be online." });
    }
  };

  /** The teacher chose on the menu: start a lesson or sign out. Times are set by the server. */
  const choose = async (data: TapResponse, body: { choice: "start"; class_id: string; subject_id: string } | { choice: "sign_out" }) => {
    try {
      const res = await api("/api/lesson", token, { method: "POST", body: JSON.stringify({ tap_id: data.tap_id, ...body }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) return presentResult(out as TapResponse);
      if (handleAuthFailure(res.status, out.error)) return;
      show({ kind: "menu", data, error: out.error ?? "That didn't work. Please try again." });
    } catch {
      show({ kind: "menu", data, error: "No connection. Lessons can't start while the kiosk is offline." });
    }
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
        play("saved");
        show({ kind: "saved_offline" });
      }
    });
  };

  /** The school voice (ElevenLabs) when set up, otherwise the device voice: same words either way. */
  const say = (p: Phrase, delayMs: number) => void sayPhrase(p, phraseText(p), { token, delayMs });

  const presentResult = (data: TapResponse) => {
    const name = data.first_name ?? "";
    if (data.action === "pickup") {
      show({ kind: "pickup", data });
      play("duplicate");
      say({ kind: "pickup_wait" }, soundLengthMs("duplicate"));
      return;
    }
    if (data.action === "safe") {
      if (data.counts) setEmergency((e) => (e.active ? { ...e, active: { ...e.active, counts: data.counts! } } : e));
      show({ kind: "result", data });
      play("signIn");
      say({ kind: "safe", name }, soundLengthMs("signIn"));
      return;
    }
    if (data.action === "picked_up") {
      show({ kind: "result", data });
      play("signOut");
      say({ kind: "pickup", name: (data.name ?? "").split(" ")[0] ?? "", child: data.spoken ?? "" }, soundLengthMs("signOut"));
      return;
    }
    if (data.action === "not_authorised") {
      show({ kind: "result", data });
      play("error");
      say({ kind: "not_authorised" }, soundLengthMs("error"));
      return;
    }
    if (data.action === "menu") {
      show({ kind: "menu", data });
      play("duplicate");
      say({ kind: "choose", name }, soundLengthMs("duplicate"));
      return;
    }
    show({ kind: "result", data });
    if (data.action === "lesson_started" || data.action === "lesson_ended") {
      const sound = data.action === "lesson_started" ? "signIn" : "signOut";
      play(sound);
      say({ kind: data.action === "lesson_started" ? "lesson_start" : "lesson_end", name }, soundLengthMs(sound));
    } else if (data.action === "unknown" || data.action === "blocked") {
      play("error");
      say({ kind: "unknown" }, soundLengthMs("error"));
    } else if (data.action === "signed_in" || data.action === "signed_out") {
      const sound = data.action === "signed_in" ? "signIn" : "signOut";
      play(sound);
      say(phraseForTap(data.action, data.first_name ?? "", localHour(school?.timezone)), soundLengthMs(sound));
    } else {
      play("duplicate");
      say({ kind: data.reason === "already_signed_out" ? "already_out" : "already_in" }, soundLengthMs("duplicate"));
    }
  };

  // Heartbeat + queue restore + periodic flush.
  useEffect(() => {
    document.documentElement.classList.remove("dark"); // the kiosk has its own colours
    warmUpVoices();
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
        try {
          localStorage.setItem("tapin.kiosk.school", JSON.stringify({ name: body.school.name, timezone: body.school.timezone }));
        } catch {
          // storage blocked: the school name shows once online
        }
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

  // Emergency roll call: started here (PIN) or from the dashboard; checked every few seconds.
  const emergencyActive = !!emergency.active;
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await api("/api/emergency", token);
        if (res.ok && !cancelled) setEmergency(await res.json());
      } catch {
        // offline: keep showing the last known state
      }
    };
    void check();
    const t = setInterval(check, emergencyActive ? EMERGENCY_POLL_ACTIVE_MS : EMERGENCY_POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [token, emergencyActive]);

  const startEmergency = async (pin: string, kind: "real" | "drill") => {
    try {
      const res = await api("/api/emergency", token, { method: "POST", body: JSON.stringify({ pin, kind }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok) {
        setEmergency(out as EmergencyState);
        show({ kind: "idle" });
        play("error");
        say({ kind: "emergency" }, soundLengthMs("error"));
        return;
      }
      if (handleAuthFailure(res.status, out.error)) return;
      show({ kind: "pin", error: out.error ?? "That didn't work." });
    } catch {
      show({ kind: "pin", error: "No connection. Start the roll call from the dashboard or by phone." });
    }
  };

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

  // Offline start: a service worker keeps a copy of the kiosk on the device (kiosk pages only).
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/kiosk" }).catch(() => {});
  }, []);

  const startScanning = async () => {
    setNfcError(null);
    // NFC FIRST, before anything else is awaited. Chrome only asks for NFC permission during the tap itself;
    // going full screen first uses that tap up, and Chrome then refuses NFC without asking.
    let failed = false;
    const nfc = supported
      ? startNfcScan({
          onUid: onTap,
          onError: (kind: NfcErrorKind) => {
            if (kind === "read_failed") return;
            failed = true;
            setNfcError(NFC_ERROR_MESSAGES[kind]);
            setScanning(false);
          },
        })
      : null;
    // Prime audio and speech on the same tap so later greetings are allowed to play.
    unlockAudio();
    speak(" ");
    prefetchPhrases([{ kind: "unknown" }, { kind: "already_in" }, { kind: "already_out" }], token);
    if (nfc) {
      stopNfc.current = await nfc;
      if (failed) return;
    }
    setScanning(true);
    // Full screen last, and optional (the corner button does it too).
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  /** Plays exactly what a child hears at the gate, so the volume can be set before the first morning. */
  const testSound = () => {
    unlockAudio();
    play("signIn");
    say(phraseForTap("signed_in", "Chioma", localHour(school?.timezone)), soundLengthMs("signIn"));
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
    <main id="main" className="theme-light relative min-h-dvh select-none overflow-hidden">
      {screen.kind === "idle" && emergency.active && (
        <Assembly active={emergency.active} scanning={scanning} onStart={startScanning} />
      )}
      {screen.kind === "idle" && !emergency.active && (
        <Idle school={school} deviceName={deviceName} scanning={scanning} supported={supported} nfcError={nfcError} onStart={startScanning} onTestSound={testSound} onPickupCode={() => show({ kind: "code" })} onScanQr={() => show({ kind: "qr" })}
          onEmergency={emergency.available ? () => show({ kind: "pin" }) : undefined} />
      )}
      {screen.kind === "result" && <Result key={screen.data.time + (screen.data.name ?? "") + screen.data.action} data={screen.data} place={deviceName || school?.name || "TapIn"} />}
      {screen.kind === "menu" && (
        <TeacherMenu key={String(screen.data.tap_id) + (screen.error ?? "")} data={screen.data} error={screen.error}
          onActivity={() => show(screen)} onCancel={() => show({ kind: "idle" })}
          onStart={(c) => void choose(screen.data, { choice: "start", class_id: c.class_id, subject_id: c.subject_id })}
          onSignOut={() => void choose(screen.data, { choice: "sign_out" })} />
      )}
      {screen.kind === "saved_offline" && <SavedOffline />}
      {screen.kind === "pickup" && (
        <PickupConfirm key={String(screen.data.tap_id) + (screen.error ?? "")} data={screen.data} error={screen.error}
          onActivity={() => show(screen)} onCancel={() => show({ kind: "idle" })} onConfirm={(ids) => void confirmPickup(screen.data, ids)} />
      )}
      {screen.kind === "pin" && (
        <PinEntry key={screen.error ?? "pin"} error={screen.error} onActivity={() => show(screen)} onCancel={() => show({ kind: "idle" })} onSubmit={(p, k) => void startEmergency(p, k)} />
      )}
      {screen.kind === "qr" && (
        <QrScan key={screen.error ?? "qr"} error={screen.error} onCancel={() => show({ kind: "idle" })} onCode={(t) => void submitQr(t)} onCodeEntry={() => show({ kind: "code" })} />
      )}
      {screen.kind === "code" && (
        <CodeEntry key={screen.error ?? "code"} error={screen.error} onActivity={() => show(screen)} onCancel={() => show({ kind: "idle" })} onSubmit={(c) => void submitCode(c)} />
      )}

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
  if (!sec) return <div className="h-28" />;
  const d = new Date(sec * 1000);
  const time = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(d);
  const date = new Intl.DateTimeFormat("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone }).format(d);
  return (
    <div className="text-center">
      <p className="font-heading text-7xl font-extrabold tabular-nums tracking-tight text-slate-900 sm:text-8xl">{time.toUpperCase()}</p>
      <p className="mt-1 text-2xl text-slate-500">{date}</p>
    </div>
  );
}

function localHour(timeZone = "Africa/Lagos") {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date()));
}

/** The light kiosk: one white card on a soft mint ground, like the kiosk on the TapIn website. */
function KioskStage({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden bg-[#edf3f1] px-4 py-8 text-slate-900">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(1000px_700px_at_85%_-15%,rgb(45_212_191/0.22),transparent_60%),radial-gradient(800px_600px_at_0%_110%,rgb(245_158_11/0.10),transparent_60%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgb(15_118_110/0.18)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      {children}
      {footer}
    </div>
  );
}

function KioskCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative w-[min(94vw,46rem)] overflow-hidden rounded-[36px] bg-white px-7 pb-8 pt-6 shadow-[0_50px_100px_-40px_rgb(12_74_68/0.45),0_18px_40px_-24px_rgb(12_74_68/0.25)] ring-1 ring-slate-900/[0.06] sm:px-10", className)}>
      {children}
    </div>
  );
}

function CardTop({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-lg font-semibold text-slate-500">
      <span className="truncate">{left}</span>
      <span className="shrink-0 tabular-nums">{right}</span>
    </div>
  );
}

function TapHint({ text }: { text: string }) {
  return (
    <p className="flex items-center justify-center gap-2.5 text-xl font-semibold text-brand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="size-7" aria-hidden><path d="M8.5 9a4 4 0 0 1 0 6" /><path d="M12 6.5a8 8 0 0 1 0 11" /><path d="M15.5 4a12 12 0 0 1 0 16" /></svg>
      {text}
    </p>
  );
}

function Idle({ school, deviceName, scanning, supported, nfcError, onStart, onTestSound, onPickupCode, onScanQr, onEmergency }: {
  school: SchoolInfo | null; deviceName: string; scanning: boolean; supported: boolean; nfcError: string | null; onStart: () => void; onTestSound: () => void; onPickupCode: () => void; onScanQr: () => void; onEmergency?: () => void;
}) {
  const action = "flex items-center gap-2 rounded-full bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/10 transition hover:bg-slate-50 active:scale-95";
  return (
    <KioskStage footer={<PoweredBy className="relative" />}>
      <KioskCard className="kiosk-pop">
        <CardTop
          left={
            <span className="flex items-center gap-3">
              {school?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={school.logo_url} alt="" className="size-11 rounded-xl bg-white object-contain p-1 ring-1 ring-slate-900/10" />
              ) : (
                <Logo className="size-11" animated />
              )}
              <span className="truncate text-xl font-bold text-slate-900">{school?.name ?? "TapIn"}</span>
            </span>
          }
          right={deviceName}
        />

        <div className="mt-6"><Clock timeZone={school?.timezone ?? "Africa/Lagos"} /></div>

        <div className="mt-6 flex flex-col items-center gap-5">
          {scanning ? (
            <>
              {/* The scan target: a card floating in its own NFC field. */}
              <div className="relative flex size-[min(70vw,28vh,20rem)] items-center justify-center">
                <Ripple rings={4} durationMs={4200} still={3} className="text-brand/60" ringClassName="[border-width:2px]" />
                <span aria-hidden className="kiosk-breathe absolute size-[55%] rounded-full bg-teal-300/40 blur-3xl" />
                <div className="kiosk-float relative">
                  <div className="relative h-32 w-52 overflow-hidden rounded-[20px] bg-gradient-to-br from-white via-white to-teal-50 shadow-[0_26px_50px_-18px_rgb(12_74_68/0.55),0_0_0_1px_rgb(15_118_110/0.12)]">
                    <span aria-hidden className="absolute left-5 top-5 h-6 w-8 rounded-md bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 ring-1 ring-amber-600/30" />
                    <Nfc className="absolute right-5 top-5 size-6 text-brand" aria-hidden />
                    <span aria-hidden className="absolute bottom-9 left-5 h-2 w-24 rounded-full bg-slate-200" />
                    <span aria-hidden className="absolute bottom-5 left-5 h-2 w-14 rounded-full bg-slate-200" />
                    <TapInWord className="absolute bottom-4 right-5 text-sm" />
                    <span aria-hidden className="kiosk-sweep absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/90 to-transparent" />
                  </div>
                </div>
              </div>
              <p className="font-heading text-4xl font-extrabold tracking-tight sm:text-5xl">Tap your ID card</p>
              <p className="flex items-center gap-2 text-base font-medium text-slate-500" aria-hidden>
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => <span key={i} className="kiosk-signal size-1.5 rounded-full bg-brand" style={{ "--d": `${i * 200}ms` } as React.CSSProperties} />)}
                </span>
                {supported ? "Listening for cards" : "USB card reader mode"}
              </p>
            </>
          ) : (
            <>
              <button onClick={onStart} className="flex h-20 items-center gap-3 rounded-2xl bg-brand px-10 text-2xl font-semibold text-white shadow-[0_20px_40px_-16px_rgb(15_118_110/0.8)] transition-transform active:scale-95">
                <Nfc className="size-8" aria-hidden /> Start scanning
              </button>
              <p className="max-w-md text-center text-lg text-slate-500">
                {supported ? "Tap once each morning. The kiosk then keeps listening for cards." : "This browser can't use NFC. Plug in a USB card reader, or use Chrome on an Android phone."}
              </p>
            </>
          )}
        </div>
        {nfcError && <p role="alert" className="mx-auto mt-5 max-w-md rounded-xl bg-red-50 px-5 py-3 text-center text-lg font-medium text-red-800 ring-1 ring-red-200">{nfcError}</p>}
      </KioskCard>

      <div className="relative flex flex-wrap justify-center gap-2.5">
        <button onClick={onTestSound} className={action}><Volume2 className="size-5" aria-hidden /> Test sound</button>
        {scanning && <button onClick={onPickupCode} className={action}><KeyRound className="size-5" aria-hidden /> Pickup code</button>}
        {scanning && <button onClick={onScanQr} className={action}><QrCode className="size-5" aria-hidden /> Scan QR</button>}
        {scanning && onEmergency && (
          <button onClick={onEmergency} className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-95">
            <Siren className="size-5" aria-hidden /> Emergency
          </button>
        )}
      </div>
    </KioskStage>
  );
}

type Tone = { ring: string; wave: string; pill: string; bar: string };
const TONES: Record<"in" | "late" | "out" | "dup" | "lesson" | "ended", Tone> = {
  in: { ring: "border-green-600", wave: "text-green-600", pill: "bg-green-100 text-green-800", bar: "bg-green-600" },
  late: { ring: "border-amber-500", wave: "text-amber-500", pill: "bg-amber-100 text-amber-900", bar: "bg-amber-500" },
  out: { ring: "border-sky-600", wave: "text-sky-600", pill: "bg-sky-100 text-sky-900", bar: "bg-sky-600" },
  dup: { ring: "border-slate-300", wave: "text-slate-400", pill: "bg-slate-100 text-slate-700", bar: "bg-slate-400" },
  lesson: { ring: "border-teal-600", wave: "text-teal-600", pill: "bg-teal-100 text-teal-900", bar: "bg-teal-600" },
  ended: { ring: "border-indigo-600", wave: "text-indigo-600", pill: "bg-indigo-100 text-indigo-900", bar: "bg-indigo-600" },
};

/** The person's photo in a coloured ring, big enough for the gate staff to check the face. */
function Portrait({ name, photoUrl, tone, waves = true }: { name: string; photoUrl?: string | null; tone: Tone; waves?: boolean }) {
  return (
    <div className={cn("kiosk-pop relative mx-auto size-[min(56vw,30vh,17rem)]", tone.wave)}>
      {waves && <Ripple rings={3} durationMs={2600} still={0} className="-inset-6" />}
      <div className={cn("relative size-full overflow-hidden rounded-full border-[7px] bg-[#e6f6f1] shadow-[0_20px_40px_-20px_rgb(12_74_68/0.5)]", tone.ring)}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center font-heading text-[min(16vw,9vh,6rem)] font-extrabold text-brand">{initials(name)}</span>
        )}
      </div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <p className={cn("inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-2xl font-bold tabular-nums", tone.pill)}>{children}</p>;
}

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <span className={cn("rounded-full px-4 py-1.5 text-lg font-semibold tabular-nums", warn ? "bg-amber-400 text-amber-950" : "bg-slate-100 text-slate-600")}>{children}</span>;
}

/** Drains while the result is up, so the next child knows when to tap. */
function Drain({ className }: { className?: string }) {
  return (
    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-slate-100" aria-hidden>
      <div className={cn("kiosk-drain h-full", className ?? "bg-brand")} style={{ animationDuration: `${RESULT_MS}ms` }} />
    </div>
  );
}

function Result({ data, place }: { data: TapResponse; place: string }) {
  if (data.action === "not_authorised") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-danger px-6 text-center text-white" role="alert">
        <ShieldX className="size-32" aria-hidden />
        <p className="text-5xl font-semibold sm:text-6xl">Not authorised</p>
        <p className="text-3xl font-medium">{data.name}</p>
        <p className="max-w-xl text-2xl text-white/90">Do not release any child. The office and the parents have been told.</p>
        <PoweredBy onDark className="absolute bottom-5 left-1/2 -translate-x-1/2" />
      </div>
    );
  }
  if (data.action === "unknown" || data.action === "blocked") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-danger px-6 text-center text-white" role="alert">
        <XCircle className="size-32" aria-hidden />
        <p className="text-5xl font-semibold sm:text-6xl">Card not recognised</p>
        <p className="text-2xl text-white/90">Please see the admin office.</p>
        <PoweredBy onDark className="absolute bottom-5 left-1/2 -translate-x-1/2" />
      </div>
    );
  }

  const name = data.name ?? "";
  const first = data.first_name ?? name.split(" ")[0] ?? "";

  if (data.action === "safe") {
    return (
      <KioskStage>
        <KioskCard>
          <CardTop left={place} right={data.time} />
          <div className="mt-6 flex flex-col items-center gap-5 text-center" role="status">
            <Portrait name={name} photoUrl={data.photo_url} tone={TONES.in} />
            <div className="kiosk-rise">
              <p className="font-heading text-5xl font-extrabold tracking-tight sm:text-6xl">{name}</p>
              {data.class && <p className="mt-1 text-2xl text-slate-500">{data.class}</p>}
            </div>
            <StatusPill tone={TONES.in}><Check className="size-7" aria-hidden /> Safe</StatusPill>
            {data.counts && <p className="text-3xl font-semibold tabular-nums text-slate-700">{data.counts.safe} of {data.counts.total} safe</p>}
          </div>
          <Drain className={TONES.in.bar} />
        </KioskCard>
      </KioskStage>
    );
  }

  if (data.action === "picked_up") {
    const kids = (data.children ?? []).map((c) => c.first_name).join(", ");
    return (
      <KioskStage>
        <KioskCard>
          <CardTop left={place} right={data.time} />
          <div className="mt-6 flex flex-col items-center gap-5 text-center" role="status">
            <Portrait name={name} photoUrl={data.photo_url} tone={TONES.out} />
            <div className="kiosk-rise">
              <p className="font-heading text-5xl font-extrabold tracking-tight sm:text-6xl">{kids}</p>
              <p className="mt-1 text-2xl text-slate-500">with {name}</p>
            </div>
            <StatusPill tone={TONES.out}><Check className="size-7" aria-hidden /> Picked up</StatusPill>
            <p className="text-xl text-slate-500">Parents notified</p>
          </div>
          <Drain className={TONES.out.bar} />
        </KioskCard>
      </KioskStage>
    );
  }

  const isOut = data.action === "signed_out";
  const dup = data.action === "duplicate";
  const started = data.action === "lesson_started";
  const ended = data.action === "lesson_ended";
  const lesson = started || ended;
  const tone = started ? TONES.lesson : ended ? TONES.ended : dup ? TONES.dup : isOut ? TONES.out : data.late ? TONES.late : TONES.in;
  const status = started ? "Lesson started" : ended ? `Lesson ended · ${formatMinutes(data.minutes ?? 0)}` : dup
    ? data.reason === "already_signed_out" ? "Already signed out" : data.reason === "already_signed_in" ? "Already signed in" : "Already tapped"
    : isOut ? (data.early ? "Early release" : "Signed out") : "Signed in";
  const quote = started ? (data.subject ? `${data.subject}${data.class ? ` with ${data.class}` : ""}. Have a good lesson.` : "Have a good lesson.")
    : ended ? `Thank you, ${first}.`
    : dup ? null
    : isOut ? `Goodbye, ${first}. See you tomorrow.`
    : `${data.greeting ?? "Welcome"}, ${first}. Welcome to school.`;

  return (
    <KioskStage>
      <KioskCard>
        <CardTop left={place} right={data.time} />
        <div className="mt-6 flex flex-col items-center gap-5 text-center" role="status">
          <Portrait name={name} photoUrl={data.photo_url} tone={tone} waves={!dup} />
          <div className="kiosk-rise">
            <p className="font-heading text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{name}</p>
            {data.class && !started && <p className="mt-1.5 text-2xl text-slate-500">{data.class}</p>}
          </div>
          <div className="kiosk-rise flex flex-wrap items-center justify-center gap-2">
            <StatusPill tone={tone}>{!dup && <Check className="size-7" aria-hidden />}{status}{data.late && !isOut ? " · Late" : ""}</StatusPill>
          </div>
          {(data.id_no || lesson || (data.flags ?? []).length > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {lesson && data.subject && <Chip>{data.subject}</Chip>}
              {(data.flags ?? []).filter((f) => f !== "auto_closed").map((f) => <Chip key={f} warn>{FLAG_LABEL[f]}</Chip>)}
              {data.id_no && <Chip>{data.id_no}</Chip>}
            </div>
          )}
          {quote && <p className="kiosk-rise max-w-xl text-2xl font-medium text-slate-600">&ldquo;{quote}&rdquo;</p>}
        </div>
        <div className="mt-7 border-t border-slate-100 pt-5">
          <TapHint text={started ? "Tap again to end the lesson" : isOut ? "Tap your card to sign out" : "Tap your card to sign in"} />
        </div>
        <Drain className={tone.bar} />
      </KioskCard>
    </KioskStage>
  );
}

function TeacherMenu({ data, error, onActivity, onCancel, onStart, onSignOut }: {
  data: TapResponse; error?: string; onActivity: () => void; onCancel: () => void; onStart: (c: LessonChoice) => void; onSignOut: () => void;
}) {
  const [step, setStep] = useState<"choose" | "pick">("choose");
  const [busy, setBusy] = useState(false);
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const opts = data.options ?? { assignments: [], classes: [], subjects: [] };
  const go = (fn: () => void) => { setBusy(true); fn(); };
  const other = () => {
    const c = opts.classes.find((x) => x.id === classId);
    const sub = opts.subjects.find((x) => x.id === subjectId);
    if (c && sub) go(() => onStart({ class_id: c.id, class_name: c.name, subject_id: sub.id, subject_name: sub.name }));
  };
  const big = "flex min-h-24 w-full items-center justify-center gap-4 rounded-3xl px-6 text-3xl font-semibold shadow-[0_20px_40px_-20px_rgb(0_0_0/0.6)] transition-transform active:scale-[0.98] disabled:opacity-60";

  return (
    <div className="relative flex min-h-dvh flex-col bg-gradient-to-br from-[#03201e] via-[#073b37] to-[#0f766e] px-6 py-8 text-white sm:px-12"
      role="dialog" aria-modal="true" aria-label="Teacher menu" onPointerDown={onActivity}>
      <div className="flex items-center gap-5">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-white/15 ring-4 ring-white/70 sm:size-28">
          {data.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.photo_url} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-4xl font-semibold">{initials(data.name ?? "?")}</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-2xl text-white/80">{data.greeting ? `${data.greeting},` : "Hello,"}</p>
          <p className="truncate text-4xl font-semibold tracking-tight sm:text-5xl">{data.name}</p>
          <p className="mt-1 text-lg text-white/70">Signed in · {data.time}</p>
        </div>
      </div>

      {error && <p role="alert" className="mt-6 rounded-2xl bg-red-600/90 px-5 py-3 text-xl">{error}</p>}

      {step === "choose" ? (
        <div className="mt-auto flex flex-col gap-4 pb-10 pt-10">
          <button type="button" disabled={busy} onClick={() => setStep("pick")} className={cn(big, "bg-white text-brand")}>
            <Play className="size-9" aria-hidden /> Start lesson
          </button>
          <button type="button" disabled={busy} onClick={() => go(onSignOut)} className={cn(big, "bg-white/10 text-white ring-2 ring-white/40")}>
            <LogOut className="size-9" aria-hidden /> Sign out
          </button>
          <button type="button" onClick={onCancel} className="mx-auto mt-2 rounded-full px-6 py-3 text-xl text-white/75 hover:bg-white/10">Cancel</button>
        </div>
      ) : (
        <div className="mt-8 flex flex-1 flex-col pb-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setStep("choose")} aria-label="Back" className="rounded-full bg-white/10 p-3 hover:bg-white/20"><ArrowLeft className="size-6" /></button>
            <h2 className="text-3xl font-semibold">Which lesson?</h2>
          </div>
          {opts.assignments.length > 0 && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {opts.assignments.map((a) => (
                <button key={a.class_id + a.subject_id} type="button" disabled={busy} onClick={() => go(() => onStart(a))}
                  className="flex min-h-20 items-center gap-4 rounded-2xl bg-white px-5 py-4 text-left text-ink shadow-lg transition-transform active:scale-[0.98] disabled:opacity-60">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-light text-brand"><BookOpen className="size-6" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-2xl font-semibold">{a.class_name}</span>
                    <span className="block truncate text-lg text-muted-foreground">{a.subject_name}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-6 rounded-2xl bg-white/10 p-5 ring-1 ring-white/20">
            <p className="text-xl font-medium">{opts.assignments.length ? "Another class or subject" : "Choose the class and subject"}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-base text-white/75">Class</span>
                <select value={classId} onChange={(e) => setClassId(e.target.value)} className="mt-1 h-14 w-full rounded-xl bg-white px-4 text-xl text-ink">
                  <option value="">Choose…</option>
                  {opts.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-base text-white/75">Subject</span>
                <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="mt-1 h-14 w-full rounded-xl bg-white px-4 text-xl text-ink">
                  <option value="">Choose…</option>
                  {opts.subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            </div>
            {opts.subjects.length === 0 && <p className="mt-3 text-base text-white/75">No subjects yet. The school admin adds them in Lessons → Setup.</p>}
            <button type="button" disabled={busy || !classId || !subjectId} onClick={other} className={cn(big, "mt-4 min-h-16 bg-white text-2xl text-brand")}>
              <Play className="size-7" aria-hidden /> Start
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PickupConfirm({ data, error, onActivity, onCancel, onConfirm }: {
  data: TapResponse; error?: string; onActivity: () => void; onCancel: () => void; onConfirm: (ids: string[]) => void;
}) {
  const children = data.children ?? [];
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(children.filter((c) => c.state === "in_school").map((c) => c.id)));
  const [busy, setBusy] = useState(false);
  const picker = data.picker;
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const none = children.every((c) => c.state !== "in_school");

  return (
    <div className="relative flex min-h-dvh flex-col bg-gradient-to-br from-[#082f49] via-[#0b4f6c] to-[#0f766e] px-6 py-8 text-white sm:px-12"
      role="dialog" aria-modal="true" aria-label="Confirm pickup" onPointerDown={onActivity}>
      <p className="text-lg font-medium uppercase tracking-widest text-white/70">Safe pickup · staff check</p>
      <div className="mt-4 flex flex-col gap-8 lg:flex-row lg:items-start">
        {/* The person collecting: face first, so staff can check it. */}
        <div className="flex items-center gap-5 lg:w-80 lg:flex-col lg:items-start">
          <div className="aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-3xl bg-white/15 ring-4 ring-white/80 sm:w-40 lg:w-64">
            {picker?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={picker.photo_url} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-6xl font-semibold">{initials(picker?.name ?? "?")}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-4xl font-semibold leading-tight tracking-tight">{picker?.name}</p>
            {picker?.relationship && <p className="mt-1 text-2xl text-white/80">{picker.relationship}</p>}
            <p className="mt-2 text-lg text-white/70">{data.time}</p>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-2xl font-semibold">{none ? "No child to collect right now" : "Children going home"}</p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {children.map((c) => {
              const can = c.state === "in_school";
              const on = chosen.has(c.id);
              return (
                <li key={c.id}>
                  <button type="button" disabled={!can || busy} onClick={() => toggle(c.id)} aria-pressed={on}
                    className={cn("flex w-full items-center gap-4 rounded-2xl p-3 text-left ring-2 transition-colors",
                      !can ? "bg-white/5 opacity-60 ring-white/10" : on ? "bg-white text-ink ring-white" : "bg-white/10 ring-white/30")}>
                    <span className="size-20 shrink-0 overflow-hidden rounded-xl bg-slate-200">
                      {c.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.photo_url} alt="" className="size-full object-cover" />
                      ) : <span className="flex size-full items-center justify-center text-2xl font-semibold text-slate-600">{initials(c.name)}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-2xl font-semibold">{c.name}</span>
                      <span className={cn("block text-lg", on ? "text-muted-foreground" : "text-white/75")}>
                        {c.class ?? ""}{c.state === "signed_out" ? " · already gone home" : c.state === "not_in" ? " · not in school today" : ""}
                      </span>
                    </span>
                    {can && <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", on ? "bg-brand text-white" : "ring-2 ring-white/60")}>{on && <Check className="size-6" aria-hidden />}</span>}
                  </button>
                </li>
              );
            })}
            {children.length === 0 && <li className="text-xl text-white/80">No children are linked to this person.</li>}
          </ul>
          {error && <p role="alert" className="mt-4 rounded-2xl bg-red-600/90 px-5 py-3 text-xl">{error}</p>}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button type="button" disabled={busy || chosen.size === 0} onClick={() => { setBusy(true); onConfirm([...chosen]); }}
              className="flex min-h-20 flex-1 items-center justify-center gap-3 rounded-3xl bg-white px-6 text-3xl font-semibold text-brand shadow-lg transition-transform active:scale-[0.98] disabled:opacity-50">
              <Check className="size-8" aria-hidden /> Release {chosen.size === 1 ? "child" : `${chosen.size} children`}
            </button>
            <button type="button" onClick={onCancel} className="min-h-20 rounded-3xl px-8 text-2xl font-medium text-white ring-2 ring-white/40 hover:bg-white/10">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CodeEntry({ error, onActivity, onCancel, onSubmit }: { error?: string; onActivity: () => void; onCancel: () => void; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const press = (d: string) => setCode((c) => (c.length < 6 ? c + d : c));
  const key = "flex h-20 items-center justify-center rounded-2xl bg-white/10 text-4xl font-semibold ring-1 ring-white/20 active:scale-95 active:bg-white/20";
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-br from-[#03201e] via-[#073b37] to-[#0f766e] px-6 py-8 text-white"
      role="dialog" aria-modal="true" aria-label="Enter pickup code" onPointerDown={onActivity}>
      <KeyRound className="size-12 text-teal-200" aria-hidden />
      <p className="text-4xl font-semibold">Pickup code</p>
      <p className="max-w-md text-center text-xl text-white/75">Enter the 6-digit code the parent sent you.</p>
      <div className="flex gap-2" aria-live="polite" aria-label={`${code.length} of 6 digits entered`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={cn("flex h-16 w-12 items-center justify-center rounded-xl text-4xl font-semibold tabular-nums ring-2", code[i] ? "bg-white text-ink ring-white" : "ring-white/30")}>{code[i] ?? ""}</span>
        ))}
      </div>
      {error && <p role="alert" className="max-w-md rounded-2xl bg-red-600/90 px-5 py-3 text-center text-xl">{error}</p>}
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" className={key} onClick={() => press(d)}>{d}</button>)}
        <button type="button" className={key} onClick={() => setCode((c) => c.slice(0, -1))} aria-label="Delete"><Delete className="size-8" /></button>
        <button type="button" className={key} onClick={() => press("0")}>0</button>
        <button type="button" disabled={code.length !== 6 || busy} onClick={() => { setBusy(true); onSubmit(code); }}
          className={cn(key, "bg-white text-brand disabled:opacity-40")} aria-label="Check code"><Check className="size-9" /></button>
      </div>
      <button type="button" onClick={onCancel} className="rounded-full px-6 py-3 text-xl text-white/75 hover:bg-white/10">Cancel</button>
    </div>
  );
}

function Assembly({ active, scanning, onStart }: { active: NonNullable<EmergencyState["active"]>; scanning: boolean; onStart: () => void }) {
  const drill = active.kind === "drill";
  return (
    <div className={cn("relative flex min-h-dvh flex-col items-center justify-between px-6 py-10 text-center text-white", drill ? "bg-gradient-to-b from-[#7c2d12] to-[#c2410c]" : "bg-gradient-to-b from-[#7f1d1d] to-[#b91c1c]")} role="alert">
      <div className="flex flex-col items-center gap-3">
        <Siren className="size-16 animate-pulse motion-reduce:animate-none" aria-hidden />
        <p className="text-4xl font-bold uppercase tracking-[0.12em] sm:text-5xl">{drill ? "Emergency drill" : "Emergency roll call"}</p>
        <p className="text-xl text-white/85">Started {new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(active.started_at)).toUpperCase()}</p>
      </div>
      <div className="flex flex-col items-center gap-8">
        <p className="max-w-3xl text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">Tap your card at the assembly point</p>
        {!scanning && (
          <button onClick={onStart} className="flex h-20 items-center gap-3 rounded-2xl bg-white px-10 text-2xl font-semibold text-red-700 shadow-xl active:scale-95">
            <Nfc className="size-8" aria-hidden /> Start scanning
          </button>
        )}
      </div>
      <div className="grid w-full max-w-2xl grid-cols-2 gap-4">
        <div className="rounded-3xl bg-white/15 px-6 py-5 ring-1 ring-white/30">
          <p className="text-xl text-white/85">Safe</p>
          <p className="text-6xl font-semibold tabular-nums">{active.counts.safe}</p>
        </div>
        <div className="rounded-3xl bg-white px-6 py-5 text-red-700">
          <p className="text-xl">Not yet</p>
          <p className="text-6xl font-semibold tabular-nums">{active.counts.missing}</p>
        </div>
      </div>
    </div>
  );
}

function PinEntry({ error, onActivity, onCancel, onSubmit }: { error?: string; onActivity: () => void; onCancel: () => void; onSubmit: (pin: string, kind: "real" | "drill") => void }) {
  const [pin, setPin] = useState("");
  const [kind, setKind] = useState<"real" | "drill">("real");
  const [busy, setBusy] = useState(false);
  const key = "flex h-20 items-center justify-center rounded-2xl bg-white/10 text-4xl font-semibold ring-1 ring-white/20 active:scale-95 active:bg-white/20";
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#450a0a] to-[#7f1d1d] px-6 py-8 text-white"
      role="dialog" aria-modal="true" aria-label="Start emergency roll call" onPointerDown={onActivity}>
      <Siren className="size-12 text-red-200" aria-hidden />
      <p className="text-4xl font-semibold">Emergency roll call</p>
      <div className="flex gap-2" role="radiogroup" aria-label="Real or drill">
        {(["real", "drill"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={cn("rounded-full px-6 py-2.5 text-xl font-medium ring-2", kind === k ? "bg-white text-red-800 ring-white" : "ring-white/40")}>{k === "real" ? "Real emergency" : "Drill"}</button>
        ))}
      </div>
      <p className="text-xl text-white/80">Enter the emergency PIN</p>
      <div className="flex gap-2" aria-live="polite" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={cn("flex h-14 w-11 items-center justify-center rounded-xl text-3xl ring-2", pin[i] ? "bg-white text-ink ring-white" : "ring-white/30")}>{pin[i] ? "•" : ""}</span>
        ))}
      </div>
      {error && <p role="alert" className="max-w-md rounded-2xl bg-black/30 px-5 py-3 text-center text-xl">{error}</p>}
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" className={key} onClick={() => setPin((p) => (p.length < 6 ? p + d : p))}>{d}</button>)}
        <button type="button" className={key} onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete"><Delete className="size-8" /></button>
        <button type="button" className={key} onClick={() => setPin((p) => (p.length < 6 ? p + "0" : p))}>0</button>
        <button type="button" disabled={pin.length < 4 || busy} onClick={() => { setBusy(true); onSubmit(pin, kind); }}
          className={cn(key, "bg-white text-red-700 disabled:opacity-40")} aria-label="Start roll call"><Check className="size-9" /></button>
      </div>
      <button type="button" onClick={onCancel} className="rounded-full px-6 py-3 text-xl text-white/75 hover:bg-white/10">Cancel</button>
    </div>
  );
}

/** Camera + a QR reader (the browser's own, or jsQR). Nothing is recorded or sent except the code read. */
function QrScan({ error, onCancel, onCode, onCodeEntry }: { error?: string; onCancel: () => void; onCode: (text: string) => void; onCodeEntry: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(() =>
    typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia ? "This kiosk has no camera access. Use the pickup code instead." : null);
  useEffect(() => {
    if (problem) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    (async () => {
      try {
        const reader = await createQrReader();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (!video.current || done) return;
        video.current.srcObject = stream;
        await video.current.play();
        let busy = false;
        timer = setInterval(async () => {
          if (done || busy || !video.current) return;
          busy = true;
          const text = await reader.read(video.current).catch(() => null);
          busy = false;
          if (text && !done) { done = true; onCode(text); }
        }, reader.kind === "native" ? 300 : 250);
      } catch (e) {
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        const noCamera = e instanceof DOMException && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
        setProblem(denied ? "The camera is blocked. Allow the camera for this site, or use the pickup code."
          : noCamera ? "No camera found on this kiosk. Use the pickup code instead."
          : "This kiosk can't read QR codes. Use the pickup code instead.");
      }
    })();
    return () => { done = true; if (timer) clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-gradient-to-br from-[#03201e] via-[#073b37] to-[#0f766e] px-6 py-8 text-white" role="dialog" aria-modal="true" aria-label="Scan pickup QR code">
      <p className="text-4xl font-semibold">Scan pickup QR</p>
      <p className="max-w-md text-center text-xl text-white/75">Hold the QR code up to the camera.</p>
      {problem ? (
        <p role="alert" className="max-w-md rounded-2xl bg-red-600/90 px-5 py-3 text-center text-xl">{problem}</p>
      ) : (
        <div className="relative aspect-square w-[min(80vw,28rem)] overflow-hidden rounded-3xl bg-black ring-4 ring-white/70">
          <video ref={video} playsInline muted className="size-full -scale-x-100 object-cover" />
          <span aria-hidden className="absolute inset-[18%] rounded-2xl border-4 border-teal-300/90" />
        </div>
      )}
      {error && <p role="alert" className="max-w-md rounded-2xl bg-red-600/90 px-5 py-3 text-center text-xl">{error}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={onCodeEntry} className="flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-xl ring-1 ring-white/30"><KeyRound className="size-5" aria-hidden /> Type a code</button>
        <button type="button" onClick={onCancel} className="rounded-full px-6 py-3 text-xl text-white/75 hover:bg-white/10">Cancel</button>
      </div>
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

