/**
 * Point-pick alignment workflow for Split mode.
 * 
 * Two-step calibration:
 *   1. User clicks in 360° view → captures estimated surface point
 *      (ray from tripod in viewing direction × adjustable distance)
 *   2. User clicks the same point in 3D view (BIM coords via surface pick)
 *   3. System calculates offset = bimPoint - rotate(ivionPoint, rotation)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Crosshair, Check, X, MousePointerClick, RotateCcw, AlertCircle, Loader2, Ruler } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { ivionToBim, type IvionBimTransform, type Vec3 } from '@/lib/ivion-bim-transform';
import { resolveMainView } from '@/lib/ivion-sdk';

type PickStep = 'idle' | 'picking360' | 'picking3D' | 'done';

interface AlignmentPointPickerProps {
  transform: IvionBimTransform;
  ivApiRef: React.MutableRefObject<any>;
  onOffsetsCalculated: (offsets: { offsetX: number; offsetY: number; offsetZ: number }) => void;
  onClose: () => void;
}

/**
 * Estimate surface point from panorama position + viewing direction.
 * Projects a ray from the tripod location along the current camera direction
 * at the given distance (meters).
 */
function estimateSurfacePoint(
  tripodPos: Vec3,
  viewDir: { lon: number; lat: number },
  distance: number,
): Vec3 {
  // lon = yaw (rotation around Y), lat = pitch (up/down)
  // In Ivion: lon=0 faces north (-Z), increases clockwise
  const cosLat = Math.cos(viewDir.lat);
  return {
    x: tripodPos.x + Math.sin(viewDir.lon) * cosLat * distance,
    y: tripodPos.y + Math.sin(viewDir.lat) * distance,
    z: tripodPos.z - Math.cos(viewDir.lon) * cosLat * distance,
  };
}

