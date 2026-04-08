import React, { useContext, useCallback } from 'react';
import { Menu as MenuIcon, Home } from 'lucide-react';
import { AppButton } from '@/components/common/AppButton';

import { AppContext } from '@/context/AppContext';
import { useSidebarOrder } from '@/hooks/useSidebarOrder';
import { supabase } from '@/integrations/supabase/client';
import { SIDEBAR_ITEM_META, getCurrentContext } from '@/lib/sidebar-config';

const LeftSidebar: React.FC = () => {
    const { 
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
    
    const sidebarOrder = useSidebarOrder();
    const currentContext = getCurrentContext(activeApp, selectedFacility);

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
            setActiveApp(id);
        }
    }, [appConfigs, setActiveApp, selectedFacility, setIvion360Context, open360WithContext]);

    return (
        <aside 
            className={`
                fixed md:static inset-y-0 left-0 z-40 
                transition-all duration-300 
                ${isSidebarExpanded ? 'translate-x-0 w-44 sm:w-48' : '-translate-x-full md:translate-x-0 md:w-14 lg:w-16'} 
                bg-card border-r border-border 
                flex flex-col shadow-lg md:shadow-none
            `}
        >
            <div className="p-1.5 sm:p-2 flex h-14 sm:h-16 border-b border-border items-center justify-center">
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
                        <Home size={16} className={`sm:w-[18px] sm:h-[18px] ${activeApp === 'home' ? '' : 'text-primary'}`} />
                        <span className={`truncate ${!isSidebarExpanded && 'hidden'}`}>Home</span>
                    </AppButton>
                    
                    <div className="h-px bg-border my-1.5 sm:my-2 mx-0.5 sm:mx-1" />
                    
                    {/* Context label when building is selected */}
                    {selectedFacility && (
                        <p className={`text-[10px] font-medium uppercase tracking-wider px-1 truncate ${isSidebarExpanded ? 'text-muted-foreground' : 'hidden'}`}>
                            {selectedFacility.commonName || selectedFacility.name || 'Building'}
                        </p>
                    )}
                    
                    {/* Dynamic items from saved order, filtered by context */}
                    {sidebarOrder.map((item) => {
                        const meta = SIDEBAR_ITEM_META[item.id];
                        if (!meta) return null;
                        if (!meta.contexts.includes(currentContext)) return null;
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
