"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { mergeData, type Page, type PageData } from "@/lib/db";
import { wrapHtml } from "@/lib/bridge";

const WRITE_DEBOUNCE_MS = 300;

// Renders one notebook page inside a locked-down sandboxed iframe and bridges
// its persistence calls to IndexedDB.
//
// The parent (this component) holds the authoritative copy of the page's data
// blob in `dataRef`. Every `setData` from the iframe merges into that blob and
// is persisted on a short debounce. When the iframe (re)loads — including after
// a re-prompt swaps the HTML — it pulls via the `ready`/`init` handshake and we
// reply with the current blob, so entered data survives regeneration.
export function PageView({
  page,
  flushRef,
  busy,
}: {
  page: Page;
  // Lets the parent flush pending writes before snapshotting/regenerating.
  flushRef?: React.RefObject<(() => Promise<void>) | null>;
  // While a regeneration is in flight, block interaction so the user can't enter
  // data into a frame that's about to be torn down (which would race the swap).
  busy?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dataRef = useRef<PageData>(page.data);
  const pendingRef = useRef<Map<string, unknown>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A fresh nonce per page and per regeneration. Used as the iframe `key` so a
  // new HTML version remounts the frame, and as the shared secret that
  // authenticates messages (the iframe's origin is the opaque string "null").
  const nonce = useMemo(
    () => crypto.randomUUID(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page.id, page.html],
  );

  // Reset the authoritative blob only when switching pages — NOT on a same-page
  // regeneration (page.id stays, page.html changes), so data is preserved.
  useEffect(() => {
    dataRef.current = page.data;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    pendingRef.current = new Map();
    for (const [field, value] of pending) {
      await mergeData(page.id, field, value);
    }
  }, [page.id]);

  // Expose flush to the parent for the pre-regeneration ordering.
  useEffect(() => {
    if (flushRef) flushRef.current = flush;
    return () => {
      if (flushRef) flushRef.current = null;
    };
  }, [flush, flushRef]);

  useEffect(() => {
    const scheduleWrite = (field: string, value: unknown) => {
      pendingRef.current.set(field, value);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flush();
      }, WRITE_DEBOUNCE_MS);
    };

    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      // Authenticate: only the current frame, only our nonce.
      if (!frame || event.source !== frame.contentWindow) return;
      const msg = event.data;
      if (!msg || msg.nonce !== nonce) return;

      if (msg.type === "ready") {
        frame.contentWindow?.postMessage(
          { type: "init", nonce, data: dataRef.current },
          "*",
        );
      } else if (msg.type === "set" && typeof msg.field === "string") {
        dataRef.current = { ...dataRef.current, [msg.field]: msg.value };
        scheduleWrite(msg.field, msg.value);
      }
    };

    // Persist pending writes when the page is being hidden or torn down.
    // `pagehide` is the reliable unload signal (`beforeunload` does not flip
    // visibilityState to "hidden", so guarding on it there never fired); the
    // IndexedDB write is async and best-effort during a hard close.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => {
      void flush();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void flush();
    };
  }, [nonce, flush]);

  const srcDoc = useMemo(() => wrapHtml(page.html, nonce), [page.html, nonce]);

  return (
    <div className="relative h-full w-full">
      <iframe
        key={nonce}
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={page.title}
        className="h-full w-full border-0 bg-card"
      />
      {busy && (
        // Transparent click-shield: prevents edits to the frame mid-regeneration.
        <div className="absolute inset-0 cursor-wait bg-background/40" />
      )}
    </div>
  );
}
