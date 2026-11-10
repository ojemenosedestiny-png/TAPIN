"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NFC_ERROR_MESSAGES, createTapDebouncer, nfcSupported, normaliseUid, startNfcScan, type NfcErrorKind } from "@/lib/nfc";

export type ReaderState = "idle" | "starting" | "listening" | "error";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const noopSubscribe = () => () => {};

/**
 * Card input from Web NFC (Android Chrome) or a USB keyboard-style reader.
 * Reads of the same UID within 2 s count as one tap.
 */
export function useCardReader(onUid: (uid: string) => void, { enabled = true }: { enabled?: boolean } = {}) {
  const [state, setState] = useState<ReaderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  // null while rendering on the server, true/false in the browser.
  const supported = useSyncExternalStore(noopSubscribe, nfcSupported, () => null);

  const stopRef = useRef<(() => void) | null>(null);
  const debounce = useRef(createTapDebouncer(2000));
  const latest = useRef({ onUid, enabled });
  useEffect(() => {
    latest.current = { onUid, enabled };
  });
  useEffect(() => () => stopRef.current?.(), []);

  const handle = (uid: string) => {
    if (!latest.current.enabled) return;
    if (!navigator.onLine) {
      setError("No internet connection. Cards can't be linked offline — reconnect and tap again.");
      return;
    }
    setError(null);
    latest.current.onUid(uid);
  };

  /** Call from a button click (Chrome needs a user gesture for the NFC permission prompt). */
  const start = async () => {
    setError(null);
    setState("starting");
    stopRef.current?.();
    let failed = false;
    stopRef.current = await startNfcScan({
      onUid: handle, // startNfcScan debounces too
      onError: (kind: NfcErrorKind) => {
        setError(NFC_ERROR_MESSAGES[kind]);
        if (kind !== "read_failed") {
          failed = true;
          setState("error");
        }
      },
    });
    if (!failed) setState("listening");
  };

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setState("idle");
  };

  /** For USB readers / typed UIDs. Returns false if the text isn't a card number. */
  const submitManual = (text: string): boolean => {
    const uid = normaliseUid(text);
    if (!uid) {
      setError("That isn't a card number. USB readers must be set to output the UID in hex.");
      return false;
    }
    if (debounce.current(uid)) handle(uid);
    return true;
  };

  return { state, error, supported, online, start, stop, submitManual, clearError: () => setError(null) };
}
