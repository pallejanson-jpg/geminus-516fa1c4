/**
 * Drop-in replacement for src/context/ViewerSyncContext.tsx, backed by
 * ViewerCoordinator instead of a bare debounced setState.
 *
 * Same exported names and same `useViewerSync()` shape as the old context, so
 * callers (src/pages/UnifiedViewer.tsx, src/hooks/useIvionCameraSync.ts,
 * src/hooks/useViewerCameraSync.ts) only need their import path changed — no call-site
 * changes. Per Phase 1 of docs/plans/viewer-coordinator-spec-and-prompts.md,
 * src/context/ViewerSyncContext.tsx itself is left in place, unused, until this path
 * is confirmed working in production and the old file is deleted in a follow-up commit.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { ViewerCoordinator } from './ViewerCoordinator';
import type { SpatialPose, ViewerSource } from './types';

export interface LocalCoords {
  x: number;
  y: number;
  z: number;
}

export interface ViewerSyncState {
  position: LocalCoords | null;
  heading: number;
  pitch: number;
  source: '3d' | 'ivion' | null;
  timestamp: number;
}

interface ViewerSyncContextType {
  syncLocked: boolean;
  setSyncLocked: (locked: boolean) => void;
  syncState: ViewerSyncState;
  updateFrom3D: (position: LocalCoords, heading: number, pitch?: number) => void;
  updateFromIvion: (position: LocalCoords, heading: number, pitch?: number) => void;
  resetSync: () => void;
  buildingContext: {
    fmGuid: string;
    originLat?: number;
    originLng?: number;
    rotation?: number;
  } | null;
  setBuildingContext: (context: ViewerSyncContextType['buildingContext']) => void;
  /** New: the underlying coordinator, for code that wants to register real adapters (Phase 2+). */
  coordinator: ViewerCoordinator;
}

const defaultSyncState: ViewerSyncState = {
  position: null,
  heading: 0,
  pitch: 0,
  source: null,
  timestamp: 0,
};

function poseToLegacyState(pose: SpatialPose): ViewerSyncState {
  return {
    position: pose.position,
    heading: pose.orientation?.headingDeg ?? 0,
    pitch: pose.orientation?.pitchDeg ?? 0,
    source: pose.source === 'xeokit' ? '3d' : pose.source === 'ivion' ? 'ivion' : null,
    timestamp: pose.timestamp,
  };
}

const legacySourceToViewerSource: Record<'3d' | 'ivion', ViewerSource> = {
  '3d': 'xeokit',
  ivion: 'ivion',
};

// Matches the old ViewerSyncContext's behavior of providing harmless no-op defaults
// when used outside a provider, rather than throwing — some consumers (e.g. the dead
// GeminusPlusViewer.tsx branch) may render before/without ever entering the provider tree.
const defaultContextValue: ViewerSyncContextType = {
  syncLocked: true,
  setSyncLocked: () => {},
  syncState: defaultSyncState,
  updateFrom3D: () => {},
  updateFromIvion: () => {},
  resetSync: () => {},
  buildingContext: null,
  setBuildingContext: () => {},
  coordinator: new ViewerCoordinator(),
};

const ViewerCoordinatorSyncContext = createContext<ViewerSyncContextType>(defaultContextValue);

export const useViewerSync = (): ViewerSyncContextType => useContext(ViewerCoordinatorSyncContext);

interface ViewerSyncProviderProps {
  children: ReactNode;
  initialBuildingContext?: ViewerSyncContextType['buildingContext'];
}

export const ViewerSyncProvider: React.FC<ViewerSyncProviderProps> = ({
  children,
  initialBuildingContext = null,
}) => {
  const coordinatorRef = useRef<ViewerCoordinator | null>(null);
  if (!coordinatorRef.current) coordinatorRef.current = new ViewerCoordinator();

  const [syncLocked, setSyncLocked] = useState(true);
  const [syncState, setSyncState] = useState<ViewerSyncState>(defaultSyncState);
  const [buildingContext, setBuildingContext] = useState<ViewerSyncContextType['buildingContext']>(
    initialBuildingContext,
  );

  useEffect(() => {
    const coordinator = coordinatorRef.current!;
    return coordinator.onPoseChanged((pose) => setSyncState(poseToLegacyState(pose)));
  }, []);

  useEffect(() => {
    const coordinator = coordinatorRef.current!;
    return () => coordinator.destroy();
  }, []);

  const submit = useCallback(
    (legacySource: '3d' | 'ivion', position: LocalCoords, heading: number, pitch: number) => {
      const coordinator = coordinatorRef.current!;
      coordinator.submitPose({
        buildingFmGuid: buildingContext?.fmGuid ?? '',
        position,
        orientation: { headingDeg: heading, pitchDeg: pitch },
        coordinateSystem: 'geminus-local',
        timestamp: performance.now(),
        source: legacySourceToViewerSource[legacySource],
        transactionId: crypto.randomUUID(),
      });
    },
    [buildingContext],
  );

  const updateFrom3D = useCallback(
    (position: LocalCoords, heading: number, pitch: number = 0) => submit('3d', position, heading, pitch),
    [submit],
  );

  const updateFromIvion = useCallback(
    (position: LocalCoords, heading: number, pitch: number = 0) => submit('ivion', position, heading, pitch),
    [submit],
  );

  const resetSync = useCallback(() => {
    coordinatorRef.current!.reset();
    setSyncState(defaultSyncState);
  }, []);

  return (
    <ViewerCoordinatorSyncContext.Provider
      value={{
        syncLocked,
        setSyncLocked,
        syncState,
        updateFrom3D,
        updateFromIvion,
        resetSync,
        buildingContext,
        setBuildingContext,
        coordinator: coordinatorRef.current,
      }}
    >
      {children}
    </ViewerCoordinatorSyncContext.Provider>
  );
};

export default ViewerCoordinatorSyncContext;
