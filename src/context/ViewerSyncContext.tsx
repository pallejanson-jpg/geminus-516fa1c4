import React, { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react';

/**
 * Coordinates in local 3D space (xeokit)
 */
export interface LocalCoords {
  x: number;
  y: number;
  z: number;
}

/**
 * Sync state shared between 3D and 360° viewers
 */
export interface ViewerSyncState {
  /** Current position in local coordinates */
  position: LocalCoords | null;
  /** Camera heading in degrees (0-360, 0 = north) */
  heading: number;
  /** Camera pitch in degrees (-90 to 90) */
  pitch: number;
  /** Which viewer last updated the sync state */
  source: '3d' | 'ivion' | null;
  /** Timestamp of last update (for debouncing) */
  timestamp: number;
}

interface ViewerSyncContextType {
  /** Whether sync is locked (viewers follow each other) */
  syncLocked: boolean;
  /** Toggle sync lock on/off */
  setSyncLocked: (locked: boolean) => void;
  /** Current sync state */
  syncState: ViewerSyncState;
  /** Update sync state from 3D viewer */
  updateFrom3D: (position: LocalCoords, heading: number, pitch?: number) => void;
  /** Update sync state from Ivion 360° viewer */
  updateFromIvion: (position: LocalCoords, heading: number, pitch?: number) => void;
  /** Reset sync state */
  resetSync: () => void;
  /** Building context for coordinate transformation */
  buildingContext: {
    fmGuid: string;
    originLat?: number;
    originLng?: number;
    rotation?: number; // Building rotation in degrees relative to north
  } | null;
  /** Set building context */
  setBuildingContext: (context: ViewerSyncContextType['buildingContext']) => void;
}

const defaultSyncState: ViewerSyncState = {
  position: null,
  heading: 0,
  pitch: 0,
  source: null,
  timestamp: 0,
};

const ViewerSyncContext = createContext<ViewerSyncContextType>({
  syncLocked: true,
  setSyncLocked: () => {},
  syncState: defaultSyncState,
  updateFrom3D: () => {},
  updateFromIvion: () => {},
  resetSync: () => {},
  buildingContext: null,
  setBuildingContext: () => {},
});

export const useViewerSync = () => useContext(ViewerSyncContext);

interface ViewerSyncProviderProps {
  children: ReactNode;
  /** Initial building context */
  initialBuildingContext?: ViewerSyncContextType['buildingContext'];
}

export const ViewerSyncProvider: React.FC<ViewerSyncProviderProps> = ({ 
  children,
  initialBuildingContext = null 
}) => {
  const [syncLocked, setSyncLocked] = useState(true);
  const [syncState, setSyncState] = useState<ViewerSyncState>(defaultSyncState);
  const [buildingContext, setBuildingContext] = useState<ViewerSyncContextType['buildingContext']>(initialBuildingContext);
  
  // Debounce ref to prevent rapid updates
  const lastUpdateRef = useRef<number>(0);
  const DEBOUNCE_MS = 50; // Reduced for faster SDK-based sync

  const updateFrom3D = useCallback((position: LocalCoords, heading: number, pitch: number = 0) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < DEBOUNCE_MS) return;
    lastUpdateRef.current = now;

    setSyncState({
      position,
      heading,
      pitch,
      source: '3d',
      timestamp: now,
    });
  }, []);

  const updateFromIvion = useCallback((position: LocalCoords, heading: number, pitch: number = 0) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < DEBOUNCE_MS) return;
    lastUpdateRef.current = now;

    setSyncState({
      position,
      heading,
      pitch,
      source: 'ivion',
      timestamp: now,
    });
  }, []);

  const resetSync = useCallback(() => {
    setSyncState(defaultSyncState);
    lastUpdateRef.current = 0;
  }, []);

  return (
    <ViewerSyncContext.Provider
      value={{
        syncLocked,
        setSyncLocked,
        syncState,
        updateFrom3D,
        updateFromIvion,
        resetSync,
        buildingContext,
        setBuildingContext,
      }}
    >
      {children}
    </ViewerSyncContext.Provider>
  );
};

export default ViewerSyncContext;
