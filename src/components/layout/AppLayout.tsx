import React, { useState } from 'react';
import { AppProvider } from '@/context/AppContext';
import LeftSidebar from './LeftSidebar';
import AppHeader from './AppHeader';
import RightSidebar from './RightSidebar';
import MobileNav from './MobileNav';
import MainContent from './MainContent';

const AppLayout: React.FC = () => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <AppProvider>
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
            </div>
        </AppProvider>
    );
};

export default AppLayout;
