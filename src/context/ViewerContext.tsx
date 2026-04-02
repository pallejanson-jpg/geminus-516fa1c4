import React, { createContext, useState, useCallback, useContext, ReactNode } from 'react';

// Asset registration context for the 3D-assisted registration flow
export interface AssetRegistrationContext {
  parentNode: any;
  buildingFmGuid: string;
  storeyFmGuid?: string;
  spaceFmGuid?: string;
}

// Inventory prefill context for contextual registration
export interface InventoryPrefill {
  buildingFmGuid?: string;
  levelFmGuid?: string;
  roomFmGuid?: string;
}

// Fault report prefill context
export interface FaultReportPrefill {
  buildingFmGuid?: string;
  buildingName?: string;
  spaceFmGuid?: string;
  spaceName?: string;
}

// Annotation placement context for placing orphan assets in 3D
export interface AnnotationPlacementContext {
  asset: any;
  buildingFmGuid: string;
}

interface ViewerContextType {
  viewer3dFmGuid: string | null;
  setViewer3dFmGuid: (fmGuid: string | null) => void;

  assetRegistrationContext: AssetRegistrationContext | null;
  startAssetRegistration: (context: AssetRegistrationContext) => void;
  cancelAssetRegistration: () => void;

  inventoryPrefill: InventoryPrefill | null;
  startInventory: (prefill: InventoryPrefill) => void;
  clearInventoryPrefill: () => void;

  faultReportPrefill: FaultReportPrefill | null;
  startFaultReport: (prefill: FaultReportPrefill) => void;
  clearFaultReportPrefill: () => void;

  annotationPlacementContext: AnnotationPlacementContext | null;
  startAnnotationPlacement: (asset: any, buildingFmGuid: string) => void;
  completeAnnotationPlacement: (coordinates: { x: number; y: number; z: number }) => void;
  cancelAnnotationPlacement: () => void;

  // AI selection
  aiSelectedFmGuids: string[];
  setAiSelectedFmGuids: (fmGuids: string[]) => void;
  clearAiSelection: () => void;

  // Diagnostics
  viewerDiagnostics: ViewerDiagnostics | null;
  setViewerDiagnostics: (diag: ViewerDiagnostics | null) => void;
}

export interface ViewerDiagnostics {
  fmGuid: string;
  initStep: string;
  modelLoadState: string;
  modelCount: number | null;
  xkt: { attempted: number; ok: number; fail: number };
  lastError: { status?: number; message?: string; timedOut?: boolean } | null;
  lastRequests: Array<{
    tag: string;
    method: string;
    url: string;
    status?: number;
    durationMs?: number;
    error?: string;
    timedOut?: boolean;
  }>;
  updatedAt: number;
}

export const ViewerContext = createContext<ViewerContextType>({
  viewer3dFmGuid: null,
  setViewer3dFmGuid: () => {},
  assetRegistrationContext: null,
  startAssetRegistration: () => {},
  cancelAssetRegistration: () => {},
  inventoryPrefill: null,
  startInventory: () => {},
  clearInventoryPrefill: () => {},
  faultReportPrefill: null,
  startFaultReport: () => {},
  clearFaultReportPrefill: () => {},
  annotationPlacementContext: null,
  startAnnotationPlacement: () => {},
  completeAnnotationPlacement: () => {},
  cancelAnnotationPlacement: () => {},
  aiSelectedFmGuids: [],
  setAiSelectedFmGuids: () => {},
  clearAiSelection: () => {},
  viewerDiagnostics: null,
  setViewerDiagnostics: () => {},
});

export const useViewer = () => useContext(ViewerContext);

interface ViewerProviderProps {
  children: ReactNode;
  /** Read activeApp from NavigationContext to handle viewer auto-switching */
  activeApp: string;
  setActiveApp: (app: string) => void;
}

