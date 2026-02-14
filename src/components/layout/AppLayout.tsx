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

/** Apps that should hide header/sidebars on mobile for fullscreen experience */
const IMMERSIVE_APPS = ['assetplus_viewer', 'viewer', 'radar', 'map', 'fma_plus'];

const AppLayoutInner: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(() => getVoiceSettings().enabled);
    const [gunnarVisible, setGunnarVisible] = useState(() => getGunnarSettings().visible);
    const [ileanVisible, setIleanVisible] = useState(() => getIleanSettings().visible);
    const isMobile = useIsMobile();
    const { activeApp } = useContext(AppContext);

    const isImmersive = isMobile && IMMERSIVE_APPS.includes(activeApp);

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
            {!isImmersive && <LeftSidebar />}
            
            <div className="flex-1 flex flex-col min-w-0 w-full relative">
                {!isImmersive && (
                    <AppHeader
                        isLoading={false}
                        onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
                    />
                )}
                {!isImmersive && <SyncProgressBanner />}
                {!isImmersive && <DataConsistencyBanner />}
                <MainContent />
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
