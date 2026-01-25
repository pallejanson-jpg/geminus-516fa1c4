import React, { createContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';
import { fetchLocalAssets } from '@/services/asset-plus-service';

type NavigatorNode = {
    fmGuid: string;
    category?: string;
    commonName?: string;
    name?: string;
    children?: NavigatorNode[];
    [key: string]: any;
};

// Asset registration context for the 3D-assisted registration flow
export interface AssetRegistrationContext {
    parentNode: NavigatorNode;
    buildingFmGuid: string;
    storeyFmGuid?: string;
    spaceFmGuid?: string;
}

export type ThemeType = 'dark' | 'light' | 'swg';

interface AppContextType {
    theme: ThemeType;
    setTheme: (theme: ThemeType) => void;
    allData: any[];
    setAllData: (data: any[]) => void;
    appConfigs: Record<string, any>;
    setAppConfigs: (configs: Record<string, any>) => void;
    activeApp: string;
    setActiveApp: (app: string) => void;
    viewMode: string;
    setViewMode: (mode: string) => void;
    isRightSidebarVisible: boolean;
    toggleRightSidebar: () => void;
    selectedFacility: any;
    setSelectedFacility: (facility: any) => void;
    isSidebarExpanded: boolean;
    setIsSidebarExpanded: (expanded: boolean) => void;

    // Navigator / Asset+ prefetch
    isLoadingData: boolean;
    navigatorTreeData: NavigatorNode[];
    refreshInitialData: () => Promise<void>;

    // Navigator selection from AI (Gunnar)
    aiSelectedFmGuids: string[];
    setAiSelectedFmGuids: (fmGuids: string[]) => void;
    clearAiSelection: () => void;

    // 3D Viewer
    viewer3dFmGuid: string | null;
    setViewer3dFmGuid: (fmGuid: string | null) => void;

    // Asset registration flow with 3D support
    assetRegistrationContext: AssetRegistrationContext | null;
    startAssetRegistration: (context: AssetRegistrationContext) => void;
    cancelAssetRegistration: () => void;

    // 3D Viewer diagnostics (for RightSidebar)
    viewerDiagnostics: {
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
    } | null;
    setViewerDiagnostics: (diag: AppContextType["viewerDiagnostics"]) => void;
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

    viewerDiagnostics: null,
    setViewerDiagnostics: () => {},
});

export const useApp = () => React.useContext(AppContext);

