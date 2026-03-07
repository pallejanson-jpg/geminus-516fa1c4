/**
 * Point-pick alignment workflow for Split mode.
 * 
 * Two-step calibration:
 *   1. User clicks a point in the 360° view (Ivion local coords)
 *   2. User clicks the same point in the 3D view (BIM coords)
 *   3. System calculates offset = bimPoint - rotate(ivionPoint, rotation)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Crosshair, Check, X, MousePointerClick, RotateCcw, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { ivionToBim, type IvionBimTransform, type Vec3 } from '@/lib/ivion-bim-transform';
import { resolveMainView } from '@/lib/ivion-sdk';

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
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Step 1: Listen for user click in the 360° view
  useEffect(() => {
    if (step !== 'picking360') return;

    const api = ivApiRef.current;
    if (!api) return;

    const mainView = resolveMainView(api);
    if (!mainView) return;

    // Find the Ivion SDK container — look for the SDK's rendered element
    // The SDK container is the parent of the ivApiRef's rendering target
    const findContainer = (): HTMLElement | null => {
      // Try common SDK container selectors
      const el = document.querySelector('[class*="ivion"]') as HTMLElement
        || document.querySelector('[data-ivion]') as HTMLElement;
      if (el) return el;
      // Fallback: the right half of the split view (SDK container)
      const sdkDiv = document.querySelector('.absolute.z-0.transition-opacity') as HTMLElement;
      return sdkDiv;
    };

    const container = findContainer();
    if (!container) {
      console.warn('[AlignmentPicker] Could not find 360° container element');
      return;
    }

    const handleClick = () => {
      try {
        const image = mainView.getImage?.();
        if (image?.location) {
          const loc = image.location;
          const pt: Vec3 = { x: loc.x, y: loc.y, z: loc.z };
          setIvionPoint(pt);
          setStep('picking3D');
          setCaptureError(null);
          toast.success(`360° position captured: (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}, ${pt.z.toFixed(1)})`);
          console.log('[AlignmentPicker] 360° position captured on click:', loc);
        } else {
          setCaptureError('No panorama position available. Navigate to an image first.');
        }
      } catch (e: any) {
        setCaptureError(`Error: ${e.message}`);
      }
    };

    container.addEventListener('click', handleClick);
    console.log('[AlignmentPicker] Listening for clicks in 360° view');

    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [step, ivApiRef]);

  // Step 2: Listen for click in native xeokit 3D view
  useEffect(() => {
    if (step !== 'picking3D') return;

    // Try native xeokit viewer first, then legacy
    const xv = (window as any).__nativeXeokitViewer ||
      (window as any).__assetPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;

    if (!xv?.scene) {
      console.warn('[AlignmentPicker] No xeokit viewer found for 3D picking');
      return;
    }

    let savedHighlightEdges = true;

    // Suppress highlighting during point picking
    if (xv.scene.highlightMaterial) {
      savedHighlightEdges = xv.scene.highlightMaterial.edges ?? true;
      xv.scene.highlightMaterial.edges = false;
      const allIds = xv.scene.objectIds;
      if (allIds?.length) {
        xv.scene.setObjectsHighlighted(allIds, false);
        xv.scene.setObjectsSelected(allIds, false);
      }
    }

    // Listen for xeokit-pick custom event
    const handlePick = (e: CustomEvent) => {
      const worldPos = e.detail?.worldPos;
      if (worldPos && Array.isArray(worldPos) && worldPos.length >= 3) {
        const picked: Vec3 = { x: worldPos[0], y: worldPos[1], z: worldPos[2] };
        setBimPoint(picked);
        setStep('done');
          toast.success(`3D point selected: (${picked.x.toFixed(1)}, ${picked.y.toFixed(1)}, ${picked.z.toFixed(1)})`);
      }
    };
    window.addEventListener('xeokit-pick', handlePick as EventListener);

    // Also register directly on the viewer for surface picking
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
          toast.success(`3D point selected: (${picked.x.toFixed(1)}, ${picked.y.toFixed(1)}, ${picked.z.toFixed(1)})`);
          console.log('[AlignmentPicker] 3D point picked:', picked);
        } else {
          toast.warning('No surface hit. Click directly on a visible wall, floor, or column.');
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
    toast.success('Offset calculated and applied');
    onOffsetsCalculated(offsets);
  }, [ivionPoint, bimPoint, transform, onOffsetsCalculated]);

  const reset = useCallback(() => {
    setIvionPoint(null);
    setBimPoint(null);
    setCaptureError(null);
    setStep('picking360');
  }, []);

  const formatCoord = (v: Vec3) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

  return (
    <div className="space-y-3 border-t border-border pt-3 mt-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Crosshair className="h-3.5 w-3.5 text-primary" />
          Point calibration
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={reset} title="Restart">
            <RotateCcw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Cancel">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Step 1: 360 position — click in panorama */}
      <div className={`flex items-start gap-2 p-2 rounded-md text-xs ${
        step === 'picking360' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'
      }`}>
        <div className={`shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
          ivionPoint ? 'bg-green-500 text-white' : 'bg-foreground/20 text-foreground/70'
        }`}>
          {ivionPoint ? <Check className="h-3 w-3" /> : '1'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">Click in the 360° view</p>
          {ivionPoint ? (
            <p className="text-green-400 font-mono text-[10px] mt-1.5">✓ {formatCoord(ivionPoint)}</p>
          ) : (
            <div className="mt-0.5 space-y-1.5">
              <p className="text-foreground/70 leading-snug">
                Navigate to a point you can identify in 3D (corner, door, column) and <strong>click directly</strong> in the 360° image.
              </p>
              {step === 'picking360' && (
                <div className="flex items-center gap-1.5 text-primary">
                  <MousePointerClick className="h-3 w-3" />
                  <span className="text-[11px] font-medium animate-pulse">Waiting for click in 360°...</span>
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
          <p className="font-medium text-foreground">Click the same point in 3D</p>
          {bimPoint ? (
            <p className="text-green-400 font-mono text-[10px] mt-1">✓ {formatCoord(bimPoint)}</p>
          ) : step === 'picking3D' ? (
            <div className="mt-1 space-y-1">
              <p className="text-foreground/70 leading-snug">
                Now click on <strong>the exact same point</strong> in the 3D model on the left.
              </p>
              <div className="flex items-center gap-1.5 text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-[11px] font-medium animate-pulse">Väntar på klick i 3D-vyn...</span>
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
