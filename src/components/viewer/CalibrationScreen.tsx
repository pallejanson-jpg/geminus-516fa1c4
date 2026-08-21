/**
 * Multi-point xeokit<->NavVis calibration screen (Phase 3 of
 * docs/plans/viewer-coordinator-spec-and-prompts.md).
 *
 * Reuses AlignmentPointPicker.tsx's click-to-pick pattern (ray-cast estimate in the
 * 360° view, surface pick in the 3D view via src/viewer/estimateSurfacePoint.ts,
 * shared so both components use identical ray math) but collects 2+ point pairs
 * instead of one, fits a similarity transform (rotation + uniform scale + XYZ
 * translation) via src/viewer/calibration.ts, shows the RMS residual in mm before
 * saving, and — like AlignmentPanel's manual sliders — saves as a NEW versioned row
 * in spatial_transforms via the viewer-annotations Edge Function's
 * save-spatial-transform action. It never overwrites an existing version.
 *
 * Split mode only: VT mode has no second clickable viewport to pick point pairs in
 * (see AlignmentPanel.tsx's doc comment), so it uses the manual sliders exclusively.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Crosshair, Check, X, MousePointerClick, RotateCcw, AlertCircle, Loader2, Ruler, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Vec3 } from '@/lib/ivion-bim-transform';
import type { IvionApi } from '@/lib/ivion-sdk';
import { resolveMainView } from '@/lib/ivion-sdk';
import { estimateSurfacePoint } from '@/viewer/estimateSurfacePoint';
import { fitSimilarityTransform, type CalibrationPointPair, type SimilarityFitResult } from '@/viewer/calibration';
import { useLanguage } from '@/context/LanguageContext';
import { logger } from '@/lib/logger';

type CaptureStep = 'picking360' | 'picking3D';

const MIN_PAIRS = 2;

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Minimal shape of the parts of the real xeokit Viewer this component picks against —
 *  same rationale as XeokitViewerAdapter.ts: xeokit-sdk isn't an npm dependency. */
interface XeokitPickViewer {
  scene?: {
    highlightMaterial?: { edges: boolean };
    input?: { on(event: string, cb: (canvasCoords: number[]) => void): unknown; off(sub: unknown): void };
    pick?: (params: { canvasPos: number[]; pickSurface: boolean }) => {
      worldPos?: number[];
      entity?: { highlighted: boolean; selected: boolean };
    } | null;
  };
}

interface CalibrationScreenProps {
  buildingFmGuid: string;
  ivApiRef: React.MutableRefObject<IvionApi | null>;
  onClose: () => void;
  onSaved?: (result: SimilarityFitResult) => void;
}

