import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import { 
    Search, Home, LayoutGrid, Globe, Network, User as UserIcon, 
    Menu as MenuIcon, Cuboid, HelpCircle, Loader2, Server
} from 'lucide-react';
import ApiSettingsModal from '@/components/settings/ApiSettingsModal';
import { AppButton } from '@/components/common/AppButton';
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { THEMES, THEME_OPTIONS } from '@/lib/constants';
import { AppContext, ThemeType } from '@/context/AppContext';
import { Input } from '@/components/ui/input';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSearchResults, SearchResult } from '@/hooks/useSearchResults';
import { SearchResultsList } from '@/components/common/SearchResultsList';

interface AppHeaderProps {
    isLoading?: boolean;
    onToggleMobileMenu: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
    isLoading = false,
    onToggleMobileMenu,
}) => {
    const { 
        theme, 
        setTheme, 
        activeApp, 
        setActiveApp, 
        viewMode, 
        setViewMode,
        setSelectedFacility,
        toggleRightSidebar,
        navigatorTreeData,
        setViewer3dFmGuid,
    } = useContext(AppContext);
    
    const { toast } = useToast();
    const [globalSearch, setGlobalSearch] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const t = THEMES[theme];

    // Search results from shared hook
    const searchResults = useSearchResults(navigatorTreeData, globalSearch, 15);

    const handleSearchResultSelect = useCallback((result: SearchResult) => {
        setGlobalSearch('');
        setIsSearchFocused(false);
        
        if (result.category === 'Building') {
            setSelectedFacility({
                fmGuid: result.fmGuid,
                name: result.name,
                commonName: result.name,
                category: result.category,
            });
            setActiveApp('portfolio');
        } else {
            // For non-buildings, open 3D viewer
            setViewer3dFmGuid(result.fmGuid);
        }
    }, [setSelectedFacility, setActiveApp, setViewer3dFmGuid]);

    const handleMenuClick = (app: string, mode?: string) => {
        setSelectedFacility(null);
        setActiveApp(app);
        if (mode) {
            setViewMode(mode);
        }
    };

    // Close search dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setIsSearchFocused(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const viewButtons = [
        { key: 'portfolio', mode: 'grid', icon: LayoutGrid, label: 'Portfolio' },
        { key: 'map', mode: undefined, icon: Globe, label: 'Map' },
        { key: 'navigation', mode: undefined, icon: Network, label: 'Navigator' },
        { key: 'assetplus_viewer', mode: undefined, icon: Cuboid, label: '3D Viewer' },
    ];

    return (
        <header className={`sticky top-0 z-30 h-14 sm:h-16 ${t.bgSec} border-b ${t.border} flex items-center justify-between px-2 sm:px-4 gap-2 sm:gap-4`}>
            {/* Left section */}
            <div className="flex items-center gap-1 sm:gap-2">
                <AppButton 
                    onClick={onToggleMobileMenu} 
                    variant="ghost" 
                    className="md:hidden h-9 w-9 sm:h-10 sm:w-10"
                >
                    <MenuIcon size={20} />
                </AppButton>
                
                <AppButton 
                    onClick={() => handleMenuClick('home')} 
                    variant={activeApp === 'home' ? 'default' : 'ghost'}
                    className="hidden md:flex gap-2"
                >
                    <Home size={18} />
                    <span className="hidden lg:inline">Home</span>
                </AppButton>

                <div className="hidden md:flex items-center gap-1 ml-2">
                    {viewButtons.map(btn => (
                        <AppButton
                            key={btn.key}
                            onClick={() => handleMenuClick(btn.key, btn.mode)}
                            variant={activeApp === btn.key ? 'default' : 'ghost'}
                            className="gap-2"
                            title={btn.label}
                        >
                            <btn.icon size={18} />
                            <span className="hidden lg:inline">{btn.label}</span>
                        </AppButton>
                    ))}
                </div>
            </div>

            {/* Center - Search */}
            <div ref={searchRef} className="flex-1 max-w-xs sm:max-w-md relative">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Sök byggnader, rum, utrymmen..."
                        className="pl-10 w-full text-sm"
                        value={globalSearch}
                        onChange={(e) => setGlobalSearch(e.target.value)}
                        onFocus={() => setIsSearchFocused(true)}
                    />
                    {isLoading && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                </div>
                
                {/* Search Results Dropdown */}
                {isSearchFocused && globalSearch.trim().length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
                        <SearchResultsList
                            results={searchResults}
                            onSelect={handleSearchResultSelect}
                            emptyMessage="Inga resultat för din sökning"
                        />
                    </div>
                )}
            </div>

            {/* Right section */}
            <div className="flex items-center gap-1 sm:gap-2">
                <AppButton
                    onClick={toggleRightSidebar}
                    variant="ghost"
                    className="hidden sm:flex h-10 w-10"
                    title="Help Center"
                >
                    <HelpCircle size={18} />
                </AppButton>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-2 p-1 rounded-full hover:bg-muted transition-colors">
                            <Avatar className="h-7 w-7 sm:h-8 sm:w-8">
                                <AvatarImage src="" />
                                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                                    U
                                </AvatarFallback>
                            </Avatar>
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <div className="px-2 py-1.5">
                            <p className="text-sm font-medium">User</p>
                            <p className="text-xs text-muted-foreground">user@example.com</p>
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>
                            <UserIcon className="mr-2 h-4 w-4" />
                            Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsApiSettingsOpen(true)}>
                            <Server className="mr-2 h-4 w-4" />
                            Settings
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <div className="px-2 py-1.5">
                            <p className="text-xs font-medium text-muted-foreground mb-2">Theme</p>
                            <div className="flex gap-2">
                                {THEME_OPTIONS.map((option) => (
                                    <button
                                        key={option.value}
                                        onClick={() => setTheme(option.value as ThemeType)}
                                        className={`flex flex-col items-center gap-1 p-2 rounded-md transition-colors ${
                                            theme === option.value 
                                                ? 'bg-primary/20 ring-1 ring-primary' 
                                                : 'hover:bg-muted'
                                        }`}
                                        title={option.label}
                                    >
                                        <div className="flex gap-0.5">
                                            {option.colors.map((color, i) => (
                                                <div 
                                                    key={i}
                                                    className="w-3 h-3 rounded-full border border-border"
                                                    style={{ backgroundColor: color }}
                                                />
                                            ))}
                                        </div>
                                        <span className="text-[10px]">{option.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                            onClick={() => toast({ title: "Sign Out", description: "Authentication coming soon with Lovable Cloud" })}
                        >
                            Sign Out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <ApiSettingsModal 
                    isOpen={isApiSettingsOpen} 
                    onClose={() => setIsApiSettingsOpen(false)} 
                />
            </div>
        </header>
    );
};

export default AppHeader;
