import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { 
    Search, Home, LayoutGrid, Globe, Network, User as UserIcon, 
    Menu as MenuIcon, Cuboid, HelpCircle, Loader2, Settings, LogOut, Shield, Sparkles, AppWindow, Code
} from 'lucide-react';
import ApiSettingsModal from '@/components/settings/ApiSettingsModal';
import ProfileModal from '@/components/settings/ProfileModal';
import AppMenuSettings from '@/components/settings/AppMenuSettings';
import { AppButton } from '@/components/common/AppButton';
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

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
import { CommandSearch } from '@/components/common/CommandSearch';
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
    const isMobile = useIsMobile();
    const { toast } = useToast();
    const [globalSearch, setGlobalSearch] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [isApiSettingsOpen, setIsApiSettingsOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isAppMenuOpen, setIsAppMenuOpen] = useState(false);
    const [isCommandOpen, setIsCommandOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const t = THEMES[theme];

    // User display info
    const displayName = profile?.displayName || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
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

    // Ctrl+K / Cmd+K to open command palette
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsCommandOpen(true);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const viewButtons = [
        { key: 'portfolio', mode: 'grid', icon: LayoutGrid, label: 'Portfolio' },
        { key: 'map', mode: undefined, icon: Globe, label: 'Map' },
        { key: 'navigation', mode: undefined, icon: Network, label: 'Navigator' },
        { key: 'native_viewer', mode: undefined, icon: Cuboid, label: '3D View' },
    ];

    return (
        <header
            className={`sticky top-0 z-30 ${t.bgSec} border-b ${t.border} flex items-center justify-between px-2 sm:px-4 gap-1 sm:gap-4 overflow-hidden`}
            style={{
                height: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)',
                paddingTop: 'env(safe-area-inset-top, 0px)',
            }}
        >
            {/* Left section */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
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

            {/* Center - Search (click opens command palette) */}
            <div className="flex-1 min-w-0 max-w-xs sm:max-w-md relative">
                <button
                    type="button"
                    onClick={() => setIsCommandOpen(true)}
                    className="w-full flex items-center gap-2 h-9 sm:h-10 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-accent/50 transition-colors"
                >
                    <Search className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left truncate">Search buildings, rooms, objects...</span>
                    <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                        ⌘K
                    </kbd>
                </button>
            </div>

            <CommandSearch open={isCommandOpen} onOpenChange={setIsCommandOpen} />

            {/* Right section */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
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
                            Profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsApiSettingsOpen(true)}>
                            <Settings className="mr-2 h-4 w-4" />
                            Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setIsAppMenuOpen(true)}>
                            <AppWindow className="mr-2 h-4 w-4" />
                            Apps
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate('/onboarding')}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            Start introduction
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate('/api-docs')}>
                            <Code className="mr-2 h-4 w-4" />
                            API Documentation
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                            <LogOut className="mr-2 h-4 w-4" />
                            Sign out
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
                <AppMenuSettings
                    isOpen={isAppMenuOpen}
                    onClose={() => setIsAppMenuOpen(false)}
                />
            </div>
        </header>
    );
};

export default AppHeader;
