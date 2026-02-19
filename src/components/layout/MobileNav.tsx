import React, { useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home, LayoutGrid, Globe, Network, Menu, X,
  ClipboardList, AlertTriangle, BarChart2, Building2, Box, Zap, Archive, Radar, Scan, Cuboid
} from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { AppContext } from '@/context/AppContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { DEFAULT_APP_CONFIGS, SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SETTINGS_CHANGED_EVENT } from '@/lib/constants';
import type { SidebarItem } from '@/lib/constants';
import { getSidebarOrder } from '@/components/settings/AppMenuSettings';
import { cn } from '@/lib/utils';

const SIDEBAR_ITEM_META: Record<string, {
  icon: React.ElementType;
  label: string;
  type: 'internal' | 'config';
}> = {
  inventory:        { icon: ClipboardList, label: 'Inventering', type: 'internal' },
  fault_report:     { icon: AlertTriangle, label: 'Felanmälan', type: 'internal' },
  insights:         { icon: BarChart2,     label: 'Insights',   type: 'internal' },
  fma_plus:         { icon: Building2,     label: DEFAULT_APP_CONFIGS.fma_plus.label, type: 'config' },
  asset_plus:       { icon: Box,           label: DEFAULT_APP_CONFIGS.asset_plus.label, type: 'config' },
  iot:              { icon: Zap,           label: DEFAULT_APP_CONFIGS.iot.label, type: 'config' },
  original_archive: { icon: Archive,       label: DEFAULT_APP_CONFIGS.original_archive.label, type: 'config' },
  radar:            { icon: Radar,         label: DEFAULT_APP_CONFIGS.radar.label, type: 'config' },
  ai_scan:          { icon: Scan,          label: 'AI Scan', type: 'internal' },
};

// Core navigation items
const CORE_NAV = [
  { key: 'home',       icon: Home,       label: 'Hem' },
  { key: 'portfolio',  icon: LayoutGrid, label: 'Portfolio' },
  { key: 'navigation', icon: Network,    label: 'Navigator' },
  { key: 'map',        icon: Globe,      label: 'Karta' },
] as const;

interface MobileNavProps {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

const MobileNav: React.FC<MobileNavProps> = ({ isMobileMenuOpen, setIsMobileMenuOpen }) => {
  const { activeApp, setActiveApp, appConfigs } = useContext(AppContext);
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [sidebarOrder, setSidebarOrder] = useState<SidebarItem[]>(getSidebarOrder);

  useEffect(() => {
    const handleSettingsChange = (e: Event) => {
      const customEvent = e as CustomEvent<SidebarItem[]>;
      if (customEvent.detail) setSidebarOrder(customEvent.detail);
    };
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SIDEBAR_ORDER_STORAGE_KEY) setSidebarOrder(getSidebarOrder());
    };
    window.addEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const handleCoreClick = useCallback((key: string) => {
    setActiveApp(key);
  }, [setActiveApp]);

  const handleAppClick = useCallback((id: string) => {
    const meta = SIDEBAR_ITEM_META[id];
    if (!meta) return;
    if (meta.type === 'config') {
      const cfg = appConfigs[id] || {};
      if (cfg.openMode === 'external' && cfg.url) {
        window.open(cfg.url, '_blank');
      } else {
        setActiveApp(id);
      }
    } else {
      setActiveApp(id);
    }
    setIsMobileMenuOpen(false);
  }, [appConfigs, setActiveApp, setIsMobileMenuOpen]);

  if (!isMobile) return null;

  return (
    <>
      {/* Floating Menu FAB */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className="fixed z-40 flex items-center gap-1.5 bg-card/80 backdrop-blur-md border border-border rounded-full px-4 py-2 shadow-lg left-1/2 -translate-x-1/2"
        style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
        aria-label="Öppna meny"
      >
        <Menu className="h-4 w-4 text-foreground" />
        <span className="text-sm font-medium text-foreground">Meny</span>
      </button>

      {/* App Drawer — opens from bottom */}
      <Drawer open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <DrawerContent className="max-h-[75dvh] pb-0">
          <div
            className="overflow-y-auto"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-semibold text-sm text-foreground">Navigering</span>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Core navigation grid */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Navigation</p>
                <div className="grid grid-cols-4 gap-2">
                  {CORE_NAV.map(({ key, icon: Icon, label }) => {
                    const isActive = activeApp === key;
                    return (
                      <button
                        key={key}
                        onClick={() => { handleCoreClick(key); setIsMobileMenuOpen(false); }}
                        className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-muted/60 transition-colors"
                      >
                        <div className={cn(
                          "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                          isActive ? "bg-primary/15" : "bg-muted"
                        )}>
                          <Icon className={cn("h-6 w-6", isActive ? "text-primary" : "text-foreground/70")} />
                        </div>
                        <span className={cn(
                          "text-[11px] text-center leading-tight",
                          isActive ? "text-primary font-medium" : "text-muted-foreground"
                        )}>
                          {label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 3D Viewer quick link */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Viewer</p>
                <button
                  onClick={() => { navigate('/split-viewer?mode=3d'); setIsMobileMenuOpen(false); }}
                  className="flex flex-col items-center gap-1.5 w-[72px] p-2 rounded-xl hover:bg-muted/60 transition-colors"
                >
                  <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
                    <Cuboid className="h-6 w-6 text-foreground/70" />
                  </div>
                  <span className="text-[11px] text-center text-muted-foreground leading-tight">3D Viewer</span>
                </button>
              </div>

              {/* Dynamic apps */}
              {sidebarOrder.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Integrationer</p>
                  <div className="flex flex-wrap gap-3">
                    {sidebarOrder.map((item) => {
                      const meta = SIDEBAR_ITEM_META[item.id];
                      if (!meta) return null;
                      const IconComp = meta.icon;
                      const isActive = activeApp === item.id;
                      return (
                        <React.Fragment key={item.id}>
                          <button
                            onClick={() => handleAppClick(item.id)}
                            className="flex flex-col items-center gap-1.5 w-[72px] p-2 rounded-xl hover:bg-muted/60 transition-colors"
                          >
                            <div className={cn(
                              "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                              isActive ? "bg-primary/15" : "bg-muted"
                            )}>
                              <IconComp className={cn("h-6 w-6", isActive ? "text-primary" : "text-foreground/70")} />
                            </div>
                            <span className={cn(
                              "text-[11px] text-center leading-tight",
                              isActive ? "text-primary font-medium" : "text-muted-foreground"
                            )}>
                              {meta.label}
                            </span>
                          </button>
                          {item.hasDividerAfter && (
                            <div className="w-full h-px bg-border my-1" />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};

export default MobileNav;
