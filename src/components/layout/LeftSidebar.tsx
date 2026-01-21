import React, { useContext } from 'react';
import { Box, Menu as MenuIcon, Home, ExternalLink } from 'lucide-react';
import { AppButton } from '@/components/common/AppButton';
import { THEMES, DEFAULT_APP_CONFIGS } from '@/lib/constants';
import { AppContext } from '@/context/AppContext';

// Define a mapping of icon keys to colors
const ICON_COLORS: Record<string, string> = {
    home: 'text-sky-500',
    default: 'text-muted-foreground',
    insights: 'text-green-500',
    fma_plus: 'text-blue-500',
    asset_plus: 'text-purple-500',
    iot: 'text-yellow-500',
    original_archive: 'text-indigo-500',
    radar: 'text-pink-500',
};

const LeftSidebar: React.FC = () => {
    const { 
        theme, 
        activeApp, 
        setActiveApp, 
        appConfigs, 
        setSelectedFacility,
        isSidebarExpanded,
        setIsSidebarExpanded
    } = useContext(AppContext);
    
    const t = THEMES[theme];

    // Helper function to get color for an icon
    const getIconColor = (key: string) => {
        if (activeApp === key) {
            return '';
        }
        return ICON_COLORS[key] || ICON_COLORS.default;
    };
    
    const handleAppClick = (key: string, config: any) => {
        if (config.openMode === 'external' && config.url) {
            window.open(config.url, '_blank');
        } else {
            setActiveApp(key);
        }
    };

    return (
        <aside 
            className={`
                fixed md:static inset-y-0 left-0 z-40 
                transition-all duration-300 
                ${isSidebarExpanded ? 'translate-x-0 w-48' : '-translate-x-full md:translate-x-0 md:w-16'} 
                ${t.bgSec} border-r ${t.border} 
                flex flex-col shadow-lg md:shadow-none
            `}
        >
            <div className={`p-2 flex h-16 border-b ${t.border} items-center justify-center`}>
                <AppButton 
                    onClick={() => setIsSidebarExpanded(!isSidebarExpanded)} 
                    variant="ghost" 
                    className="h-10 w-10"
                >
                    <MenuIcon size={20} />
                </AppButton>
            </div>
            
            <div className={`transition-opacity duration-200 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0 md:opacity-100'}`}>
                <nav className="flex-1 p-2 space-y-1">
                    <AppButton 
                        onClick={() => { setActiveApp('home'); setSelectedFacility(null); }} 
                        variant={activeApp === 'home' ? 'default' : 'ghost'} 
                        className="w-full !justify-start gap-3" 
                        title={isSidebarExpanded ? "" : "Home"}
                    >
                        <Home size={18} className={getIconColor('home')} />
                        <span className={`${!isSidebarExpanded && 'hidden'}`}>Home</span>
                    </AppButton>
                    
                    <div className={`h-px bg-border my-2 mx-1`} />
                    
                    {Object.entries(DEFAULT_APP_CONFIGS).map(([key, cfg]: [string, any]) => {
                        const IconComp = cfg.icon || Box;
                        const currentAppConfig = appConfigs[key] || {};
                        return (
                            <AppButton 
                                key={key} 
                                onClick={() => handleAppClick(key, currentAppConfig)}
                                variant={activeApp === key ? 'default' : 'ghost'} 
                                className="w-full !justify-start gap-3" 
                                title={isSidebarExpanded ? "" : String(cfg.label)} 
                            >
                                <IconComp size={18} className={getIconColor(key)} /> 
                                <span className={`${!isSidebarExpanded && 'hidden'}`}>{String(cfg.label)}</span>
                                {currentAppConfig.openMode === 'external' && (
                                    <ExternalLink size={12} className={`ml-auto ${!isSidebarExpanded && 'hidden'}`} />
                                )}
                            </AppButton>
                        );
                    })}
                </nav>
            </div>
        </aside>
    );
};

export default LeftSidebar;
