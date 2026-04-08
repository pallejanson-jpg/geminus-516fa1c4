/**
 * AppContext — backward-compatible facade that composes domain-specific contexts.
 *
 * All 68+ consumers continue to `useContext(AppContext)` without changes.
 * New code should prefer the domain-specific hooks:
 *   useTheme()      — src/context/ThemeContext.tsx
 *   useNavigation() — src/context/NavigationContext.tsx
 *   useViewer()     — src/context/ViewerContext.tsx
 *   useData()       — src/context/DataContext.tsx
 */

import React, { createContext, ReactNode, useContext } from 'react';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';
import type { Facility, NavigatorNode, AppConfig } from '@/lib/types';
import { ThemeProvider, ThemeContext, type ThemeType } from './ThemeContext';
import { NavigationProvider, NavigationContext, type Ivion360Context, type SenslincDashboardContext } from './NavigationContext';
import { ViewerProvider, ViewerContext, type AssetRegistrationContext, type InventoryPrefill, type FaultReportPrefill, type AnnotationPlacementContext, type ViewerDiagnostics } from './ViewerContext';
import { DataProvider, DataContext } from './DataContext';

// Re-export types for backward compatibility
export type { ThemeType } from './ThemeContext';
export type { AssetRegistrationContext, InventoryPrefill, FaultReportPrefill, AnnotationPlacementContext } from './ViewerContext';
export type { Ivion360Context, SenslincDashboardContext } from './NavigationContext';

// Use the shared NavigatorNode type from types.ts

interface AppContextType {
    theme: ThemeType;
    setTheme: (theme: ThemeType) => void;
    allData: Facility[];
    setAllData: (data: Facility[]) => void;
    appConfigs: Record<string, AppConfig>;
    setAppConfigs: (configs: Record<string, AppConfig>) => void;
    activeApp: string;
    setActiveApp: (app: string) => void;
    viewMode: string;
    setViewMode: (mode: string) => void;
    isRightSidebarVisible: boolean;
    toggleRightSidebar: () => void;
    selectedFacility: Facility | null;
    setSelectedFacility: (facility: Facility | null) => void;
    isSidebarExpanded: boolean;
    setIsSidebarExpanded: (expanded: boolean) => void;

    isLoadingData: boolean;
    navigatorTreeData: NavigatorNode[];
    refreshInitialData: () => Promise<void>;

    aiSelectedFmGuids: string[];
    setAiSelectedFmGuids: (fmGuids: string[]) => void;
    clearAiSelection: () => void;

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
    startAnnotationPlacement: (asset: Facility, buildingFmGuid: string) => void;
    completeAnnotationPlacement: (coordinates: { x: number; y: number; z: number }) => void;
    cancelAnnotationPlacement: () => void;

    insightsFacility: Facility | null;
    setInsightsFacility: (facility: Facility | null) => void;
    openEntityInsights: (facility: Facility) => void;

    ivion360Context: Ivion360Context | null;
    setIvion360Context: (context: Ivion360Context | null) => void;
    open360WithContext: (context: Ivion360Context) => void;

    senslincDashboardContext: SenslincDashboardContext | null;
    setSenslincDashboardContext: (context: SenslincDashboardContext | null) => void;
    openSenslincDashboard: (context: SenslincDashboardContext) => void;

    viewerDiagnostics: ViewerDiagnostics | null;
    setViewerDiagnostics: (diag: ViewerDiagnostics | null) => void;
}

export const AppContext = createContext<AppContextType>({
    theme: 'dark',
    setTheme: () => {},
    allData: [],
    setAllData: () => {},
    appConfigs: DEFAULT_APP_CONFIGS,
    setAppConfigs: () => {},
    activeApp: 'home',
    setActiveApp: () => {},
    viewMode: 'grid',
    setViewMode: () => {},
    isRightSidebarVisible: false,
    toggleRightSidebar: () => {},
    selectedFacility: null,
    setSelectedFacility: () => {},
    isSidebarExpanded: false,
    setIsSidebarExpanded: () => {},

    isLoadingData: false,
    navigatorTreeData: [],
    refreshInitialData: async () => {},

    aiSelectedFmGuids: [],
    setAiSelectedFmGuids: () => {},
    clearAiSelection: () => {},

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

    insightsFacility: null,
    setInsightsFacility: () => {},
    openEntityInsights: () => {},

    ivion360Context: null,
    setIvion360Context: () => {},
    open360WithContext: () => {},

    senslincDashboardContext: null,
    setSenslincDashboardContext: () => {},
    openSenslincDashboard: () => {},

    viewerDiagnostics: null,
    setViewerDiagnostics: () => {},
});

