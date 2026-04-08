import React, { createContext, useState, useCallback, useContext, ReactNode } from 'react';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';
import type { Facility, AppConfig } from '@/lib/types';

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

interface NavigationContextType {
  activeApp: string;
  setActiveApp: (app: string) => void;
  viewMode: string;
  setViewMode: (mode: string) => void;
  selectedFacility: Facility | null;
  setSelectedFacility: (facility: Facility | null) => void;
  isSidebarExpanded: boolean;
  setIsSidebarExpanded: (expanded: boolean) => void;
  isRightSidebarVisible: boolean;
  toggleRightSidebar: () => void;
  appConfigs: Record<string, AppConfig>;
  setAppConfigs: (configs: Record<string, AppConfig>) => void;

  // Entity insights
  insightsFacility: Facility | null;
  setInsightsFacility: (facility: Facility | null) => void;
  openEntityInsights: (facility: Facility) => void;

  // 360+ viewer context
  ivion360Context: Ivion360Context | null;
  setIvion360Context: (context: Ivion360Context | null) => void;
  open360WithContext: (context: Ivion360Context) => void;

  // Senslinc IoT dashboard context
  senslincDashboardContext: SenslincDashboardContext | null;
  setSenslincDashboardContext: (context: SenslincDashboardContext | null) => void;
  openSenslincDashboard: (context: SenslincDashboardContext) => void;
}

export const NavigationContext = createContext<NavigationContextType>({
  activeApp: 'home',
  setActiveApp: () => {},
  viewMode: 'grid',
  setViewMode: () => {},
  selectedFacility: null,
  setSelectedFacility: () => {},
  isSidebarExpanded: false,
  setIsSidebarExpanded: () => {},
  isRightSidebarVisible: false,
  toggleRightSidebar: () => {},
  appConfigs: DEFAULT_APP_CONFIGS,
  setAppConfigs: () => {},
  insightsFacility: null,
  setInsightsFacility: () => {},
  openEntityInsights: () => {},
  ivion360Context: null,
  setIvion360Context: () => {},
  open360WithContext: () => {},
  senslincDashboardContext: null,
  setSenslincDashboardContext: () => {},
  openSenslincDashboard: () => {},
});

export const useNavigation = () => useContext(NavigationContext);

export const NavigationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeApp, setActiveApp] = useState('home');
  const [viewMode, setViewMode] = useState('grid');
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(false);
  const [insightsFacility, setInsightsFacility] = useState<Facility | null>(null);
  const [ivion360Context, setIvion360Context] = useState<Ivion360Context | null>(null);
  const [senslincDashboardContext, setSenslincDashboardContext] = useState<SenslincDashboardContext | null>(null);

  const [appConfigs, setAppConfigs] = useState<Record<string, AppConfig>>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('appConfigs') : null;
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const merged: Record<string, AppConfig> = {};
        for (const key of Object.keys(DEFAULT_APP_CONFIGS)) {
          merged[key] = { ...DEFAULT_APP_CONFIGS[key], ...(parsed[key] || {}) };
        }
        for (const key of Object.keys(parsed)) {
          if (!merged[key]) merged[key] = parsed[key];
        }
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
      } catch {
        return DEFAULT_APP_CONFIGS;
      }
    }
    return DEFAULT_APP_CONFIGS;
  });

  const toggleRightSidebar = useCallback(() => {
    setIsRightSidebarVisible(prev => !prev);
  }, []);

  const openEntityInsights = useCallback((facility: Facility) => {
    setInsightsFacility(facility);
    setActiveApp('entity_insights');
  }, []);

  const open360WithContext = useCallback((context: Ivion360Context) => {
    setIvion360Context(context);
    localStorage.setItem('ivion360Url', context.ivionUrl);
    setActiveApp('radar');
  }, []);

  const openSenslincDashboard = useCallback((context: SenslincDashboardContext) => {
    setSenslincDashboardContext(context);
    setActiveApp('senslinc_dashboard');
  }, []);

  return (
    <NavigationContext.Provider
      value={{
        activeApp, setActiveApp,
        viewMode, setViewMode,
        selectedFacility, setSelectedFacility,
        isSidebarExpanded, setIsSidebarExpanded,
        isRightSidebarVisible, toggleRightSidebar,
        appConfigs, setAppConfigs,
        insightsFacility, setInsightsFacility, openEntityInsights,
        ivion360Context, setIvion360Context, open360WithContext,
        senslincDashboardContext, setSenslincDashboardContext, openSenslincDashboard,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};
