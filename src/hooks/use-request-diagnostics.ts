import { useEffect, useMemo, useRef, useState } from "react";

export type RequestDiagTag = "xkt" | "assetplus" | "backend" | "other";

export type RequestDiagEvent = {
  id: string;
  ts: number;
  kind: "fetch" | "xhr";
  method: string;
  url: string;
  tag: RequestDiagTag;
  status?: number;
  durationMs?: number;
  error?: string;
  timedOut?: boolean;
};

type Options = {
  enabled: boolean;
  classify: (url: string) => RequestDiagTag;
  /** Only keep events whose tag is in this list. Defaults to all tags. */
  includeTags?: readonly RequestDiagTag[];
  maxEvents?: number;
};

const uid = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

export function useRequestDiagnostics({
  enabled,
  classify,
  includeTags,
  maxEvents = 25,
}: Options) {
  const [events, setEvents] = useState<RequestDiagEvent[]>([]);

  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const originalXhrOpenRef = useRef<XMLHttpRequest["open"] | null>(null);
  const originalXhrSendRef = useRef<XMLHttpRequest["send"] | null>(null);

  const push = (event: RequestDiagEvent) => {
    if (includeTags && !includeTags.includes(event.tag)) return;
    setEvents((prev) => [event, ...prev].slice(0, maxEvents));
  };

  useEffect(() => {
    if (!enabled) return;

    // ---- fetch instrumentation ----
    if (!originalFetchRef.current) {
      originalFetchRef.current = window.fetch.bind(window);
    }

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const method = (init?.method || (typeof input === "object" && "method" in input ? (input as Request).method : "GET") || "GET").toUpperCase();
      const url = typeof input === "string" ? input : (input as Request).url;
      const tag = classify(url);
      const start = performance.now();

      try {
        const res = await originalFetchRef.current!(input as any, init as any);
        push({
          id: uid(),
          ts: Date.now(),
          kind: "fetch",
          method,
          url,
          tag,
          status: res.status,
          durationMs: Math.round(performance.now() - start),
        });
        return res;
      } catch (e: any) {
        push({
          id: uid(),
          ts: Date.now(),
          kind: "fetch",
          method,
          url,
          tag,
          durationMs: Math.round(performance.now() - start),
          error: e?.name === "AbortError" ? "aborted" : (e?.message || "network_error"),
        });
        throw e;
      }
    };

    window.fetch = wrappedFetch;

    // ---- XHR instrumentation (many UMD libs use this) ----
    if (!originalXhrOpenRef.current) originalXhrOpenRef.current = XMLHttpRequest.prototype.open;
    if (!originalXhrSendRef.current) originalXhrSendRef.current = XMLHttpRequest.prototype.send;

    const META = Symbol.for("__lovable_diag_xhr_meta__");

    XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
      (this as any)[META] = {
        method: (method || "GET").toUpperCase(),
        url: typeof url === "string" ? url : url.toString(),
        start: 0,
      };
      return originalXhrOpenRef.current!.call(this, method as any, url as any, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = (this as any)[META];
      if (meta) meta.start = performance.now();

      const onDone = (timedOut: boolean, error?: string) => {
        const m = (this as any)[META];
        if (!m?.url) return;
        const url = m.url as string;
        const tag = classify(url);
        push({
          id: uid(),
          ts: Date.now(),
          kind: "xhr",
          method: m.method || "GET",
          url,
          tag,
          status: typeof (this as any).status === "number" ? (this as any).status : undefined,
          durationMs: meta?.start ? Math.round(performance.now() - meta.start) : undefined,
          timedOut,
          error,
        });
      };

      const handleLoadEnd = () => onDone(false);
      const handleTimeout = () => onDone(true, "timeout");
      const handleError = () => onDone(false, "network_error");

      this.addEventListener("loadend", handleLoadEnd, { once: true });
      this.addEventListener("timeout", handleTimeout, { once: true });
      this.addEventListener("error", handleError, { once: true });

      return originalXhrSendRef.current!.call(this, body as any);
    };

    return () => {
      // restore fetch
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
      // restore xhr
      if (originalXhrOpenRef.current) XMLHttpRequest.prototype.open = originalXhrOpenRef.current;
      if (originalXhrSendRef.current) XMLHttpRequest.prototype.send = originalXhrSendRef.current;
    };
  }, [enabled, classify, includeTags, maxEvents]);

  const summary = useMemo(() => {
    const xkt = events.filter((e) => e.tag === "xkt");
    const xktOk = xkt.filter((e) => (e.status ?? 0) >= 200 && (e.status ?? 0) < 300);
    const xktFail = xkt.filter((e) => e.error || (e.status ?? 0) >= 400 || e.timedOut);

    const lastXkt = xkt[0];
    const lastError = events.find((e) => e.error || (e.status ?? 0) === 401 || (e.status ?? 0) === 404 || e.timedOut);

    return {
      xktAttempted: xkt.length,
      xktOk: xktOk.length,
      xktFail: xktFail.length,
      lastXkt,
      lastError,
    };
  }, [events]);

  return { events, summary };
}
