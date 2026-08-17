/**
 * IndoorWayfindingPanel — turn-by-turn "walk me there" UI for an active indoor route.
 * Steps through generateIndoorSteps(route), flying the 3D camera to each step and
 * auto-switching the visible floor when a step crosses a floor transition.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, CheckCircle2, X, Footprints, MoveUp, ArrowUpDown, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/context/LanguageContext';
import { emit, on } from '@/lib/event-bus';
import { useFloorData } from '@/hooks/useFloorData';
import { getXeokitViewerFromRef, useFloorVisibility } from '@/hooks/useFloorVisibility';
import { generateIndoorSteps, type RouteResult, type IndoorStep } from '@/lib/pathfinding';
import { findFloorForGuid, inferStepFloors, resolveStepWorldPositions } from '@/lib/indoor-route-3d';

interface IndoorWayfindingPanelProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  isViewerReady: boolean;
  route: RouteResult | null;
  onClose?: () => void;
}

const StepIcon: React.FC<{ type: IndoorStep['type'] }> = ({ type }) => {
  switch (type) {
    case 'stairs': return <MoveUp className="h-4 w-4" />;
    case 'elevator': return <ArrowUpDown className="h-4 w-4" />;
    case 'arrive': return <CheckCircle2 className="h-4 w-4" />;
    case 'turn': return <ArrowRight className="h-4 w-4" />;
    default: return <Footprints className="h-4 w-4" />;
  }
};

const IndoorWayfindingPanel: React.FC<IndoorWayfindingPanelProps> = ({
  viewerRef, buildingFmGuid, isViewerReady, route, onClose,
}) => {
  const { t } = useLanguage();
  const { floors } = useFloorData(viewerRef, buildingFmGuid);
  const { applyFloorVisibility } = useFloorVisibility(viewerRef);
  const [stepIndex, setStepIndex] = useState(0);
  const lastAppliedFloorIdRef = useRef<string | null>(null);
  const flownStepRef = useRef<number | null>(null);
  const stepIndexRef = useRef(0);
  stepIndexRef.current = stepIndex;

  const steps = useMemo(() => (route ? generateIndoorSteps(route) : []), [route]);
  const stepFloors = useMemo(() => (route ? inferStepFloors(route, steps) : []), [route, steps]);

  const worldPositions = useMemo(() => {
    if (!route || !isViewerReady || steps.length === 0) return [];
    const viewer = getXeokitViewerFromRef(viewerRef);
    if (!viewer?.scene) return [];
    return resolveStepWorldPositions(viewer, floors, route, steps);
  }, [route, steps, floors, isViewerReady, viewerRef]);

  // A new route always starts back at step 0.
  useEffect(() => {
    setStepIndex(0);
    lastAppliedFloorIdRef.current = null;
    flownStepRef.current = null;
  }, [route]);

  // Keep the visible floor in sync with the current step.
  useEffect(() => {
    if (!route || floors.length === 0) return;
    const floorGuid = stepFloors[stepIndex];
    if (!floorGuid) return;
    const floor = findFloorForGuid(floors, floorGuid);
    if (!floor || lastAppliedFloorIdRef.current === floor.id) return;
    lastAppliedFloorIdRef.current = floor.id;

    applyFloorVisibility(floors, new Set([floor.id]));
    emit('FLOOR_SELECTION_CHANGED', {
      floorId: floor.id,
      floorName: floor.name,
      visibleMetaFloorIds: floor.metaObjectIds,
      visibleFloorFmGuids: floor.databaseLevelFmGuids,
      isAllFloorsVisible: false,
      isSoloFloor: true,
      skipClipping: false,
    });
  }, [stepIndex, stepFloors, floors, route, applyFloorVisibility]);

  const worldPositionsRef = useRef(worldPositions);
  worldPositionsRef.current = worldPositions;

  // Fly the camera to a given step, looking toward the next one (or the previous, at the end).
  const flyToStep = useCallback((index: number, duration = 1.0) => {
    const positions = worldPositionsRef.current;
    if (positions.length === 0) return;
    const viewer = getXeokitViewerFromRef(viewerRef);
    if (!viewer?.cameraFlight) return;

    const pos = positions[index];
    const aheadPos = positions[index + 1] || positions[index - 1] || pos;
    const dx = aheadPos[0] - pos[0];
    const dz = aheadPos[2] - pos[2];
    const len = Math.hypot(dx, dz) || 1;
    const dirX = dx / len;
    const dirZ = dz / len;

    viewer.cameraFlight.flyTo({
      eye: [pos[0] - dirX * 4, pos[1] + 3, pos[2] - dirZ * 4],
      look: [pos[0] + dirX * 2, pos[1] + 1, pos[2] + dirZ * 2],
      up: [0, 1, 0],
      duration,
    });
  }, [viewerRef]);

  // Fly whenever the step changes.
  useEffect(() => {
    if (!route || worldPositions.length === 0) return;
    if (flownStepRef.current === stepIndex) return;
    flownStepRef.current = stepIndex;
    flyToStep(stepIndex);
  }, [stepIndex, worldPositions, route, flyToStep]);

  // Re-assert the wayfinding camera after the model (re)loads. Other systems (a
  // building's configured "start view", an instant fit-to-model on first load) also
  // react to this same event — this makes the active route win the camera regardless
  // of listener order or how many such systems exist.
  useEffect(() => {
    if (!route) return;
    return on('VIEWER_MODELS_LOADED', () => {
      setTimeout(() => flyToStep(stepIndexRef.current, 0), 500);
    });
  }, [route, flyToStep]);

  const goNext = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const goPrev = useCallback(() => {
    setStepIndex(i => Math.max(i - 1, 0));
  }, []);

  if (!route || steps.length === 0) return null;

  const current = steps[stepIndex];
  const isArrived = stepIndex === steps.length - 1;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,26rem)]">
      <div className="bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-xl p-3 flex items-center gap-3">
        <div className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center ${isArrived ? 'bg-emerald-500/15 text-emerald-500' : 'bg-primary/15 text-primary'}`}>
          {isArrived ? <CheckCircle2 className="h-5 w-5" /> : <Navigation className="h-4 w-4" />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
            <StepIcon type={current.type} />
            {current.instruction}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('Steg', 'Step')} {stepIndex + 1}/{steps.length}
            {current.distance > 0 && ` · ${Math.round(current.distance)} m`}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="secondary" size="icon" className="h-8 w-8" onClick={goPrev} disabled={stepIndex === 0}>
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="secondary" size="icon" className="h-8 w-8" onClick={goNext} disabled={isArrived}>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default IndoorWayfindingPanel;
