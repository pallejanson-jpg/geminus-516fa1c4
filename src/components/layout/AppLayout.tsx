import React, { useState, useCallback } from 'react';
import { AppProvider } from '@/context/AppContext';
import LeftSidebar from './LeftSidebar';
import AppHeader from './AppHeader';
import RightSidebar from './RightSidebar';
import MobileNav from './MobileNav';
import MainContent from './MainContent';
import VoiceControlButton from '@/components/voice/VoiceControlButton';
import { useIsMobile } from '@/hooks/use-mobile';

const AppLayoutInner: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const isMobile = useIsMobile();

    // Voice command callbacks
    const voiceCallbacks = useCallback(() => ({
        onSearch: (term: string) => {
            // Could trigger search in header - for now just log
            console.log('Voice search:', term);
        },
        onOpenGunnar: () => {
            // Could open Gunnar chat panel
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

            {/* Voice Control - visible on all devices for testing, primarily for mobile */}
            <VoiceControlButton callbacks={voiceCallbacks()} />
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
