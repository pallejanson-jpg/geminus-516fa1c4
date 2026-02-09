/**
 * Point-pick alignment workflow for Split mode.
 * 
 * Two-step calibration:
 *   1. User captures current 360° position (Ivion local coords)
 *   2. User clicks a corresponding point in the 3D view (BIM coords)
 *   3. System calculates offset = bimPoint - rotate(ivionPoint, rotation)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Crosshair, Check, X, MousePointerClick, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ivionToBim, type IvionBimTransform, type Vec3 } from '@/lib/ivion-bim-transform';

type PickStep = 'idle' | 'picking360' | 'picking3D' | 'done';

interface AlignmentPointPickerProps {
  /** Current transform (rotation used for offset calculation) */
  transform: IvionBimTransform;
  /** Ivion API ref for reading current panorama position */
  ivApiRef: React.MutableRefObject<any>;
  /** Called with calculated offset values */
  onOffsetsCalculated: (offsets: { offsetX: number; offsetY: number; offsetZ: number }) => void;
  /** Close/cancel the picker */
  onClose: () => void;
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
  const pickListenerRef = useRef<((e: any) => void) | null>(null);

  // Step 1: Capture current 360° position
  const capture360Position = useCallback(() => {
    const api = ivApiRef.current;
    if (!api) return;

    try {
      const mainView = api.getMainView();
      const image = mainView?.getImage();
      if (image?.location) {
        const loc = image.location;
        setIvionPoint({ x: loc.x, y: loc.y, z: loc.z });
        setStep('picking3D');
        console.log('[AlignmentPicker] 360° position captured:', loc);
      } else {
        console.warn('[AlignmentPicker] No image location available');
      }
    } catch (e) {
      console.error('[AlignmentPicker] Failed to capture 360 position:', e);
    }
  }, [ivApiRef]);

  // Step 2: Listen for xeokit pick in 3D view
  useEffect(() => {
    if (step !== 'picking3D') return;

    const handlePick = (e: CustomEvent) => {
      const coords = e.detail?.worldPos || e.detail?.canvasPos;
      if (coords && Array.isArray(coords) && coords.length >= 3) {
        const picked: Vec3 = { x: coords[0], y: coords[1], z: coords[2] };
        setBimPoint(picked);
        setStep('done');
        console.log('[AlignmentPicker] 3D point picked:', picked);
      }
    };

    // Listen for xeokit pick event dispatched by AssetPlusViewer
    window.addEventListener('xeokit-pick', handlePick as EventListener);
    pickListenerRef.current = handlePick as any;

    // Also try to register directly on the viewer instance
    const win = window as any;
    const xv = win.__assetPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    let inputSub: any = null;
    if (xv?.scene?.input) {
      inputSub = xv.scene.input.on('mouseclicked', (canvasCoords: number[]) => {
        const pickResult = xv.scene.pick({ canvasPos: canvasCoords, pickSurface: true });
        if (pickResult?.worldPos) {
          const picked: Vec3 = {
            x: pickResult.worldPos[0],
            y: pickResult.worldPos[1],
            z: pickResult.worldPos[2],
          };
          setBimPoint(picked);
          setStep('done');
          console.log('[AlignmentPicker] 3D point picked via xeokit:', picked);
        }
      });
    }

    return () => {
      window.removeEventListener('xeokit-pick', handlePick as EventListener);
      if (inputSub !== null && xv?.scene?.input) {
        xv.scene.input.off(inputSub);
      }
    };
  }, [step]);

  // Calculate and apply offsets when both points are captured
  const applyOffsets = useCallback(() => {
    if (!ivionPoint || !bimPoint) return;

    // Rotate the ivion point by current rotation to get where it "should" be in BIM space
    const rotated = ivionToBim(ivionPoint, { ...transform, offsetX: 0, offsetY: 0, offsetZ: 0 });

    // The offset is the difference between where it IS in BIM and where the rotated ivion point maps to
    const offsets = {
      offsetX: parseFloat((bimPoint.x - rotated.x).toFixed(2)),
      offsetY: parseFloat((bimPoint.y - rotated.y).toFixed(2)),
      offsetZ: parseFloat((bimPoint.z - rotated.z).toFixed(2)),
    };

    console.log('[AlignmentPicker] Calculated offsets:', offsets);
    onOffsetsCalculated(offsets);
  }, [ivionPoint, bimPoint, transform, onOffsetsCalculated]);

  const reset = useCallback(() => {
    setIvionPoint(null);
    setBimPoint(null);
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
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={reset} title="Börja om">
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Avbryt">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Step 1: 360 position */}
      <div className={`flex items-start gap-2 p-2 rounded-md text-xs ${
        step === 'picking360' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'
      }`}>
        <div className={`shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
          ivionPoint ? 'bg-green-500 text-white' : 'bg-muted-foreground/20 text-muted-foreground'
        }`}>
          {ivionPoint ? <Check className="h-3 w-3" /> : '1'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Navigera i 360° till en tydlig punkt</p>
          {ivionPoint ? (
            <p className="text-muted-foreground font-mono text-[10px] mt-1">{formatCoord(ivionPoint)}</p>
          ) : (
            <Button size="sm" variant="outline" className="h-6 text-[11px] mt-1.5 gap-1" onClick={capture360Position}>
              <MousePointerClick className="h-3 w-3" />
              Fånga position
            </Button>
          )}
        </div>
      </div>

      {/* Step 2: 3D pick */}
      <div className={`flex items-start gap-2 p-2 rounded-md text-xs ${
        step === 'picking3D' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'
      }`}>
        <div className={`shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
          bimPoint ? 'bg-green-500 text-white' : 'bg-muted-foreground/20 text-muted-foreground'
        }`}>
          {bimPoint ? <Check className="h-3 w-3" /> : '2'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Klicka på samma punkt i 3D-modellen</p>
          {bimPoint ? (
            <p className="text-muted-foreground font-mono text-[10px] mt-1">{formatCoord(bimPoint)}</p>
          ) : step === 'picking3D' ? (
            <p className="text-muted-foreground mt-1 animate-pulse">Väntar på klick i 3D...</p>
          ) : (
            <p className="text-muted-foreground mt-1">Fånga 360°-position först</p>
          )}
        </div>
      </div>

      {/* Apply button */}
      {step === 'done' && ivionPoint && bimPoint && (
        <Button size="sm" className="w-full h-7 text-xs gap-1.5" onClick={applyOffsets}>
          <Check className="h-3 w-3" />
          Applicera offset
        </Button>
      )}
    </div>
  );
};

export default AlignmentPointPicker;
