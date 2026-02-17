import React, { useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Home, LayoutGrid, Globe, Network, MoreHorizontal, X,
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

// Core bottom nav items (always visible)
const CORE_NAV = [
  { key: 'home',       icon: Home,      label: 'Hem' },
  { key: 'portfolio',  icon: LayoutGrid, label: 'Portfolio' },
  { key: 'navigation', icon: Network,   label: 'Navigator' },
  { key: 'map',        icon: Globe,     label: 'Karta' },
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
      {/* Fixed Bottom Navigation Bar */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border flex items-stretch"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', height: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {CORE_NAV.map(({ key, icon: Icon, label }) => {
          const isActive = activeApp === key;
          return (
            <button
              key={key}
              onClick={() => handleCoreClick(key)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors min-h-[3.5rem]",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground active:text-foreground"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "stroke-[2.5px]")} />
              <span className={cn("text-[10px] font-medium", isActive && "font-semibold")}>{label}</span>
            </button>
          );
        })}

        {/* Mer button */}
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors min-h-[3.5rem]",
            isMobileMenuOpen
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          <span className="text-[10px] font-medium">Mer</span>
        </button>
      </nav>

      {/* App Drawer — opens from bottom */}
      <Drawer open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <DrawerContent className="max-h-[70dvh] pb-0">
          <div
            className="overflow-y-auto"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-semibold text-sm text-foreground">Appar</span>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-4 space-y-4">
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
