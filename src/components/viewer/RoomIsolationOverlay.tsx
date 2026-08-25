import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { SpaceLabel } from '@/hooks/useTandemIsolation';

type ScreenLabel = { id: string; name: string; x: number; y: number; ok: boolean };

function worldToCanvas(viewer: any, worldPos: [number, number, number]): [number, number] | null {
  try {
    const canvas = viewer.scene?.canvas?.canvas as HTMLCanvasElement | null;
    if (!canvas) return null;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const vm = viewer.camera.viewMatrix as number[];
    const pm = viewer.camera.projMatrix as number[];
    if (!vm || !pm) return null;
    const [wx, wy, wz] = worldPos;
    // View transform (column-major)
    const vx = vm[0] * wx + vm[4] * wy + vm[8]  * wz + vm[12];
    const vy = vm[1] * wx + vm[5] * wy + vm[9]  * wz + vm[13];
    const vz = vm[2] * wx + vm[6] * wy + vm[10] * wz + vm[14];
    const vw = vm[3] * wx + vm[7] * wy + vm[11] * wz + vm[15];
    // Projection
    const cx = pm[0] * vx + pm[4] * vy + pm[8]  * vz + pm[12] * vw;
    const cy = pm[1] * vx + pm[5] * vy + pm[9]  * vz + pm[13] * vw;
    const cw = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15] * vw;
    if (cw <= 0) return null;
    return [(cx / cw + 1) / 2 * w, (1 - cy / cw) / 2 * h];
  } catch {
    return null;
  }
}

interface Props {
  viewer: any;
  spaceName: string | null;
  backdropLabels: SpaceLabel[];
  onExit: () => void;
}

export function RoomIsolationOverlay({ viewer, spaceName, backdropLabels, onExit }: Props) {
  const [canvasRect, setCanvasRect] = useState<DOMRect | null>(null);
  const [screenLabels, setScreenLabels] = useState<ScreenLabel[]>([]);
  const rafRef = useRef<number | null>(null);

  // Track canvas bounding rect
  useEffect(() => {
    const canvas = viewer?.scene?.canvas?.canvas as HTMLCanvasElement | null;
    if (!canvas) return;
    const update = () => setCanvasRect(canvas.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [viewer]);

  // Project backdrop labels from 3D to screen every frame
  useEffect(() => {
    if (!viewer || backdropLabels.length === 0) { setScreenLabels([]); return; }
    const canvas = viewer.scene?.canvas?.canvas as HTMLCanvasElement | null;

    const tick = () => {
      if (!canvas) { rafRef.current = requestAnimationFrame(tick); return; }
      const rect = canvas.getBoundingClientRect();
      setScreenLabels(backdropLabels.map(lb => {
        const pos = worldToCanvas(viewer, lb.worldPos);
        if (!pos) return { id: lb.id, name: lb.name, x: -9999, y: -9999, ok: false };
        return { id: lb.id, name: lb.name, x: rect.left + pos[0], y: rect.top + pos[1], ok: true };
      }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [viewer, backdropLabels]);

  if (!canvasRect) return null;

  return createPortal(
    <>
      {/* Room name + exit button — fixed top-right of canvas */}
      <div
        style={{
          position: 'fixed',
          top: canvasRect.top + 12,
          right: window.innerWidth - canvasRect.right + 12,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          pointerEvents: 'none',
        }}
      >
        {spaceName && (
          <div style={{
            background: 'rgba(12,18,30,0.84)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 8,
            padding: '5px 12px',
            color: '#C8D6EE',
            fontSize: 12.5,
            fontWeight: 500,
            letterSpacing: '0.04em',
            pointerEvents: 'none',
          }}>
            {spaceName}
          </div>
        )}
        <button
          onClick={onExit}
          style={{
            background: 'rgba(12,18,30,0.84)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '5px 12px',
            color: '#C8D6EE',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <X size={12} /> Exit isolation
        </button>
      </div>

      {/* Backdrop space name labels */}
      {screenLabels.map(lb => lb.ok && (
        <div
          key={lb.id}
          style={{
            position: 'fixed',
            left: lb.x,
            top: lb.y,
            transform: 'translate(-50%, -50%)',
            zIndex: 9998,
            fontSize: 9,
            fontWeight: 600,
            color: 'rgba(175,192,215,0.65)',
            letterSpacing: '0.09em',
            textTransform: 'uppercase',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            textShadow: '0 1px 3px rgba(0,0,0,0.65)',
          }}
        >
          {lb.name}
        </div>
      ))}
    </>,
    document.body,
  );
}
