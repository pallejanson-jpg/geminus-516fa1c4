import React, { useContext, useState, useEffect, useCallback } from 'react';
import { Box, Menu as MenuIcon, Home, ClipboardList, AlertTriangle, BarChart2, Building2, Zap, Archive, Radar, Scan, Globe } from 'lucide-react';
import { AppButton } from '@/components/common/AppButton';
import { THEMES, DEFAULT_APP_CONFIGS, DEFAULT_SIDEBAR_ORDER, SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SETTINGS_CHANGED_EVENT } from '@/lib/constants';
import type { SidebarItem } from '@/lib/constants';
import { AppContext } from '@/context/AppContext';
import { getSidebarOrder } from '@/components/settings/AppMenuSettings';
import { supabase } from '@/integrations/supabase/client';

// Map sidebar item IDs to icon + color + label + handler type
const SIDEBAR_ITEM_META: Record<string, {
    icon: React.ElementType;
    color: string;
    label: string;
    type: 'internal' | 'config'; // 'internal' = custom setActiveApp, 'config' = from DEFAULT_APP_CONFIGS
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
    globe: { icon: Globe, color: 'text-sky-400', label: 'Globe', type: 'internal' },
};

const LeftSidebar: React.FC = () => {
    const { 
        theme, 
        activeApp, 
        setActiveApp, 
        appConfigs, 
        setSelectedFacility,
        isSidebarExpanded,
        setIsSidebarExpanded,
        selectedFacility,
        setIvion360Context,
        open360WithContext,
    } = useContext(AppContext);
    
    const t = THEMES[theme];
    const [sidebarOrder, setSidebarOrder] = useState<SidebarItem[]>(getSidebarOrder);

    // Listen for changes from AppMenuSettings
    useEffect(() => {
        const handleSettingsChange = (e: Event) => {
            const customEvent = e as CustomEvent<SidebarItem[]>;
            if (customEvent.detail) {
                setSidebarOrder(customEvent.detail);
            }
        };
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === SIDEBAR_ORDER_STORAGE_KEY) {
                setSidebarOrder(getSidebarOrder());
            }
        };
        window.addEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
        window.addEventListener('storage', handleStorageChange);
        return () => {
            window.removeEventListener(SIDEBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
            window.removeEventListener('storage', handleStorageChange);
        };
    }, []);

    const getIconColor = (key: string) => {
        if (activeApp === key) return '';
        return SIDEBAR_ITEM_META[key]?.color || 'text-muted-foreground';
    };
    
    const handleItemClick = useCallback(async (id: string) => {
        const meta = SIDEBAR_ITEM_META[id];
        if (!meta) return;

        // Special handling for radar (360°): try to set context from selectedFacility
        if (id === 'radar') {
            const radarConfig = appConfigs?.radar || {};
            const ivionUrl = radarConfig.url || 'https://swg.iv.navvis.com';

            if (selectedFacility?.fmGuid) {
                try {
                    const { data: settings } = await supabase
                        .from('building_settings')
                        .select('ivion_site_id')
                        .eq('fm_guid', selectedFacility.fmGuid)
                        .maybeSingle();

                    if (settings?.ivion_site_id) {
                        open360WithContext({
                            buildingFmGuid: selectedFacility.fmGuid,
                            buildingName: selectedFacility.commonName || selectedFacility.name || '',
                            ivionSiteId: settings.ivion_site_id,
                            ivionUrl,
                        });
                        return;
                    }
                } catch (e) {
                    console.debug('Failed to fetch ivion settings for radar:', e);
                }
            }

            // No site ID configured or no building selected — open with empty context so viewer shows config message
            setIvion360Context(null);
            setActiveApp('radar');
            return;
        }

        if (meta.type === 'config') {
            const currentAppConfig = appConfigs[id] || {};
            if (currentAppConfig.openMode === 'external' && currentAppConfig.url) {
                window.open(currentAppConfig.url, '_blank');
            } else {
                setActiveApp(id);
            }
        } else {
            // Internal items: inventory, fault_report, insights
            setActiveApp(id);
        }
    }, [appConfigs, setActiveApp, selectedFacility, setIvion360Context, open360WithContext]);

    return (
        <aside 
            className={`
                fixed md:static inset-y-0 left-0 z-40 
                transition-all duration-300 
                ${isSidebarExpanded ? 'translate-x-0 w-44 sm:w-48' : '-translate-x-full md:translate-x-0 md:w-14 lg:w-16'} 
                ${t.bgSec} border-r ${t.border} 
                flex flex-col shadow-lg md:shadow-none
            `}
        >
            <div className={`p-1.5 sm:p-2 flex h-14 sm:h-16 border-b ${t.border} items-center justify-center`}>
                <AppButton 
                    onClick={() => setIsSidebarExpanded(!isSidebarExpanded)} 
                    variant="ghost" 
                    className="h-8 w-8 sm:h-10 sm:w-10"
                >
                    <MenuIcon size={18} className="sm:hidden" />
                    <MenuIcon size={20} className="hidden sm:block" />
                </AppButton>
            </div>
            
            <div className={`transition-opacity duration-200 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0 md:opacity-100'}`}>
                <nav className="flex-1 p-1.5 sm:p-2 space-y-0.5 sm:space-y-1">
                    {/* Home - always first, not reorderable */}
                    <AppButton 
                        onClick={() => { setActiveApp('home'); setSelectedFacility(null); }} 
                        variant={activeApp === 'home' ? 'default' : 'ghost'} 
                        className="w-full !justify-start gap-2 sm:gap-3 h-9 sm:h-10 text-xs sm:text-sm" 
                        title={isSidebarExpanded ? "" : "Home"}
                    >
                        <Home size={16} className={`sm:w-[18px] sm:h-[18px] ${activeApp === 'home' ? '' : 'text-sky-500'}`} />
                        <span className={`truncate ${!isSidebarExpanded && 'hidden'}`}>Home</span>
                    </AppButton>
                    
                    <div className="h-px bg-border my-1.5 sm:my-2 mx-0.5 sm:mx-1" />
                    
                    {/* Dynamic items from saved order */}
                    {sidebarOrder.map((item) => {
                        const meta = SIDEBAR_ITEM_META[item.id];
                        if (!meta) return null;
                        const IconComp = meta.icon;
                        return (
                            <React.Fragment key={item.id}>
                                <AppButton 
                                    onClick={() => handleItemClick(item.id)}
                                    variant={activeApp === item.id ? 'default' : 'ghost'} 
                                    className="w-full !justify-start gap-2 sm:gap-3 h-9 sm:h-10 text-xs sm:text-sm" 
                                    title={isSidebarExpanded ? "" : meta.label}
                                >
                                    <IconComp size={16} className={`sm:w-[18px] sm:h-[18px] ${getIconColor(item.id)}`} />
                                    <span className={`truncate ${!isSidebarExpanded && 'hidden'}`}>{meta.label}</span>
                                </AppButton>
                                {item.hasDividerAfter && (
                                    <div className="h-px bg-border my-1.5 sm:my-2 mx-0.5 sm:mx-1" />
                                )}
                            </React.Fragment>
                        );
                    })}
                </nav>
            </div>
        </aside>
    );
};

export default LeftSidebar;