export const ViewerProvider: React.FC<ViewerProviderProps> = ({ children, activeApp, setActiveApp }) => {
  const [viewer3dFmGuidInternal, setViewer3dFmGuidInternal] = useState<string | null>(null);
  const [previousAppBeforeViewer, setPreviousAppBeforeViewer] = useState<string>('home');
  const [aiSelectedFmGuids, setAiSelectedFmGuids] = useState<string[]>([]);
  const [viewerDiagnostics, setViewerDiagnostics] = useState<ViewerDiagnostics | null>(null);
  const [assetRegistrationContext, setAssetRegistrationContext] = useState<AssetRegistrationContext | null>(null);
  const [inventoryPrefill, setInventoryPrefill] = useState<InventoryPrefill | null>(null);
  const [faultReportPrefill, setFaultReportPrefill] = useState<FaultReportPrefill | null>(null);
  const [annotationPlacementContext, setAnnotationPlacementContext] = useState<AnnotationPlacementContext | null>(null);

  const setViewer3dFmGuid = useCallback((fmGuid: string | null) => {
    if (fmGuid) {
      setPreviousAppBeforeViewer(activeApp);
      setViewer3dFmGuidInternal(fmGuid);
      setActiveApp('native_viewer');
      return;
    }
    const forcedReturnApp = typeof window !== 'undefined'
      ? window.sessionStorage.getItem('viewer-return-app')
      : null;
    if (forcedReturnApp && typeof window !== 'undefined') {
      window.sessionStorage.removeItem('viewer-return-app');
    }
    setViewer3dFmGuidInternal(null);
    setActiveApp(forcedReturnApp || previousAppBeforeViewer);
  }, [activeApp, previousAppBeforeViewer, setActiveApp]);

  const clearAiSelection = useCallback(() => setAiSelectedFmGuids([]), []);

  const startAssetRegistration = useCallback((context: AssetRegistrationContext) => {
    setAssetRegistrationContext(context);
    setPreviousAppBeforeViewer(activeApp);
    setViewer3dFmGuidInternal(context.buildingFmGuid);
    setActiveApp('asset_registration');
  }, [activeApp, setActiveApp]);

  const cancelAssetRegistration = useCallback(() => {
    setAssetRegistrationContext(null);
    setViewer3dFmGuidInternal(null);
    setActiveApp(previousAppBeforeViewer);
  }, [previousAppBeforeViewer, setActiveApp]);

  const startInventory = useCallback((prefill: InventoryPrefill) => {
    setInventoryPrefill(prefill);
    setActiveApp('inventory');
  }, [setActiveApp]);

  const clearInventoryPrefill = useCallback(() => setInventoryPrefill(null), []);

  const startFaultReport = useCallback((prefill: FaultReportPrefill) => {
    setFaultReportPrefill(prefill);
    setActiveApp('fault_report');
  }, [setActiveApp]);

  const clearFaultReportPrefill = useCallback(() => setFaultReportPrefill(null), []);

  const startAnnotationPlacement = useCallback((asset: any, buildingFmGuid: string) => {
    setAnnotationPlacementContext({ asset, buildingFmGuid });
    setPreviousAppBeforeViewer(activeApp);
    setViewer3dFmGuidInternal(buildingFmGuid);
    setActiveApp('native_viewer');
  }, [activeApp, setActiveApp]);

  const completeAnnotationPlacement = useCallback((_coordinates: { x: number; y: number; z: number }) => {
    setAnnotationPlacementContext(null);
  }, []);

  const cancelAnnotationPlacement = useCallback(() => {
    setAnnotationPlacementContext(null);
    setViewer3dFmGuidInternal(null);
    setActiveApp(previousAppBeforeViewer);
  }, [previousAppBeforeViewer, setActiveApp]);

  return (
    <ViewerContext.Provider
      value={{
        viewer3dFmGuid: viewer3dFmGuidInternal,
        setViewer3dFmGuid,
        assetRegistrationContext, startAssetRegistration, cancelAssetRegistration,
        inventoryPrefill, startInventory, clearInventoryPrefill,
        faultReportPrefill, startFaultReport, clearFaultReportPrefill,
        annotationPlacementContext, startAnnotationPlacement, completeAnnotationPlacement, cancelAnnotationPlacement,
        aiSelectedFmGuids, setAiSelectedFmGuids, clearAiSelection,
        viewerDiagnostics, setViewerDiagnostics,
      }}
    >
      {children}
    </ViewerContext.Provider>
  );
};
