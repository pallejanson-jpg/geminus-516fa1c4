import React, { useState, useCallback, useEffect, useContext } from 'react';
import LeftSidebar from './LeftSidebar';
import AppHeader from './AppHeader';
import RightSidebar from './RightSidebar';
import MobileNav from './MobileNav';
import MainContent from './MainContent';
import SyncProgressBanner from './SyncProgressBanner';
import DataConsistencyBanner from '@/components/common/DataConsistencyBanner';
import VoiceControlButton from '@/components/voice/VoiceControlButton';
import GunnarButton from '@/components/chat/GunnarButton';
import IleanButton from '@/components/chat/IleanButton';
import { useIsMobile } from '@/hooks/use-mobile';
import { getVoiceSettings, VOICE_SETTINGS_CHANGED_EVENT } from '@/components/settings/VoiceSettings';
import { getGunnarSettings, GUNNAR_SETTINGS_CHANGED_EVENT } from '@/components/settings/GunnarSettings';
import { getIleanSettings, ILEAN_SETTINGS_CHANGED_EVENT } from '@/components/settings/IleanSettings';
import { AppContext } from '@/context/AppContext';

/** Apps that should hide header/sidebars for fullscreen experience */
const IMMERSIVE_APPS = ['assetplus_viewer', 'viewer', 'native_viewer', 'radar'];

/** Apps where the left sidebar should be fully hidden (but hamburger stays) */
const VIEWER_APPS = ['assetplus_viewer', 'viewer', 'native_viewer'];

const AppLayoutInner: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(() => getVoiceSettings().enabled);
    const [gunnarVisible, setGunnarVisible] = useState(() => getGunnarSettings().visible);
    const [ileanVisible, setIleanVisible] = useState(() => getIleanSettings().visible);
    const isMobile = useIsMobile();
    const { activeApp } = useContext(AppContext);

    const { isSidebarExpanded, setIsSidebarExpanded } = useContext(AppContext);
    // Hide chrome on mobile always for immersive apps
    const isImmersive = isMobile && IMMERSIVE_APPS.includes(activeApp);
    // On desktop, hide sidebar in viewer apps but keep hamburger
    const isDesktopViewer = !isMobile && VIEWER_APPS.includes(activeApp);

    // Auto-collapse sidebar when entering a viewer app on desktop
    useEffect(() => {
        if (isDesktopViewer) {
            setIsSidebarExpanded(false);
        }
    }, [activeApp, isDesktopViewer, setIsSidebarExpanded]);

    // Listen for voice settings changes
    useEffect(() => {
        const handleSettingsChange = (e: CustomEvent) => {
            setVoiceEnabled(e.detail?.enabled ?? false);
        };
        window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, handleSettingsChange as EventListener);
        return () => window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, handleSettingsChange as EventListener);
    }, []);

    // Listen for Gunnar settings changes
    useEffect(() => {
        const handleGunnarSettingsChange = (e: CustomEvent) => {
            setGunnarVisible(e.detail?.visible ?? true);
        };
        window.addEventListener(GUNNAR_SETTINGS_CHANGED_EVENT, handleGunnarSettingsChange as EventListener);
        return () => window.removeEventListener(GUNNAR_SETTINGS_CHANGED_EVENT, handleGunnarSettingsChange as EventListener);
    }, []);

    // Listen for Ilean settings changes
    useEffect(() => {
        const handleIleanSettingsChange = (e: CustomEvent) => {
            setIleanVisible(e.detail?.visible ?? true);
        };
        window.addEventListener(ILEAN_SETTINGS_CHANGED_EVENT, handleIleanSettingsChange as EventListener);
        return () => window.removeEventListener(ILEAN_SETTINGS_CHANGED_EVENT, handleIleanSettingsChange as EventListener);
    }, []);

    // Deep link: ?gunnar=voice → auto-open Gunnar in voice mode
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('gunnar') === 'voice') {
            // Remove param from URL without reload
            params.delete('gunnar');
            const newUrl = params.toString()
                ? `${window.location.pathname}?${params.toString()}`
                : window.location.pathname;
            window.history.replaceState({}, '', newUrl);
            // Dispatch event after a short delay to let components mount
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('GUNNAR_AUTO_OPEN_VOICE'));
            }, 500);
        }
    }, []);

    // Voice command callbacks
    const voiceCallbacks = useCallback(() => ({
        onSearch: (term: string) => {
            console.log('Voice search:', term);
        },
        onOpenGunnar: () => {
            console.log('Voice: Open Gunnar');
        },
        onAskGunnar: (question: string) => {
            console.log('Voice ask Gunnar:', question);
        },
    }), []);

    return (
        <div className="flex h-screen w-full overflow-hidden font-sans relative">
            {/* Skip to main content — accessibility */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:text-sm focus:font-medium"
            >
              Skip to main content
            </a>
            {/* Left sidebar: hidden on mobile immersive, hidden on desktop viewer unless expanded */}
            {!isImmersive && (
                <div className={`
                    ${isDesktopViewer && !isSidebarExpanded ? 'hidden' : ''}
                    transition-all duration-300
                `}>
                    <LeftSidebar />
                </div>
            )}

            {/* Floating hamburger when sidebar is hidden in desktop viewer */}
            {isDesktopViewer && !isSidebarExpanded && (
                <button
                    onClick={() => setIsSidebarExpanded(true)}
                    className="fixed top-3 left-3 z-50 h-9 w-9 flex items-center justify-center rounded-lg bg-card/95 backdrop-blur-sm shadow-md border border-border hover:bg-accent transition-colors"
                    title="Show menu"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>
                </button>
            )}
            
            <div className="flex-1 flex flex-col min-w-0 w-full relative">
                {!isImmersive && (
                    <AppHeader
                        isLoading={false}
                        onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
                    />
                )}
                {!isImmersive && <SyncProgressBanner />}
                {!isImmersive && <DataConsistencyBanner />}
                <main id="main-content" className="flex-1 min-h-0 relative" role="main">
                    <MainContent />
                </main>
            </div>
            
            {!isImmersive && <RightSidebar />}
            
            {!isImmersive && (
                <MobileNav 
                    isMobileMenuOpen={isMobileMenuOpen}
                    setIsMobileMenuOpen={setIsMobileMenuOpen}
                />
            )}

            {/* Voice Control - only visible when enabled in Settings */}
            {voiceEnabled && !isImmersive && <VoiceControlButton callbacks={voiceCallbacks()} />}

            {/* Gunnar AI Assistant - visible based on settings */}
            {gunnarVisible && !isImmersive && <GunnarButton />}

            {/* Ilean AI Assistant - visible based on settings */}
            {ileanVisible && !isImmersive && <IleanButton />}
        </div>
    );
};

const AppLayout: React.FC = () => {
    return <AppLayoutInner />;
};

export default AppLayout;
