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
    asset: any; // The asset to place annotation for
    buildingFmGuid: string;
}

// 360+ viewer context for context-aware inventory tools
export interface Ivion360Context {
    buildingFmGuid: string;
    buildingName?: string;
    ivionSiteId: string;
    ivionUrl: string;
}

// Senslinc IoT dashboard context
export interface SenslincDashboardContext {
    dashboardUrl: string;
    facilityName?: string;
    facilityFmGuid?: string;
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

    // Inventory prefill for contextual registration
    inventoryPrefill: InventoryPrefill | null;
    startInventory: (prefill: InventoryPrefill) => void;
    clearInventoryPrefill: () => void;

    // Fault report prefill for contextual reporting
    faultReportPrefill: FaultReportPrefill | null;
    startFaultReport: (prefill: FaultReportPrefill) => void;
    clearFaultReportPrefill: () => void;

    // Annotation placement for orphan assets
    annotationPlacementContext: AnnotationPlacementContext | null;
    startAnnotationPlacement: (asset: any, buildingFmGuid: string) => void;
    completeAnnotationPlacement: (coordinates: { x: number; y: number; z: number }) => void;
    cancelAnnotationPlacement: () => void;

// Entity insights - for viewing insights at any hierarchy level
    insightsFacility: any | null;
    setInsightsFacility: (facility: any | null) => void;
    openEntityInsights: (facility: any) => void;

    // 360+ viewer context - for context-aware inventory tools
    ivion360Context: Ivion360Context | null;
    setIvion360Context: (context: Ivion360Context | null) => void;
    open360WithContext: (context: Ivion360Context) => void;

    // Senslinc IoT dashboard context
    senslincDashboardContext: SenslincDashboardContext | null;
    setSenslincDashboardContext: (context: SenslincDashboardContext | null) => void;
    openSenslincDashboard: (context: SenslincDashboardContext) => void;

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
                const parsed = JSON.parse(stored);
                // Deep merge per app: new defaults apply, user overrides preserved
                const merged: Record<string, any> = {};
                for (const key of Object.keys(DEFAULT_APP_CONFIGS)) {
                    merged[key] = { ...DEFAULT_APP_CONFIGS[key], ...(parsed[key] || {}) };
                }
                for (const key of Object.keys(parsed)) {
                    if (!merged[key]) merged[key] = parsed[key];
                }

                // Migration v2: force FMA+ back to external (server blocks iframe embedding)
                const migrationKey = 'appConfigs_migration_v2';
                if (typeof window !== 'undefined' && !window.localStorage.getItem(migrationKey)) {
                    for (const key of Object.keys(DEFAULT_APP_CONFIGS)) {
                        if (merged[key]) {
                            merged[key].openMode = DEFAULT_APP_CONFIGS[key].openMode;
                        }
                    }
                    window.localStorage.setItem(migrationKey, '1');
                    window.localStorage.setItem('appConfigs', JSON.stringify(merged));
                }

