import React, { createContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';
import { fetchAssetPlusData } from '@/services/asset-plus-service';

type NavigatorNode = {
    fmGuid: string;
    category?: string;
    commonName?: string;
    name?: string;
    children?: NavigatorNode[];
    [key: string]: any;
};

interface AppContextType {
    theme: 'dark' | 'light';
    setTheme: (theme: 'dark' | 'light') => void;
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
});

interface AppProviderProps {
    children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
    const [theme, setTheme] = useState<'dark' | 'light'>(() => {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem('theme') : null;
        return stored === 'light' ? 'light' : 'dark';
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

    const buildNavigatorTree = useCallback((items: any[]): NavigatorNode[] => {
        const buildings = items.filter(item => item.category === 'Building');
        const storeys = items.filter(item => item.category === 'Building Storey');
        const spaces = items.filter(item => item.category === 'Space');
        const doors = items.filter(item => item.category === 'Door');

        const doorMap = new Map<string, any[]>();
        doors.forEach((door: any) => {
            const parentRoomGuid = door.inRoomFmGuid;
            if (!doorMap.has(parentRoomGuid)) doorMap.set(parentRoomGuid, []);
            doorMap.get(parentRoomGuid)!.push(door);
        });

        const spaceMap = new Map<string, NavigatorNode>();
        spaces.forEach((space: any) => {
            const children = (doorMap.get(space.fmGuid) || []) as NavigatorNode[];
            spaceMap.set(space.fmGuid, { ...space, children });
        });

        const storeyMap = new Map<string, NavigatorNode>();
        storeys.forEach((storey: any) => {
            storeyMap.set(storey.fmGuid, { ...storey, children: [] });
        });

        spaceMap.forEach((space) => {
            const parentStorey = storeyMap.get((space as any).levelFmGuid);
            if (parentStorey) parentStorey.children!.push(space);
        });

        const buildingMap = new Map<string, NavigatorNode>();
        buildings.forEach((building: any) => {
            buildingMap.set(building.fmGuid, { ...building, children: [] });
        });

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
            const allObjects = await fetchAssetPlusData([
                ["category", "=", "Building"], "or",
                ["category", "=", "Building Storey"], "or",
                ["category", "=", "Space"], "or",
                ["category", "=", "Door"],
            ]);
            setAllData(allObjects);
            setNavigatorTreeData(buildNavigatorTree(allObjects));
        } finally {
            setIsLoadingData(false);
        }
    }, [buildNavigatorTree, setAllData]);

    const toggleRightSidebar = useCallback(() => {
        setIsRightSidebarVisible(prev => !prev);
    }, []);

    // Apply theme class to the document so Tailwind's `.dark` tokens take effect.
    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
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
            }}
        >
            {children}
        </AppContext.Provider>
    );
};
