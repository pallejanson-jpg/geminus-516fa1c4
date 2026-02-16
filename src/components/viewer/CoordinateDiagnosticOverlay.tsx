/**
 * Coordinate diagnostic overlay for Split/VT mode debugging.
 * Shows live camera position in both Ivion and BIM coordinate spaces,
 * plus the current transform parameters.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Bug, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { IvionBimTransform, Vec3 } from '@/lib/ivion-bim-transform';
import { bimToIvion } from '@/lib/ivion-bim-transform';

interface CoordinateDiagnosticOverlayProps {
  transform: IvionBimTransform;
  ivApiRef: React.MutableRefObject<any>;
  visible: boolean;
  onClose: () => void;
}

const CoordinateDiagnosticOverlay: React.FC<CoordinateDiagnosticOverlayProps> = ({
  transform,
  ivApiRef,
  visible,
  onClose,
}) => {
  const [ivionPos, setIvionPos] = useState<Vec3 | null>(null);
  const [bimPos, setBimPos] = useState<Vec3 | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    const poll = () => {
      // Read Ivion position
      const api = ivApiRef.current;
      if (api) {
        try {
          const mainView = typeof api.getMainView === 'function' ? api.getMainView() : null;
          const image = mainView?.getImage?.();
          if (image?.location) {
            setIvionPos({ x: image.location.x, y: image.location.y, z: image.location.z });
          } else if (api.camera?.position) {
            const p = api.camera.position;
            setIvionPos({ x: p.x ?? p[0], y: p.y ?? p[1], z: p.z ?? p[2] });
          }
        } catch { /* ignore */ }
      }

      // Read BIM camera position
      const xv = (window as any).__assetPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      if (xv?.scene?.camera) {
        const eye = xv.scene.camera.eye;
        setBimPos({ x: eye[0], y: eye[1], z: eye[2] });
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 500);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [visible, ivApiRef]);

  if (!visible) return null;

  const fmt = (v: number) => v.toFixed(2);
  const ivionInBim = ivionPos ? bimToIvion(ivionPos, { ...transform, offsetX: 0, offsetY: 0, offsetZ: 0 }) : null;

  return (
    <div className="absolute bottom-16 left-2 z-30 bg-background/90 backdrop-blur-md border border-border rounded-lg shadow-lg p-3 text-[10px] font-mono w-64 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground font-sans">
          <Bug className="h-3.5 w-3.5 text-primary" />
          Koordinatdiagnostik
        </div>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="space-y-1">
        <div className="text-foreground/70 font-sans text-[11px]">Ivion (360°)</div>
        {ivionPos ? (
          <div className="text-foreground">
            x:{fmt(ivionPos.x)} y:{fmt(ivionPos.y)} z:{fmt(ivionPos.z)}
          </div>
        ) : <div className="text-foreground/50">—</div>}
      </div>

      <div className="space-y-1">
        <div className="text-foreground/70 font-sans text-[11px]">BIM (3D kamera)</div>
        {bimPos ? (
          <div className="text-foreground">
            x:{fmt(bimPos.x)} y:{fmt(bimPos.y)} z:{fmt(bimPos.z)}
          </div>
        ) : <div className="text-foreground/50">—</div>}
      </div>

      <div className="border-t border-border pt-1.5 space-y-0.5">
        <div className="text-foreground/70 font-sans text-[11px]">Transform</div>
        <div className="text-foreground">
          offset: ({fmt(transform.offsetX)}, {fmt(transform.offsetY)}, {fmt(transform.offsetZ)})
        </div>
        <div className="text-foreground">
          rotation: {transform.rotation.toFixed(1)}°
        </div>
      </div>
    </div>
  );
};

export default CoordinateDiagnosticOverlay;