                return merged;
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
            setActiveApp('native_viewer');
            return;
        }

        // Return to explicit origin when provided (eg. Globe -> 3D -> back)
        const forcedReturnApp = typeof window !== 'undefined'
            ? window.sessionStorage.getItem('viewer-return-app')
            : null;

        if (forcedReturnApp && typeof window !== 'undefined') {
            window.sessionStorage.removeItem('viewer-return-app');
        }

        setViewer3dFmGuidInternal(null);
        setActiveApp(forcedReturnApp || previousAppBeforeViewer);
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

    // Inventory prefill state and actions
    const [inventoryPrefill, setInventoryPrefill] = useState<InventoryPrefill | null>(null);

    const startInventory = useCallback((prefill: InventoryPrefill) => {
        setInventoryPrefill(prefill);
        setActiveApp('inventory');
    }, []);

    const clearInventoryPrefill = useCallback(() => {
        setInventoryPrefill(null);
    }, []);

    // Fault report prefill state and actions
    const [faultReportPrefill, setFaultReportPrefill] = useState<FaultReportPrefill | null>(null);

    const startFaultReport = useCallback((prefill: FaultReportPrefill) => {
        setFaultReportPrefill(prefill);
        setActiveApp('fault_report');
    }, []);

    const clearFaultReportPrefill = useCallback(() => {
        setFaultReportPrefill(null);
    }, []);

    // Annotation placement state and actions
    const [annotationPlacementContext, setAnnotationPlacementContext] = useState<AnnotationPlacementContext | null>(null);

    const startAnnotationPlacement = useCallback((asset: any, buildingFmGuid: string) => {
        setAnnotationPlacementContext({ asset, buildingFmGuid });
        // Save current app and open 3D viewer for this building
        setPreviousAppBeforeViewer(activeApp);
        setViewer3dFmGuidInternal(buildingFmGuid);
        setActiveApp('native_viewer');
    }, [activeApp]);

    const completeAnnotationPlacement = useCallback((coordinates: { x: number; y: number; z: number }) => {
        setAnnotationPlacementContext(null);
    }, []);

    const cancelAnnotationPlacement = useCallback(() => {
        setAnnotationPlacementContext(null);
        setViewer3dFmGuidInternal(null);
        setActiveApp(previousAppBeforeViewer);
    }, [previousAppBeforeViewer]);

    // Entity insights state and actions
    const [insightsFacility, setInsightsFacility] = useState<any | null>(null);

    const openEntityInsights = useCallback((facility: any) => {
        setInsightsFacility(facility);
        setActiveApp('entity_insights');
    }, []);

    // 360+ viewer context state and actions
    const [ivion360Context, setIvion360Context] = useState<Ivion360Context | null>(null);

    const open360WithContext = useCallback((context: Ivion360Context) => {
        setIvion360Context(context);
        // Also store in localStorage for backward compatibility
        localStorage.setItem('ivion360Url', context.ivionUrl);
        setActiveApp('radar');
    }, []);

    // Senslinc IoT dashboard context state and actions
    const [senslincDashboardContext, setSenslincDashboardContext] = useState<SenslincDashboardContext | null>(null);

    const openSenslincDashboard = useCallback((context: SenslincDashboardContext) => {
        setSenslincDashboardContext(context);
        setActiveApp('senslinc_dashboard');
    }, []);

    const buildNavigatorTree = useCallback((items: any[]): NavigatorNode[] => {
        // STRICT HIERARCHY: Building → Building Storey → Space → Instance
        // With synthetic "Okänd våning" fallback for orphan spaces
        // Include both standard and IFC category variants
        const buildings = items.filter(item => 
            item.category === 'Building' || item.category === 'IfcBuilding'
        );
        const storeys = items.filter(item => 
            item.category === 'Building Storey' || item.category === 'IfcBuildingStorey'
        );
        const spaces = items.filter(item => 
            item.category === 'Space' || item.category === 'IfcSpace'
        );
        const instances = items.filter(item => item.category === 'Instance');

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
        // Also derive display names for nameless storeys
        const storeyMap = new Map<string, NavigatorNode>();
        const namelessCounterByBuilding = new Map<string, number>();
        storeys.forEach((storey: any) => {
            if (buildingMap.has(storey.buildingFmGuid)) {
                let displayName = storey.commonName || storey.name;
                if (!displayName) {
                    // Try to derive from attributes (levelCommonName, levelDesignation, designation)
                    const attrs = storey.attributes || {};
                    displayName = attrs.levelCommonName || attrs.levelDesignation || attrs.designation || attrs.parentCommonName;
                }
                if (!displayName) {
                    // Try geometry_entity_map data embedded in attributes
                    const attrs = storey.attributes || {};
                    displayName = attrs.source_storey_name || attrs.sourceStoreyName;
                }
                if (!displayName) {
                    const count = (namelessCounterByBuilding.get(storey.buildingFmGuid) || 0) + 1;
                    namelessCounterByBuilding.set(storey.buildingFmGuid, count);
                    displayName = `Floor ${count}`;
                }
                storeyMap.set(storey.fmGuid, { ...storey, commonName: displayName, children: [] });
            }
        });

        // Create lookup for storey by name within each building (for fallback matching)
        // Key: "buildingFmGuid|storeyName" -> storey fmGuid
        const storeyNameLookup = new Map<string, string>();
        // Also maintain a reverse lookup of storey designation numbers for room name matching
        const storeyNumberLookup = new Map<string, string[]>(); // buildingGuid -> list of [number, storeyFmGuid]
        storeyMap.forEach((storey: any) => {
            const storeyName = (storey.commonName || storey.name || '').toLowerCase().trim();
            if (storeyName && storey.buildingFmGuid) {
                const key = `${storey.buildingFmGuid}|${storeyName}`;
                storeyNameLookup.set(key, storey.fmGuid);
            }
            // Extract floor number from storey name for heuristic matching
            const numberMatch = (storey.commonName || storey.name || '').match(/(\d+)/);
            if (numberMatch && storey.buildingFmGuid) {
                const key = storey.buildingFmGuid;
                if (!storeyNumberLookup.has(key)) {
                    storeyNumberLookup.set(key, []);
                }
                storeyNumberLookup.get(key)!.push(`${numberMatch[1]}|${storey.fmGuid}`);
            }
        });

        // Attach storeys to buildings
        storeyMap.forEach((storey) => {
            const parentBuilding = buildingMap.get((storey as any).buildingFmGuid);
            if (parentBuilding) {
                parentBuilding.children!.push(storey);
            }
        });

        // Track orphan spaces per building for synthetic storey fallback
        const orphanSpacesByBuilding = new Map<string, any[]>();

        // Build space map for instance attachment
        const spaceMap = new Map<string, NavigatorNode>();

        // Attach spaces to storeys - with enhanced fallback matching
        spaces.forEach((space: any) => {
            let parentStorey = storeyMap.get(space.levelFmGuid);
            
            // Fallback 1: Try to match by levelCommonName from attributes
            if (!parentStorey && space.buildingFmGuid) {
                const attrs = space.attributes || {};
                // Try different attribute fields that might contain the storey name
                const levelNameCandidates = [
                    attrs.levelCommonName,
                    attrs.levelDesignation,
                    attrs.levelName,
                ];
                
                for (const candidate of levelNameCandidates) {
                    if (!candidate) continue;
                    const levelName = String(candidate).toLowerCase().trim();
                    const lookupKey = `${space.buildingFmGuid}|${levelName}`;
                    const matchedStoreyGuid = storeyNameLookup.get(lookupKey);
                    if (matchedStoreyGuid) {
                        parentStorey = storeyMap.get(matchedStoreyGuid);
                        break;
                    }
                }
            }

            // Fallback 2: Try to extract floor number from room designation/name
            // e.g. room "1234" → floor "1", room "Plan 2 - Rum 5" → floor "2"
            if (!parentStorey && space.buildingFmGuid) {
                const designation = space.name || space.commonName || '';
                const floorNumMatch = designation.match(/^(\d)/); // first digit often = floor number
                if (floorNumMatch) {
                    const floorNum = floorNumMatch[1];
                    const candidates = storeyNumberLookup.get(space.buildingFmGuid) || [];
                    for (const entry of candidates) {
                        const [num, guid] = entry.split('|');
                        if (num === floorNum) {
                            parentStorey = storeyMap.get(guid);
                            break;
                        }
                    }
                }
            }

            // Fallback 3: parentCommonName - but ONLY if it matches a storey name, not a building/model name
            if (!parentStorey && space.buildingFmGuid) {
                const attrs = space.attributes || {};
                const parentName = (attrs.parentCommonName || '').toLowerCase().trim();
                if (parentName) {
                    const lookupKey = `${space.buildingFmGuid}|${parentName}`;
                    const matchedStoreyGuid = storeyNameLookup.get(lookupKey);
                    if (matchedStoreyGuid) {
                        parentStorey = storeyMap.get(matchedStoreyGuid);
                    }
                }
            }
            
            const spaceNode: NavigatorNode = { ...space, children: [] };
            spaceMap.set(space.fmGuid, spaceNode);
            
            if (parentStorey) {
                parentStorey.children!.push(spaceNode);
            } else if (space.buildingFmGuid && buildingMap.has(space.buildingFmGuid)) {
                // Orphan space with valid building - collect for synthetic storey
                if (!orphanSpacesByBuilding.has(space.buildingFmGuid)) {
                    orphanSpacesByBuilding.set(space.buildingFmGuid, []);
                }
                orphanSpacesByBuilding.get(space.buildingFmGuid)!.push(spaceNode);
            }
            // Spaces without building are truly orphaned and excluded
        });

        // Create synthetic "Unknown Floor" storey for orphan spaces per building
        orphanSpacesByBuilding.forEach((orphanSpaces, buildingGuid) => {
            const building = buildingMap.get(buildingGuid);
            if (building && orphanSpaces.length > 0) {
                // Check if building has only ONE storey - if so, assign orphans there
                const buildingStoreys = building.children?.filter(
                    (c: NavigatorNode) => c.category === 'Building Storey' && !c.isSynthetic
                ) || [];
                
                if (buildingStoreys.length === 1) {
                    // Assign all orphans to the single storey
                    orphanSpaces.forEach((spaceNode: NavigatorNode) => {
                        buildingStoreys[0].children!.push(spaceNode);
                    });
                } else {
                    // Create synthetic storey for orphans
                    const syntheticStorey: NavigatorNode = {
                        fmGuid: `synthetic-unknown-${buildingGuid}`,
                        category: 'Building Storey',
                        commonName: 'Unknown Floor',
                        name: 'Unknown Floor',
                        isSynthetic: true,
                        buildingFmGuid: buildingGuid,
                        children: orphanSpaces,
                    };
                    building.children!.push(syntheticStorey);
                }
            }
        });

        // Attach instances (assets) to their parent spaces
        instances.forEach((instance: any) => {
            const parentSpace = spaceMap.get(instance.inRoomFmGuid);
            if (parentSpace) {
                parentSpace.children!.push({
                    ...instance,
                    children: [], // Instances don't have children
                });
            }
            // Instances without a valid parent space are not shown in tree
            // They can still be seen in AssetsView
        });

        const sortedTree = Array.from(buildingMap.values());

        const sortNode = (node: NavigatorNode) => {
            if (!node.children?.length) return;
            node.children.sort((a, b) => {
                // Put synthetic storeys at the end
                if ((a as any).isSynthetic && !(b as any).isSynthetic) return 1;
                if (!(a as any).isSynthetic && (b as any).isSynthetic) return -1;
                // Put instances after spaces
                if (a.category === 'Instance' && b.category !== 'Instance') return 1;
                if (a.category !== 'Instance' && b.category === 'Instance') return -1;
                return (a.commonName || a.name || '').localeCompare(b.commonName || b.name || '', undefined, { numeric: true });
            });
            node.children.forEach(sortNode);
        };

        sortedTree.forEach(sortNode);
        sortedTree.sort((a, b) => (a.commonName || a.name || '').localeCompare(b.commonName || b.name || ''));

        return sortedTree;
    }, []);

    const refreshInitialData = useCallback(async () => {
        setIsLoadingData(true);
        try {
            // TWO-PHASE LOADING: Load hierarchy first (fast), assets on-demand (slow)
            // Phase 1: Building/Storey/Space hierarchy only (~4k records, ~2-3 seconds)
            // Include both standard and IFC category variants
            const allObjects = await fetchLocalAssets([
                'Building', 'IfcBuilding',
                'Building Storey', 'IfcBuildingStorey',
                'Space', 'IfcSpace',
                // NOTE: 'Instance' excluded at startup for faster load
                // Assets are loaded on-demand via fetchAssetsForBuilding()
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

                inventoryPrefill,
                startInventory,
                clearInventoryPrefill,

                faultReportPrefill,
                startFaultReport,
                clearFaultReportPrefill,

                annotationPlacementContext,
                startAnnotationPlacement,
                completeAnnotationPlacement,
                cancelAnnotationPlacement,

                insightsFacility,
                setInsightsFacility,
                openEntityInsights,

                ivion360Context,
                setIvion360Context,
                open360WithContext,

                senslincDashboardContext,
                setSenslincDashboardContext,
                openSenslincDashboard,

                viewerDiagnostics,
                setViewerDiagnostics,
            }}
        >
            {children}
        </AppContext.Provider>
    );
};
