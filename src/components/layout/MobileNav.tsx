import React, { useContext } from 'react';
import { Box, LayoutGrid, Globe, Network, Cuboid, Home, X } from 'lucide-react';
import { AppButton } from '@/components/common/AppButton';
import { THEMES, DEFAULT_APP_CONFIGS } from '@/lib/constants';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppContext } from '@/context/AppContext';

interface MobileNavProps {
    isMobileMenuOpen: boolean;
    setIsMobileMenuOpen: (open: boolean) => void;
}

const MobileNav: React.FC<MobileNavProps> = ({
    isMobileMenuOpen,
    setIsMobileMenuOpen,
}) => {
    const { theme, activeApp, setActiveApp } = useContext(AppContext);
    const isMobile = useIsMobile();
    const t = THEMES[theme];
    
    const handleAppClick = (key: string) => {
        setActiveApp(key);
        setIsMobileMenuOpen(false);
    }
    
    if (!isMobile) return null;

    return (
        <>
            {isMobileMenuOpen && (
                <>
                    <div 
                        className="fixed inset-0 bg-black/60 z-30" 
                        onClick={() => setIsMobileMenuOpen(false)}
                    />
                    <div className={`fixed bottom-0 left-0 right-0 p-4 ${t.bgSec} border-t ${t.border} z-40 md:hidden flex flex-col rounded-t-2xl animate-in slide-in-from-bottom duration-300`}>
                        <div className="flex justify-end mb-2">
                            <AppButton 
                                onClick={() => setIsMobileMenuOpen(false)} 
                                variant="ghost" 
                                className="h-8 w-8"
                            >
                                <X size={18} />
                            </AppButton>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 text-center">
                            <AppButton 
                                onClick={() => handleAppClick('home')} 
                                variant="ghost" 
                                className={`flex-col !h-auto !w-auto !p-2 ${activeApp === 'home' ? 'text-primary' : t.textSec}`}
                            >
                                <Home size={22} />
                                <span className="text-[10px] mt-1">Home</span>
                            </AppButton>
                            
                            <AppButton 
                                onClick={() => handleAppClick('portfolio')} 
                                variant="ghost" 
                                className={`flex-col !h-auto !w-auto !p-2 ${activeApp === 'portfolio' ? 'text-primary' : t.textSec}`}
                            >
                                <LayoutGrid size={22} />
                                <span className="text-[10px] mt-1">Portfolio</span>
                            </AppButton>
                            
                            <AppButton 
                                onClick={() => handleAppClick('navigation')} 
                                variant="ghost" 
                                className={`flex-col !h-auto !w-auto !p-2 ${activeApp === 'navigation' ? 'text-primary' : t.textSec}`}
                            >
                                <Network size={22} />
                                <span className="text-[10px] mt-1">Navigator</span>
                            </AppButton>
                            
                            <AppButton 
                                onClick={() => handleAppClick('map')} 
                                variant="ghost" 
                                className={`flex-col !h-auto !w-auto !p-2 ${activeApp === 'map' ? 'text-primary' : t.textSec}`}
                            >
                                <Globe size={22} />
                                <span className="text-[10px] mt-1">Map</span>
                            </AppButton>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4 text-center mt-4">
                            <AppButton 
                                onClick={() => handleAppClick('assetplus_viewer')} 
                                variant="ghost" 
                                className={`flex-col !h-auto !w-auto !p-2 ${activeApp === 'assetplus_viewer' ? 'text-primary' : t.textSec}`}
                            >
                                <Cuboid size={22} />
                                <span className="text-[10px] mt-1">3D Viewer</span>
                            </AppButton>
                            
                            {Object.entries(DEFAULT_APP_CONFIGS).slice(0, 3).map(([key, cfg]: [string, any]) => {
                                const IconComp = cfg.icon || Box;
                                return (
                                    <AppButton 
                                        key={key}
                                        onClick={() => handleAppClick(key)} 
                                        variant="ghost" 
                                        className={`flex-col !h-auto !w-auto !p-2 ${activeApp === key ? 'text-primary' : t.textSec}`}
                                    >
                                        <IconComp size={22} />
                                        <span className="text-[10px] mt-1">{cfg.label}</span>
                                    </AppButton>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

export default MobileNav;