export const useApp = () => useContext(AppContext);

/**
 * AppContextBridge — reads from domain contexts and provides a unified AppContext value.
 * This is the key to backward compatibility: existing consumers read one merged object,
 * but under the hood each domain re-renders independently.
 */
const AppContextBridge: React.FC<{ children: ReactNode }> = ({ children }) => {
    const theme = useContext(ThemeContext);
    const nav = useContext(NavigationContext);
    const viewer = useContext(ViewerContext);
    const data = useContext(DataContext);

    const value: AppContextType = {
        // Theme
        theme: theme.theme,
        setTheme: theme.setTheme,
        // Navigation
        activeApp: nav.activeApp,
        setActiveApp: nav.setActiveApp,
        viewMode: nav.viewMode,
        setViewMode: nav.setViewMode,
        selectedFacility: nav.selectedFacility,
        setSelectedFacility: nav.setSelectedFacility,
        isSidebarExpanded: nav.isSidebarExpanded,
        setIsSidebarExpanded: nav.setIsSidebarExpanded,
        isRightSidebarVisible: nav.isRightSidebarVisible,
        toggleRightSidebar: nav.toggleRightSidebar,
        appConfigs: nav.appConfigs,
        setAppConfigs: nav.setAppConfigs,
        insightsFacility: nav.insightsFacility,
        setInsightsFacility: nav.setInsightsFacility,
        openEntityInsights: nav.openEntityInsights,
        ivion360Context: nav.ivion360Context,
        setIvion360Context: nav.setIvion360Context,
        open360WithContext: nav.open360WithContext,
        senslincDashboardContext: nav.senslincDashboardContext,
        setSenslincDashboardContext: nav.setSenslincDashboardContext,
        openSenslincDashboard: nav.openSenslincDashboard,
        // Viewer
        viewer3dFmGuid: viewer.viewer3dFmGuid,
        setViewer3dFmGuid: viewer.setViewer3dFmGuid,
        assetRegistrationContext: viewer.assetRegistrationContext,
        startAssetRegistration: viewer.startAssetRegistration,
        cancelAssetRegistration: viewer.cancelAssetRegistration,
        inventoryPrefill: viewer.inventoryPrefill,
        startInventory: viewer.startInventory,
        clearInventoryPrefill: viewer.clearInventoryPrefill,
        faultReportPrefill: viewer.faultReportPrefill,
        startFaultReport: viewer.startFaultReport,
        clearFaultReportPrefill: viewer.clearFaultReportPrefill,
        annotationPlacementContext: viewer.annotationPlacementContext,
        startAnnotationPlacement: viewer.startAnnotationPlacement,
        completeAnnotationPlacement: viewer.completeAnnotationPlacement,
        cancelAnnotationPlacement: viewer.cancelAnnotationPlacement,
        aiSelectedFmGuids: viewer.aiSelectedFmGuids,
        setAiSelectedFmGuids: viewer.setAiSelectedFmGuids,
        clearAiSelection: viewer.clearAiSelection,
        viewerDiagnostics: viewer.viewerDiagnostics,
        setViewerDiagnostics: viewer.setViewerDiagnostics,
        // Data
        allData: data.allData,
        setAllData: data.setAllData,
        isLoadingData: data.isLoadingData,
        navigatorTreeData: data.navigatorTreeData,
        refreshInitialData: data.refreshInitialData,
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
};

interface AppProviderProps {
    children: ReactNode;
}

/**
 * AppProvider — nests all domain providers and the backward-compat bridge.
 * Order: Theme → Data → Navigation → Viewer → Bridge → children
 *
 * ViewerProvider needs activeApp/setActiveApp from NavigationContext,
 * so we use an inner component to read NavigationContext and pass props.
 */
export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
    return (
        <ThemeProvider>
            <DataProvider>
                <NavigationProvider>
                    <ViewerBridge>
                        <AppContextBridge>
                            {children}
                        </AppContextBridge>
                    </ViewerBridge>
                </NavigationProvider>
            </DataProvider>
        </ThemeProvider>
    );
};

/** Inner bridge to pass NavigationContext values to ViewerProvider as props */
const ViewerBridge: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { activeApp, setActiveApp } = useContext(NavigationContext);
    return (
        <ViewerProvider activeApp={activeApp} setActiveApp={setActiveApp}>
            {children}
        </ViewerProvider>
    );
};
