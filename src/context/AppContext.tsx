import React, { createContext, useState, useCallback, ReactNode } from 'react';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';

interface AppContextType {
    theme: string;
    setTheme: (theme: string) => void;
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
});

interface AppProviderProps {
    children: ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
    const [theme, setTheme] = useState('dark');
    const [allData, setAllData] = useState<any[]>([]);
    const [appConfigs, setAppConfigs] = useState(DEFAULT_APP_CONFIGS);
    const [activeApp, setActiveApp] = useState('home');
    const [viewMode, setViewMode] = useState('grid');
    const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);
    const [selectedFacility, setSelectedFacility] = useState<any>(null);
    const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

    const toggleRightSidebar = useCallback(() => {
        setIsRightSidebarVisible(prev => !prev);
    }, []);

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
            }}
        >
            {children}
        </AppContext.Provider>
    );
};
