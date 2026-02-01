import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Search, Home, LayoutGrid, Globe, Network, User as UserIcon, 
    Menu as MenuIcon, Cuboid, HelpCircle, Loader2, Settings, LogOut, Shield, Sparkles
} from 'lucide-react';
import ApiSettingsModal from '@/components/settings/ApiSettingsModal';
import ProfileModal from '@/components/settings/ProfileModal';
import { AppButton } from '@/components/common/AppButton';
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { THEMES } from '@/lib/constants';
import { AppContext } from '@/context/AppContext';
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
import { useAuth } from '@/hooks/useAuth';

interface AppHeaderProps {
    isLoading?: boolean;
    onToggleMobileMenu: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({
    isLoading = false,
    onToggleMobileMenu,
}) => {
    const navigate = useNavigate();
    const { 
        theme, 
        activeApp, 
        setActiveApp, 
        viewMode, 
        setViewMode,
        setSelectedFacility,
        toggleRightSidebar,
        navigatorTreeData,
        setViewer3dFmGuid,
    } = useContext(AppContext);
    
    const { user, profile, isAdmin, signOut } = useAuth();
    const { toast } = useToast();
    const [globalSearch, setGlobalSearch] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const t = THEMES[theme];

    // User display info
    const displayName = profile?.displayName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Användare';
    const avatarUrl = profile?.avatarUrl || user?.user_metadata?.avatar_url;
    const userInitials = displayName.slice(0, 2).toUpperCase();

    // Handle sign out
    const handleSignOut = useCallback(async () => {
        await signOut();
        navigate('/login');
    }, [signOut, navigate]);

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
                    className="h-9 w-9 sm:h-10 sm:w-10"
                    title="Help Center"
                >
                    <HelpCircle size={18} />
                </AppButton>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="flex items-center gap-2 p-1 rounded-full hover:bg-muted transition-colors">
                            <Avatar className="h-7 w-7 sm:h-8 sm:w-8">
                                <AvatarImage src={avatarUrl || ''} />
                                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                                    {userInitials}
                                </AvatarFallback>
                            </Avatar>
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 bg-popover">
                        <div className="px-2 py-1.5">
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">{displayName}</p>
                                {isAdmin && (
                                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                                        <Shield className="h-2.5 w-2.5 mr-0.5" />
                                        Admin
                                    </Badge>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
                            <UserIcon className="mr-2 h-4 w-4" />
                            Profil
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsApiSettingsOpen(true)}>
                            <Settings className="mr-2 h-4 w-4" />
                            Inställningar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate('/onboarding')}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Starta introduktion
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                            <LogOut className="mr-2 h-4 w-4" />
                            Logga ut
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <ProfileModal 
                    isOpen={isProfileOpen} 
                    onClose={() => setIsProfileOpen(false)} 
                />
                <ApiSettingsModal 
                    isOpen={isApiSettingsOpen} 
                    onClose={() => setIsApiSettingsOpen(false)} 
                />
            </div>
        </header>
    );
};

export default AppHeader;
