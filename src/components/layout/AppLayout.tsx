import React, { useState, useCallback, useEffect } from 'react';
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

const AppLayoutInner: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(() => getVoiceSettings().enabled);
    const [gunnarVisible, setGunnarVisible] = useState(() => getGunnarSettings().visible);
    const [ileanVisible, setIleanVisible] = useState(() => getIleanSettings().visible);
    const isMobile = useIsMobile();

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
            <LeftSidebar />
            
            <div className="flex-1 flex flex-col min-w-0 w-full relative">
                <AppHeader
                    isLoading={false}
                    onToggleMobileMenu={() => setIsMobileMenuOpen(prev => !prev)}
                />
                <SyncProgressBanner />
                <DataConsistencyBanner />
                <MainContent />
            </div>
            
            <RightSidebar />
            
            <MobileNav 
                isMobileMenuOpen={isMobileMenuOpen}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
            />

            {/* Voice Control - only visible when enabled in Settings */}
            {voiceEnabled && <VoiceControlButton callbacks={voiceCallbacks()} />}

            {/* Gunnar AI Assistant - visible based on settings */}
            {gunnarVisible && <GunnarButton />}

            {/* Ilean AI Assistant - visible based on settings */}
            {ileanVisible && <IleanButton />}
        </div>
    );
};

const AppLayout: React.FC = () => {
    return <AppLayoutInner />;
};

export default AppLayout;
