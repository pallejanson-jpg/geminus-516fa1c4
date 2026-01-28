import React, { useState, useCallback, useEffect } from 'react';
import { AppProvider } from '@/context/AppContext';
import LeftSidebar from './LeftSidebar';
import AppHeader from './AppHeader';
import RightSidebar from './RightSidebar';
import MobileNav from './MobileNav';
import MainContent from './MainContent';
import VoiceControlButton from '@/components/voice/VoiceControlButton';
import { useIsMobile } from '@/hooks/use-mobile';
import { getVoiceSettings, VOICE_SETTINGS_CHANGED_EVENT } from '@/components/settings/VoiceSettings';

const AppLayoutInner: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(() => getVoiceSettings().enabled);
    const isMobile = useIsMobile();

    // Listen for voice settings changes
    useEffect(() => {
        const handleSettingsChange = (e: CustomEvent) => {
            setVoiceEnabled(e.detail?.enabled ?? false);
        };
        window.addEventListener(VOICE_SETTINGS_CHANGED_EVENT, handleSettingsChange as EventListener);
        return () => window.removeEventListener(VOICE_SETTINGS_CHANGED_EVENT, handleSettingsChange as EventListener);
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
            <LeftSidebar />
            
            <div className="flex-1 flex flex-col min-w-0 w-full relative">
                <AppHeader
                    isLoading={false}
                    onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
                />
                <MainContent />
            </div>
            
            <RightSidebar />
            
            <MobileNav 
                isMobileMenuOpen={isMobileMenuOpen}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
            />

            {/* Voice Control - only visible when enabled in Settings */}
            {voiceEnabled && <VoiceControlButton callbacks={voiceCallbacks()} />}
        </div>
    );
};

const AppLayout: React.FC = () => {
    return (
        <AppProvider>
            <AppLayoutInner />
        </AppProvider>
    );
};

export default AppLayout;