const CalibrationScreen: React.FC<CalibrationScreenProps> = ({ buildingFmGuid, ivApiRef, onClose, onSaved }) => {
  const { t } = useLanguage();
  const [pairs, setPairs] = useState<CalibrationPointPair[]>([]);
  const [captureStep, setCaptureStep] = useState<CaptureStep>('picking360');
  const [pendingNavvis, setPendingNavvis] = useState<Vec3 | null>(null);
  const [tripodPos, setTripodPos] = useState<Vec3 | null>(null);
  const [viewDir, setViewDir] = useState<{ lon: number; lat: number } | null>(null);
  const [rayDistance, setRayDistance] = useState(2.0);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Recalculate the pending 360° estimate when distance slider changes (before 3D pick)
  useEffect(() => {
    if (captureStep === 'picking3D' && tripodPos && viewDir) {
      setPendingNavvis(estimateSurfacePoint(tripodPos, viewDir, rayDistance));
    }
  }, [rayDistance, captureStep, tripodPos, viewDir]);

  // Step A: capture a point in the 360° view
  useEffect(() => {
    if (captureStep !== 'picking360') return;

    const api = ivApiRef.current;
    if (!api) return;
    const mainView = resolveMainView(api);
    if (!mainView) return;

    const findContainer = (): HTMLElement | null => {
      const el = (document.querySelector('[class*="ivion"]') as HTMLElement)
        || (document.querySelector('[data-ivion]') as HTMLElement);
      if (el) return el;
      return document.querySelector('.absolute.z-0.transition-opacity') as HTMLElement;
    };

    const container = findContainer();
    if (!container) {
      logger.warn('[CalibrationScreen] Could not find 360° container element');
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
          setTripodPos(tp);
          setViewDir(vd);
          setPendingNavvis(estimateSurfacePoint(tp, vd, rayDistance));
          setCaptureStep('picking3D');
          setCaptureError(null);
        } else {
          setCaptureError(t('Ingen panoramaposition tillgänglig. Navigera till en bild först.', 'No panorama position available. Navigate to an image first.'));
        }
      } catch (e) {
        setCaptureError(`${t('Fel', 'Error')}: ${getErrorMessage(e)}`);
      }
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [captureStep, ivApiRef, rayDistance, t]);

  // Step B: capture the matching point in the native xeokit 3D view
  useEffect(() => {
    if (captureStep !== 'picking3D') return;

    const win = window as unknown as {
      __nativeXeokitViewer?: XeokitPickViewer;
      __geminusPlusViewerInstance?: { $refs?: { AssetViewer?: { $refs?: { assetView?: { viewer?: XeokitPickViewer } } } } };
    };
    const xv = win.__nativeXeokitViewer ?? win.__geminusPlusViewerInstance?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xv?.scene) {
      logger.warn('[CalibrationScreen] No xeokit viewer found for 3D picking');
      return;
    }

    let savedHighlightEdges = true;
    if (xv.scene.highlightMaterial) {
      savedHighlightEdges = xv.scene.highlightMaterial.edges ?? true;
      xv.scene.highlightMaterial.edges = false;
    }

    const commitPair = (picked: Vec3) => {
      if (!pendingNavvis) return;
      setPairs((prev) => [...prev, { navvis: pendingNavvis, xeokit: picked }]);
      setPendingNavvis(null);
      setTripodPos(null);
      setViewDir(null);
      setCaptureStep('picking360');
      toast.success(t('Punktpar tillagt', 'Point pair added'));
    };

    let inputSub: unknown = null;
    if (xv.scene.input) {
      inputSub = xv.scene.input.on('mouseclicked', (canvasCoords: number[]) => {
        const pickResult = xv.scene.pick?.({ canvasPos: canvasCoords, pickSurface: true });
        if (pickResult?.worldPos) {
          const picked: Vec3 = { x: pickResult.worldPos[0], y: pickResult.worldPos[1], z: pickResult.worldPos[2] };
          if (pickResult.entity) {
            pickResult.entity.highlighted = false;
            pickResult.entity.selected = false;
          }
          commitPair(picked);
        } else {
          toast.warning(t('Ingen ytträff. Klicka direkt på en vägg, golv eller pelare.', 'No surface hit. Click directly on a wall, floor or column.'));
        }
      });
    }

    return () => {
      if (inputSub !== null && xv.scene?.input) xv.scene.input.off(inputSub);
      if (xv.scene?.highlightMaterial) xv.scene.highlightMaterial.edges = savedHighlightEdges;
    };
    // pendingNavvis intentionally omitted — captured via closure at commit time, and
    // including it would tear down/rebuild the pick listener on every distance-slider tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureStep, t]);

  const removePair = useCallback((index: number) => {
    setPairs((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const restart = useCallback(() => {
    setPairs([]);
    setPendingNavvis(null);
    setTripodPos(null);
    setViewDir(null);
    setCaptureStep('picking360');
    setCaptureError(null);
  }, []);

  const fitResult = useMemo<SimilarityFitResult | { error: string } | null>(() => {
    if (pairs.length < MIN_PAIRS) return null;
    try {
      return fitSimilarityTransform(pairs);
    } catch (e) {
      return { error: getErrorMessage(e) };
    }
  }, [pairs]);

  const canSave = fitResult && !('error' in fitResult);

  const handleSave = useCallback(async () => {
    if (!canSave || !fitResult || 'error' in fitResult) return;
    setIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('viewer-annotations', {
        body: {
          action: 'save-spatial-transform',
          buildingFmGuid,
          matrix4x4: fitResult.matrix4x4,
          residualErrorMm: fitResult.residualErrorMm,
          calibrationPoints: pairs,
        },
      });
      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Unknown error');
      }
      toast.success(t(`Kalibrering v${data.transform?.version} sparad`, `Calibration v${data.transform?.version} saved`));
      onSaved?.(fitResult);
      onClose();
    } catch (e) {
      logger.warn('[CalibrationScreen] Failed to save calibration:', e);
      toast.error(t('Kunde inte spara kalibrering', 'Could not save calibration'), { description: getErrorMessage(e) });
    } finally {
      setIsSaving(false);
    }
  }, [canSave, fitResult, pairs, buildingFmGuid, onSaved, onClose, t]);

  return (
    <div className="w-96 bg-card/95 backdrop-blur-xl border border-border rounded-lg shadow-lg p-4 space-y-3 text-foreground max-h-[80vh] overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{t('Flerpunktskalibrering', 'Multi-point calibration')}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={restart} title={t('Starta om', 'Restart')} disabled={pairs.length === 0 && !pendingNavvis}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title={t('Stäng', 'Close')}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <p className="text-2xs text-muted-foreground leading-relaxed">
        {t(
          'Klicka på minst 2 motsvarande punkter i 360°-vyn och 3D-vyn (hörn, dörrar, pelare — sprid dem över rummet för bäst resultat). Varje par läggs till nedan.',
          'Click at least 2 corresponding points in the 360° view and the 3D view (corners, doors, columns — spread them across the room for the best result). Each pair is added below.',
        )}
      </p>

      {/* Distance slider while capturing */}
      <div className="bg-muted/50 rounded-md p-2 space-y-1.5">
        <div className="flex items-center justify-between text-2xs">
          <span className="flex items-center gap-1 text-foreground/70">
            <Ruler className="h-3 w-3" />
            {t('Avstånd till yta', 'Distance to surface')}
          </span>
          <span className="font-mono text-foreground">{rayDistance.toFixed(1)} m</span>
        </div>
        <Slider value={[rayDistance]} onValueChange={([v]) => setRayDistance(v)} min={0.5} max={10} step={0.1} className="w-full" />
      </div>

      {/* Current capture status */}
      <div className={`flex items-start gap-2 p-2 rounded-md text-xs ${captureStep === 'picking360' ? 'bg-primary/10 border border-primary/30' : 'bg-muted/50'}`}>
        <div className={`shrink-0 mt-0.5 h-5 w-5 rounded-full flex items-center justify-center text-2xs font-bold ${pendingNavvis ? 'bg-success text-success-foreground' : 'bg-foreground/20 text-foreground/70'}`}>
          {pendingNavvis ? <Check className="h-3 w-3" /> : '1'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-foreground">
            {captureStep === 'picking360' ? t('Klicka i 360°-vyn', 'Click in the 360° view') : t('Klicka på samma punkt i 3D', 'Click the same point in 3D')}
          </p>
          {captureStep === 'picking360' ? (
            <div className="flex items-center gap-1.5 text-primary mt-1">
              <MousePointerClick className="h-3 w-3" />
              <span className="text-2xs font-medium animate-pulse">{t('Väntar på klick i 360°...', 'Waiting for click in 360°...')}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-primary mt-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="text-2xs font-medium animate-pulse">{t('Väntar på klick i 3D...', 'Waiting for click in 3D...')}</span>
            </div>
          )}
          {captureError && (
            <div className="flex items-start gap-1.5 text-destructive mt-1">
              <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
              <p className="text-2xs leading-snug">{captureError}</p>
            </div>
          )}
        </div>
      </div>

      {/* Collected pairs */}
      {pairs.length > 0 && (
        <div className="space-y-1">
          <p className="text-2xs text-muted-foreground">{t('Insamlade punktpar', 'Collected point pairs')} ({pairs.length})</p>
          {pairs.map((pair, i) => (
            <div key={i} className="flex items-center justify-between gap-2 bg-muted/50 rounded-md p-1.5 text-2xs font-mono">
              <span className="text-foreground/70 truncate">
                360°: ({pair.navvis.x.toFixed(1)}, {pair.navvis.y.toFixed(1)}, {pair.navvis.z.toFixed(1)}) → 3D: ({pair.xeokit.x.toFixed(1)}, {pair.xeokit.y.toFixed(1)}, {pair.xeokit.z.toFixed(1)})
              </span>
              <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removePair(i)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Fit result */}
      {pairs.length > 0 && pairs.length < MIN_PAIRS && (
        <p className="text-2xs text-muted-foreground">{t(`Lägg till minst ${MIN_PAIRS} punktpar för att beräkna kalibreringen.`, `Add at least ${MIN_PAIRS} point pairs to compute the calibration.`)}</p>
      )}

      {fitResult && 'error' in fitResult && (
        <div className="flex items-start gap-1.5 text-destructive text-2xs">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <p>{fitResult.error}</p>
        </div>
      )}

      {fitResult && !('error' in fitResult) && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="bg-muted/50 rounded-md p-2 text-2xs font-mono space-y-0.5">
            <div className="flex justify-between"><span className="text-foreground/70">{t('Rotation', 'Rotation')}:</span><span>{fitResult.rotationDeg.toFixed(2)}°</span></div>
            <div className="flex justify-between"><span className="text-foreground/70">{t('Skala', 'Scale')}:</span><span>{fitResult.scale.toFixed(4)}</span></div>
            <div className="flex justify-between"><span className="text-foreground/70">{t('Residualfel (RMS)', 'Residual error (RMS)')}:</span>
              <span className={fitResult.residualErrorMm > 50 ? 'text-warning' : 'text-success'}>{fitResult.residualErrorMm.toFixed(1)} mm</span>
            </div>
          </div>
          {fitResult.residualErrorMm > 50 && (
            <p className="text-2xs text-warning">
              {t('Felet är över 5 cm — kontrollera att punkterna är korrekt matchade, eller lägg till fler spridda punkter.', 'Error is above 5 cm — check the points are correctly matched, or add more spread-out points.')}
            </p>
          )}
          <Button size="sm" className="w-full h-7 text-xs gap-1.5" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {t('Spara som ny version', 'Save as new version')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default CalibrationScreen;