interface AppProviderProps {
    children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
    const [theme, setTheme] = useState<ThemeType>(() => {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem('theme') : null;
        if (stored === 'light' || stored === 'swg') return stored;
        return 'dark';
    });
    const [allData, setAllData] = useState<any[]>([]);
    const [appConfigs, setAppConfigs] = useState(() => {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem('appConfigs') : null;
        if (stored) {
            try {
                return { ...DEFAULT_APP_CONFIGS, ...JSON.parse(stored) };
            } catch (e) {
                return DEFAULT_APP_CONFIGS;
            }
        }
        return DEFAULT_APP_CONFIGS;
    });
    const [activeApp, setActiveApp] = useState('home');
    const [viewMode, setViewMode] = useState('grid');
    const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);
    const [selectedFacility, setSelectedFacility] = useState<any>(null);
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

    const [isLoadingData, setIsLoadingData] = useState(false);
    const [navigatorTreeData, setNavigatorTreeData] = useState<NavigatorNode[]>([]);
    const [viewer3dFmGuid, setViewer3dFmGuidInternal] = useState<string | null>(null);
    const [aiSelectedFmGuids, setAiSelectedFmGuids] = useState<string[]>([]);
    // Track previous app before opening 3D viewer for proper navigation on close
    const [previousAppBeforeViewer, setPreviousAppBeforeViewer] = useState<string>('home');

    // Wrapper: automatically switch to viewer app when fmGuid is set, and return to previous app when cleared
    const setViewer3dFmGuid = useCallback((fmGuid: string | null) => {
        if (fmGuid) {
            // Save current app before switching to viewer
            setPreviousAppBeforeViewer(activeApp);
            setViewer3dFmGuidInternal(fmGuid);
            setActiveApp('assetplus_viewer');
        } else {
            // Return to previous app when closing viewer
            setViewer3dFmGuidInternal(null);
            setActiveApp(previousAppBeforeViewer);
        }
    }, [activeApp, previousAppBeforeViewer]);

    const clearAiSelection = useCallback(() => {
        setAiSelectedFmGuids([]);
    }, []);

    const [viewerDiagnostics, setViewerDiagnostics] = useState<AppContextType["viewerDiagnostics"]>(null);

    // Asset registration flow state
    const [assetRegistrationContext, setAssetRegistrationContext] = useState<AssetRegistrationContext | null>(null);

    const startAssetRegistration = useCallback((context: AssetRegistrationContext) => {
        setAssetRegistrationContext(context);
        // Save current app and switch to asset registration mode
        setPreviousAppBeforeViewer(activeApp);
        // Navigate to the building that contains the space
        setViewer3dFmGuidInternal(context.buildingFmGuid);
        setActiveApp('asset_registration');
    }, [activeApp]);

    const cancelAssetRegistration = useCallback(() => {
        setAssetRegistrationContext(null);
        setViewer3dFmGuidInternal(null);
        setActiveApp(previousAppBeforeViewer);
    }, [previousAppBeforeViewer]);

    const buildNavigatorTree = useCallback((items: any[]): NavigatorNode[] => {
        // STRICT HIERARCHY: Building → Building Storey → Space
        // No other categories or orphan attachments allowed
        const buildings = items.filter(item => item.category === 'Building');
        const storeys = items.filter(item => item.category === 'Building Storey');
        const spaces = items.filter(item => item.category === 'Space');

        // Build building map first
        const buildingMap = new Map<string, NavigatorNode>();
        
        if (buildings.length > 0) {
            buildings.forEach((building: any) => {
                buildingMap.set(building.fmGuid, { ...building, children: [] });
            });
        } else {
            // Synthesize buildings from unique buildingFmGuid values in storeys
            const buildingInfo = new Map<string, { commonName?: string; name?: string; complexCommonName?: string }>();
            
            storeys.forEach((storey: any) => {
                const bguid = storey.buildingFmGuid;
                if (bguid && !buildingInfo.has(bguid)) {
                    const attrs = storey.attributes || {};
                    buildingInfo.set(bguid, {
                        commonName: attrs.buildingCommonName || attrs.buildingDesignation || undefined,
                        name: attrs.buildingDesignation || undefined,
                        complexCommonName: storey.complexCommonName || attrs.complexCommonName || undefined,
                    });
                }
            });

            buildingInfo.forEach((info, bguid) => {
                buildingMap.set(bguid, {
                    fmGuid: bguid,
                    category: 'Building',
                    commonName: info.commonName || info.name || `Byggnad ${bguid.substring(0, 8)}`,
                    name: info.name,
                    complexCommonName: info.complexCommonName,
                    children: [],
                });
            });
        }

        // Build storey map - only storeys that belong to a known building
        const storeyMap = new Map<string, NavigatorNode>();
        storeys.forEach((storey: any) => {
            if (buildingMap.has(storey.buildingFmGuid)) {
                storeyMap.set(storey.fmGuid, { ...storey, children: [] });
            }
        });

        // Attach storeys to buildings
        storeyMap.forEach((storey) => {
            const parentBuilding = buildingMap.get((storey as any).buildingFmGuid);
            if (parentBuilding) {
                parentBuilding.children!.push(storey);
            }
        });

        // Attach spaces ONLY to storeys - strict hierarchy, no orphan spaces
        spaces.forEach((space: any) => {
            const parentStorey = storeyMap.get(space.levelFmGuid);
            if (parentStorey) {
                // Space belongs to a known storey - add it
                parentStorey.children!.push({ ...space, children: [] });
            }
            // Spaces without valid levelFmGuid are excluded from the tree
        });

        const sortedTree = Array.from(buildingMap.values());

        const sortNode = (node: NavigatorNode) => {
            if (!node.children?.length) return;
            node.children.sort((a, b) =>
                (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '', undefined, { numeric: true }),
            );
            node.children.forEach(sortNode);
        };

        sortedTree.forEach(sortNode);
        sortedTree.sort((a, b) => (a.commonName || a.name || '').localeCompare(b.commonName || b.name || ''));

        return sortedTree;
    }, []);

    const refreshInitialData = useCallback(async () => {
        setIsLoadingData(true);
        try {
            // Fetch from local synced database instead of external API
            // Doors excluded from navigator per user request
            const allObjects = await fetchLocalAssets([
                'Building',
                'Building Storey',
                'Space',
            ]);
            setAllData(allObjects);
            setNavigatorTreeData(buildNavigatorTree(allObjects));
        } catch (error) {
            console.error('Failed to load assets:', error);
        } finally {
            setIsLoadingData(false);
        }
    }, [buildNavigatorTree, setAllData]);

    const toggleRightSidebar = useCallback(() => {
        setIsRightSidebarVisible(prev => !prev);
    }, []);

    // Apply theme class to the document so Tailwind's dark/swg tokens take effect.
    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('dark', 'swg');
        if (theme === 'dark' || theme === 'swg') {
            root.classList.add(theme);
        }
        window.localStorage.setItem('theme', theme);
    }, [theme]);

    // Startup prefetch (same pattern as Firebase: one fetch returning a flat list, then tree build)
    useEffect(() => {
        // Don't block initial render; Navigator will show loading/empty state if user opens it early.
        refreshInitialData().catch((e) => {
            console.error('Failed to prefetch Asset+ data:', e);
        });
    }, [refreshInitialData]);

    return (
        <AppContext.Provider
            value={{
                theme,
                setTheme,
                allData,
                setAllData,
                appConfigs,
                setAppConfigs,
                activeApp,
                setActiveApp,
                viewMode,
                setViewMode,
                isRightSidebarVisible,
                toggleRightSidebar,
                selectedFacility,
                setSelectedFacility,
                isSidebarExpanded,
                setIsSidebarExpanded,

                isLoadingData,
                navigatorTreeData,
                refreshInitialData,

                aiSelectedFmGuids,
                setAiSelectedFmGuids,
                clearAiSelection,

                viewer3dFmGuid,
                setViewer3dFmGuid,

                assetRegistrationContext,
                startAssetRegistration,
                cancelAssetRegistration,

                viewerDiagnostics,
                setViewerDiagnostics,
            }}
        >
            {children}
        </AppContext.Provider>
    );
};
