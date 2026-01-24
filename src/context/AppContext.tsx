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
    const [appConfigs, setAppConfigs] = useState(DEFAULT_APP_CONFIGS);
    const [activeApp, setActiveApp] = useState('home');
    const [viewMode, setViewMode] = useState('grid');
    const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);
    const [selectedFacility, setSelectedFacility] = useState<any>(null);
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

    const [isLoadingData, setIsLoadingData] = useState(false);
    const [navigatorTreeData, setNavigatorTreeData] = useState<NavigatorNode[]>([]);
    const [viewer3dFmGuid, setViewer3dFmGuidInternal] = useState<string | null>(null);
    const [aiSelectedFmGuids, setAiSelectedFmGuids] = useState<string[]>([]);

    // Wrapper: automatically switch to viewer app when fmGuid is set
    const setViewer3dFmGuid = useCallback((fmGuid: string | null) => {
        setViewer3dFmGuidInternal(fmGuid);
        if (fmGuid) {
            setActiveApp('assetplus_viewer');
        }
    }, []);

    const clearAiSelection = useCallback(() => {
        setAiSelectedFmGuids([]);
    }, []);

    const [viewerDiagnostics, setViewerDiagnostics] = useState<AppContextType["viewerDiagnostics"]>(null);

    const buildNavigatorTree = useCallback((items: any[]): NavigatorNode[] => {
        const buildings = items.filter(item => item.category === 'Building');
        const storeys = items.filter(item => item.category === 'Building Storey');
        const spaces = items.filter(item => item.category === 'Space');
        // Doors excluded from hierarchy per user request

        // Build space nodes (no door children)
        const spaceMap = new Map<string, NavigatorNode>();
        spaces.forEach((space: any) => {
            spaceMap.set(space.fmGuid, { ...space, children: [] });
        });

        // Build storey nodes
        const storeyMap = new Map<string, NavigatorNode>();
        storeys.forEach((storey: any) => {
            storeyMap.set(storey.fmGuid, { ...storey, children: [] });
        });

        // Attach spaces to storeys via levelFmGuid
        spaceMap.forEach((space) => {
            const parentStorey = storeyMap.get((space as any).levelFmGuid);
            if (parentStorey) parentStorey.children!.push(space);
        });

        // Build building map - either from actual Building items or synthesize from unique buildingFmGuid
        const buildingMap = new Map<string, NavigatorNode>();
        
        if (buildings.length > 0) {
            // Use actual building records
            buildings.forEach((building: any) => {
                buildingMap.set(building.fmGuid, { ...building, children: [] });
            });
        } else {
            // Synthesize buildings from unique buildingFmGuid values in storeys
            // Use attributes from first storey or item to get building name and complex
            const buildingInfo = new Map<string, { commonName?: string; name?: string; complexCommonName?: string }>();
            
            [...storeys, ...spaces].forEach((item: any) => {
                const bguid = item.buildingFmGuid;
                if (bguid && !buildingInfo.has(bguid)) {
                    // Try to get building name from attributes
                    const attrs = item.attributes || {};
                    buildingInfo.set(bguid, {
                        commonName: attrs.buildingCommonName || attrs.buildingDesignation || undefined,
                        name: attrs.buildingDesignation || undefined,
                        complexCommonName: item.complexCommonName || attrs.complexCommonName || undefined,
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

        // Attach storeys to buildings
        storeyMap.forEach((storey) => {
            const parentBuilding = buildingMap.get((storey as any).buildingFmGuid);
            if (parentBuilding) parentBuilding.children!.push(storey);
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

                viewerDiagnostics,
                setViewerDiagnostics,
            }}
        >
            {children}
        </AppContext.Provider>
    );
};
