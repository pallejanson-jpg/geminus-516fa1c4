import React, { useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home, LayoutGrid, Globe, Network, Menu, X, Cuboid
} from 'lucide-react';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { AppContext } from '@/context/AppContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SETTINGS_CHANGED_EVENT, IVION_DEFAULT_BASE_URL } from '@/lib/constants';
import type { SidebarItem } from '@/lib/constants';
import { getSidebarOrder } from '@/components/settings/AppMenuSettings';
import { cn } from '@/lib/utils';
import { SIDEBAR_ITEM_META } from '@/lib/sidebar-config';

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
  const { activeApp, setActiveApp, appConfigs, selectedFacility, open360WithContext } = useContext(AppContext);
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
    // Special handling for 360/radar — pass building context
    if (id === 'radar') {
      const radarConfig = appConfigs?.radar || {};
      const ivionUrl = radarConfig.url || IVION_DEFAULT_BASE_URL;
      if (selectedFacility?.fmGuid) {
        open360WithContext({
          buildingFmGuid: selectedFacility.fmGuid,
          buildingName: selectedFacility.commonName || selectedFacility.name || '',
          ivionSiteId: '', // User account controls access
          ivionUrl,
        });
      } else {
        setActiveApp('radar');
      }
      setIsMobileMenuOpen(false);
      return;
    }

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
  }, [appConfigs, setActiveApp, setIsMobileMenuOpen, selectedFacility, open360WithContext]);

  if (!isMobile) return null;

  return (
    <>
      {/* Floating Menu FAB — compact pill */}
      <button
        onClick={() => setIsMobileMenuOpen(true)}
        className="fixed z-40 flex items-center gap-1 bg-card/80 backdrop-blur-md border border-border rounded-full px-2.5 py-1 shadow-md left-1/2 -translate-x-1/2"
        style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        aria-label="Öppna meny"
      >
        <Menu className="h-3.5 w-3.5 text-foreground" />
        <span className="text-xs font-medium text-foreground hidden xs:inline">Meny</span>
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
                <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Navigation</p>
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
                          "text-xs text-center leading-tight",
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
                <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Viewer</p>
                <button
                  onClick={() => { navigate('/split-viewer?mode=3d'); setIsMobileMenuOpen(false); }}
                  className="flex flex-col items-center gap-1.5 w-[72px] p-2 rounded-xl hover:bg-muted/60 transition-colors"
                >
                  <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
                    <Cuboid className="h-6 w-6 text-foreground/70" />
                  </div>
                  <span className="text-xs text-center text-muted-foreground leading-tight">3D Viewer</span>
                </button>
              </div>

              {/* Dynamic apps */}
              {sidebarOrder.length > 0 && (
                <div>
                  <p className="text-[11px] sm:text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Integrationer</p>
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
                              "text-xs text-center leading-tight",
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
