import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Metrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export default function EdgeScrollIndicator({
  viewport,
  className,
}: {
  viewport: HTMLElement | null;
  className?: string;
}) {
  const [m, setM] = useState<Metrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });

  useEffect(() => {
    if (!viewport) return;

    let raf = 0;
    const read = () => {
      const next: Metrics = {
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      };
      setM(next);
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    };

    read();
    viewport.addEventListener("scroll", onScroll, { passive: true });

    const ro = new ResizeObserver(() => read());
    ro.observe(viewport);
    if (viewport.firstElementChild instanceof HTMLElement) {
      ro.observe(viewport.firstElementChild);
    }

    return () => {
      cancelAnimationFrame(raf);
      viewport.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [viewport]);

  const computed = useMemo(() => {
    const { scrollTop, scrollHeight, clientHeight } = m;
    const scrollable = Math.max(0, scrollHeight - clientHeight);
    if (!viewport || scrollable <= 1) return null;

    const minThumb = 28;
    const thumbH = Math.max(minThumb, (clientHeight * clientHeight) / scrollHeight);
    const maxTop = Math.max(0, clientHeight - thumbH);
    const top = scrollable > 0 ? (scrollTop / scrollable) * maxTop : 0;

    return { thumbH, top };
  }, [m, viewport]);

  if (!computed) return null;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute right-0 top-0 bottom-0 w-2",
        "bg-muted-foreground/15",
        className,
      )}
    >
      <div
        className={cn(
          "absolute right-0 w-2 rounded-full",
          "bg-primary/85",
        )}
        style={{ height: computed.thumbH, transform: `translateY(${computed.top}px)` }}
      />
    </div>
  );
}
