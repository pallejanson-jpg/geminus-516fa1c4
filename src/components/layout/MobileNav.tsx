import React, { useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, LayoutGrid, Globe, Network, Cuboid, X } from 'lucide-react';
import { AppButton } from '@/components/common/AppButton';
import { THEMES, DEFAULT_APP_CONFIGS, SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SETTINGS_CHANGED_EVENT } from '@/lib/constants';
import type { SidebarItem } from '@/lib/constants';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppContext } from '@/context/AppContext';
import { getSidebarOrder } from '@/components/settings/AppMenuSettings';
import { ClipboardList, AlertTriangle, BarChart2, Building2, Box, Zap, Archive, Radar, Scan } from 'lucide-react';

const SIDEBAR_ITEM_META: Record<string, {
    icon: React.ElementType;
    color: string;
    label: string;
    type: 'internal' | 'config';
}> = {
    inventory: { icon: ClipboardList, color: 'text-orange-500', label: 'Inventering', type: 'internal' },
    fault_report: { icon: AlertTriangle, color: 'text-red-500', label: 'Felanmälan', type: 'internal' },
    insights: { icon: BarChart2, color: 'text-green-500', label: 'Insights', type: 'internal' },
    fma_plus: { icon: Building2, color: 'text-blue-500', label: DEFAULT_APP_CONFIGS.fma_plus.label, type: 'config' },
    asset_plus: { icon: Box, color: 'text-purple-500', label: DEFAULT_APP_CONFIGS.asset_plus.label, type: 'config' },
    iot: { icon: Zap, color: 'text-yellow-500', label: DEFAULT_APP_CONFIGS.iot.label, type: 'config' },
    original_archive: { icon: Archive, color: 'text-indigo-500', label: DEFAULT_APP_CONFIGS.original_archive.label, type: 'config' },
    radar: { icon: Radar, color: 'text-pink-500', label: DEFAULT_APP_CONFIGS.radar.label, type: 'config' },
    ai_scan: { icon: Scan, color: 'text-emerald-500', label: 'AI Scan', type: 'internal' },
};

interface MobileNavProps {
    isMobileMenuOpen: boolean;
    setIsMobileMenuOpen: (open: boolean) => void;
}

const CORE_NAV = [
    { key: 'home', icon: Home, label: 'Home' },
    { key: 'portfolio', icon: LayoutGrid, label: 'Portfolio' },
    { key: 'navigation', icon: Network, label: 'Navigator' },
    { key: 'map', icon: Globe, label: 'Karta' },
] as const;

const MobileNav: React.FC<MobileNavProps> = ({
    isMobileMenuOpen,
    setIsMobileMenuOpen,
}) => {
    const { theme, activeApp, setActiveApp, appConfigs } = useContext(AppContext);
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const t = THEMES[theme];

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

    const handleItemClick = useCallback((id: string) => {
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

    const handleCoreClick = (key: string) => {
        setActiveApp(key);
        setIsMobileMenuOpen(false);
    };

    if (!isMobile) return null;

    return (
        <>
            {isMobileMenuOpen && (
                <>
                    <div
                        className="fixed inset-0 bg-black/60 z-30"
                        onClick={() => setIsMobileMenuOpen(false)}
                    />
                    <div className={`fixed bottom-0 left-0 right-0 ${t.bgSec} border-t ${t.border} z-40 md:hidden flex flex-col rounded-t-2xl animate-in slide-in-from-bottom duration-300 max-h-[70dvh] overflow-y-auto`}>
                        <div className="flex justify-end p-3 pb-1 sticky top-0 z-10 bg-inherit">
                            <AppButton
                                onClick={() => setIsMobileMenuOpen(false)}
                                variant="ghost"
                                className="h-8 w-8"
                            >
                                <X size={18} />
                            </AppButton>
                        </div>

                        <div className="px-4 pb-4 space-y-3">
                            {/* Core navigation */}
                            <div className="grid grid-cols-4 gap-3 text-center">
                                {CORE_NAV.map(({ key, icon: Icon, label }) => (
                                    <AppButton
                                        key={key}
                                        onClick={() => handleCoreClick(key)}
                                        variant="ghost"
                                        className={`flex-col !h-auto !w-auto !p-2 ${activeApp === key ? 'text-primary' : t.textSec}`}
                                    >
                                        <Icon size={22} />
                                        <span className="text-[10px] mt-1">{label}</span>
                                    </AppButton>
                                ))}
                            </div>

                            {/* 3D Viewer quick link */}
                            <div className="grid grid-cols-4 gap-3 text-center">
                                <AppButton
                                    onClick={() => { navigate('/split-viewer?mode=3d'); setIsMobileMenuOpen(false); }}
                                    variant="ghost"
                                    className={`flex-col !h-auto !w-auto !p-2 ${t.textSec}`}
                                >
                                    <Cuboid size={22} />
                                    <span className="text-[10px] mt-1">3D Viewer</span>
                                </AppButton>
                            </div>

                            <div className={`h-px ${t.border.replace('border-', 'bg-')}`} />

                            {/* Dynamic apps from sidebarOrder */}
                            <div className="grid grid-cols-4 gap-3 text-center">
                                {sidebarOrder.map((item) => {
                                    const meta = SIDEBAR_ITEM_META[item.id];
                                    if (!meta) return null;
                                    const IconComp = meta.icon;
                                    return (
                                        <React.Fragment key={item.id}>
                                            <AppButton
                                                onClick={() => handleItemClick(item.id)}
                                                variant="ghost"
                                                className={`flex-col !h-auto !w-auto !p-2 ${activeApp === item.id ? 'text-primary' : meta.color}`}
                                            >
                                                <IconComp size={22} />
                                                <span className="text-[10px] mt-1">{meta.label}</span>
                                            </AppButton>
                                            {item.hasDividerAfter && (
                                                <div className={`col-span-4 h-px ${t.border.replace('border-', 'bg-')}`} />
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

export default MobileNav;