const AlignmentPointPicker: React.FC<AlignmentPointPickerProps> = ({
  transform,
  ivApiRef,
  onOffsetsCalculated,
  onClose,
}) => {
  const [step, setStep] = useState<PickStep>('picking360');
  const [ivionPoint, setIvionPoint] = useState<Vec3 | null>(null);
  const [bimPoint, setBimPoint] = useState<Vec3 | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [rayDistance, setRayDistance] = useState(2.0);
  const [tripodPos, setTripodPos] = useState<Vec3 | null>(null);
  const [viewDir, setViewDir] = useState<{ lon: number; lat: number } | null>(null);

  // Step 1: Listen for click in 360° view — estimate surface point via ray
  useEffect(() => {
    if (step !== 'picking360') return;

    const api = ivApiRef.current;
    if (!api) return;
    const mainView = resolveMainView(api);
    if (!mainView) return;

    const findContainer = (): HTMLElement | null => {
      const el = document.querySelector('[class*="ivion"]') as HTMLElement
        || document.querySelector('[data-ivion]') as HTMLElement;
      if (el) return el;
      return document.querySelector('.absolute.z-0.transition-opacity') as HTMLElement;
    };

    const container = findContainer();
    if (!container) {
      console.warn('[AlignmentPicker] Could not find 360° container element');
      return;
    }

    const handleClick = () => {
      try {
        const image = mainView.getImage?.();
        const dir = mainView.currViewingDir;
        if (image?.location && dir) {
          const loc = image.location;
          const tp: Vec3 = { x: loc.x, y: loc.y, z: loc.z };
          const vd = { lon: dir.lon, lat: dir.lat };
          const surfacePt = estimateSurfacePoint(tp, vd, rayDistance);

          setTripodPos(tp);
          setViewDir(vd);
          setIvionPoint(surfacePt);
          setStep('picking3D');
          setCaptureError(null);
          toast.success(`360° punkt fångad: (${surfacePt.x.toFixed(1)}, ${surfacePt.y.toFixed(1)}, ${surfacePt.z.toFixed(1)})`);
          console.log('[AlignmentPicker] 360° surface estimate:', surfacePt, 'tripod:', tp, 'dir:', vd, 'dist:', rayDistance);
        } else {
          setCaptureError('Ingen panoramaposition tillgänglig. Navigera till en bild först.');
        }
      } catch (e: any) {
        setCaptureError(`Fel: ${e.message}`);
      }
    };

    container.addEventListener('click', handleClick);
    console.log('[AlignmentPicker] Listening for clicks in 360° view');

    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [step, ivApiRef, rayDistance]);

  // Recalculate ivion point when distance slider changes (before 3D pick)
  useEffect(() => {
    if (step === 'picking3D' && tripodPos && viewDir) {
      const newPt = estimateSurfacePoint(tripodPos, viewDir, rayDistance);
      setIvionPoint(newPt);
    }
  }, [rayDistance, step, tripodPos, viewDir]);

  // Step 2: Listen for click in native xeokit 3D view
  useEffect(() => {
    if (step !== 'picking3D') return;

    const xv = (window as any).__nativeXeokitViewer ||
      (window as any).__assetPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;

    if (!xv?.scene) {
      console.warn('[AlignmentPicker] No xeokit viewer found for 3D picking');
      return;
    }

    let savedHighlightEdges = true;

    if (xv.scene.highlightMaterial) {
      savedHighlightEdges = xv.scene.highlightMaterial.edges ?? true;
      xv.scene.highlightMaterial.edges = false;
      const allIds = xv.scene.objectIds;
      if (allIds?.length) {
        xv.scene.setObjectsHighlighted(allIds, false);
        xv.scene.setObjectsSelected(allIds, false);
      }
    }

    const handlePick = (e: CustomEvent) => {
      const worldPos = e.detail?.worldPos;
      if (worldPos && Array.isArray(worldPos) && worldPos.length >= 3) {
        const picked: Vec3 = { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
        setBimPoint(picked);
        setStep('done');
        toast.success(`3D-punkt vald: (${picked.x.toFixed(1)}, ${picked.y.toFixed(1)}, ${picked.z.toFixed(1)})`);
      }
    };
    window.addEventListener('xeokit-pick', handlePick as EventListener);

    let inputSub: any = null;
    if (xv.scene.input) {
      inputSub = xv.scene.input.on('mouseclicked', (canvasCoords: number[]) => {
        const pickResult = xv.scene.pick({ canvasPos: canvasCoords, pickSurface: true });
        if (pickResult?.worldPos) {
          const picked: Vec3 = {
            x: pickResult.worldPos[0],
            y: pickResult.worldPos[1],
            z: pickResult.worldPos[2],
          };
          if (pickResult.entity) {
            pickResult.entity.highlighted = false;
            pickResult.entity.selected = false;
          }
          setBimPoint(picked);
          setStep('done');
          toast.success(`3D-punkt vald: (${picked.x.toFixed(1)}, ${picked.y.toFixed(1)}, ${picked.z.toFixed(1)})`);
          console.log('[AlignmentPicker] 3D point picked:', picked);
        } else {
          toast.warning('Ingen yta träffad. Klicka direkt på en vägg, golv eller pelare.');
        }
      });
    }

    return () => {
      window.removeEventListener('xeokit-pick', handlePick as EventListener);
      if (inputSub !== null && xv.scene?.input) {
        xv.scene.input.off(inputSub);
      }
      if (xv.scene?.highlightMaterial) {
        xv.scene.highlightMaterial.edges = savedHighlightEdges;
      }
    };
  }, [step]);

  // Calculate and apply offsets
  const applyOffsets = useCallback(() => {
    if (!ivionPoint || !bimPoint) return;
    const rotated = ivionToBim(ivionPoint, { ...transform, offsetX: 0, offsetY: 0, offsetZ: 0 });
    const offsets = {
      offsetX: parseFloat((bimPoint.x - rotated.x).toFixed(2)),
      offsetY: parseFloat((bimPoint.y - rotated.y).toFixed(2)),
      offsetZ: parseFloat((bimPoint.z - rotated.z).toFixed(2)),
    };
    console.log('[AlignmentPicker] Calculated offsets:', offsets);
    toast.success('Offset beräknad och tillämpad');
    onOffsetsCalculated(offsets);
  }, [ivionPoint, bimPoint, transform, onOffsetsCalculated]);

  const reset = useCallback(() => {
    setIvionPoint(null);
    setBimPoint(null);
    setTripodPos(null);
    setViewDir(null);
    setCaptureError(null);
    setStep('picking360');
  }, []);

  const formatCoord = (v: Vec3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

  return (
    <div className="space-y-3 border-t border-border pt-3 mt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Crosshair className="h-3.5 w-3.5 text-primary" />
          Punktkalibrering
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={reset} title="Starta om">
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Avbryt">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Distance slider — visible during step 1 and adjustable in step 2 */}
      {(step === 'picking360' || step === 'picking3D') && (
        <div className="bg-muted/50 rounded-md p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="flex items-center gap-1 text-foreground/70">
              <Ruler className="h-3 w-3" />
              Avstånd till yta
            </span>
            <span className="font-mono text-foreground">{rayDistance.toFixed(1)} m</span>
          </div>
          <Slider
            value={[rayDistance]}
            onValueChange={([v]) => setRayDistance(v)}
            min={0.5}
            max={10}
            step={0.1}
            className="w-full"
          />
          <p className="text-[9px] text-foreground/50">
            Ungefärligt avstånd från kameran till ytan du pekar på.
          </p>
        </div>
      )}

      {/* Step 1: 360 position */}
      <div className={`flex items-start gap-2 p-2 rounded-md text-xs ${
        step === 'picking360' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'
      }`}>
        <div className={`shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
          ivionPoint ? 'bg-green-500 text-white' : 'bg-foreground/20 text-foreground/70'
        }`}>
          {ivionPoint ? <Check className="h-3 w-3" /> : '1'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">Klicka i 360°-vyn</p>
          {ivionPoint ? (
            <p className="text-green-400 font-mono text-[10px] mt-1.5">✓ {formatCoord(ivionPoint)}</p>
          ) : (
            <div className="mt-0.5 space-y-1.5">
              <p className="text-foreground/70 leading-snug">
                <strong>Titta direkt på</strong> en punkt du kan identifiera i 3D (hörn, dörr, pelare) och <strong>klicka</strong>.
                Justera avståndet ovan om punkten är långt bort.
              </p>
              {step === 'picking360' && (
                <div className="flex items-center gap-1.5 text-primary">
                  <MousePointerClick className="h-3 w-3" />
                  <span className="text-[11px] font-medium animate-pulse">Väntar på klick i 360°...</span>
                </div>
              )}
              {captureError && (
                <div className="flex items-start gap-1.5 text-destructive">
                  <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                  <p className="text-[10px] leading-snug">{captureError}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Step 2: 3D pick */}
      <div className={`flex items-start gap-2 p-2 rounded-md text-xs ${
        step === 'picking3D' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'
      }`}>
        <div className={`shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
          bimPoint ? 'bg-green-500 text-white' : 'bg-foreground/20 text-foreground/70'
        }`}>
          {bimPoint ? <Check className="h-3 w-3" /> : '2'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">Klicka på samma punkt i 3D</p>
          {bimPoint ? (
            <p className="text-green-400 font-mono text-[10px] mt-1">✓ {formatCoord(bimPoint)}</p>
          ) : step === 'picking3D' ? (
            <div className="mt-1 space-y-1">
              <p className="text-foreground/70 leading-snug">
                Klicka nu på <strong>exakt samma punkt</strong> i 3D-modellen till vänster.
              </p>
              {ivionPoint && (
                <p className="text-foreground/50 text-[10px] font-mono">
                  360°: {formatCoord(ivionPoint)} (avstånd: {rayDistance.toFixed(1)}m)
                </p>
              )}
              <div className="flex items-center gap-1.5 text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-[11px] font-medium animate-pulse">Väntar på klick i 3D...</span>
              </div>
            </div>
          ) : (
            <p className="text-foreground/60 mt-1">Klicka i 360° först (steg 1)</p>
          )}
        </div>
      </div>

      {/* Step 3: Result + Apply */}
      {step === 'done' && ivionPoint && bimPoint && (
        <div className="space-y-2">
          <div className="bg-muted/50 rounded-md p-2 text-[10px] font-mono space-y-0.5">
            <div className="flex justify-between">
              <span className="text-foreground/70">360°:</span>
              <span className="text-foreground">{formatCoord(ivionPoint)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground/70">3D:</span>
              <span className="text-foreground">{formatCoord(bimPoint)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground/70">Avstånd:</span>
              <span className="text-foreground">{rayDistance.toFixed(1)} m</span>
            </div>
          </div>
          <Button size="sm" className="w-full h-7 text-xs gap-1.5" onClick={applyOffsets}>
            <Check className="h-3 w-3" />
            Applicera beräknad offset
          </Button>
        </div>
      )}
    </div>
  );
};

export default AlignmentPointPicker;
