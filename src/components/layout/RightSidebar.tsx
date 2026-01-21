import React, { useContext } from 'react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { LifeBuoy, BookOpen, MessageSquare, X, HelpCircle } from 'lucide-react';
import { THEMES } from '@/lib/constants';
import { AppContext } from '@/context/AppContext';
import { AppButton } from '@/components/common/AppButton';

const RightSidebar: React.FC = () => {
    const { theme, isRightSidebarVisible, toggleRightSidebar } = useContext(AppContext);
    const t = THEMES[theme];

    if (!isRightSidebarVisible) {
        return null;
    }

    return (
        <aside className={`fixed top-0 bottom-0 right-0 z-40 w-80 animate-in slide-in-from-right duration-300 border-l ${t.border} ${t.bgSec} flex flex-col overflow-hidden`}>
            <div className={`p-4 ${t.bg} flex justify-between items-center border-b ${t.border}`}>
                <h2 className="font-bold text-lg">Hjälpcenter</h2>
                <AppButton variant="ghost" className="h-8 w-8 p-0" onClick={toggleRightSidebar}>
                    <X size={18}/>
                </AppButton>
            </div>
            
            <Accordion type="single" collapsible className="w-full" defaultValue="">
                <AccordionItem value="item-1">
                    <AccordionTrigger className="p-4 font-bold text-sm">
                        <div className="flex items-center gap-3">
                            <LifeBuoy className="text-blue-500" size={18}/>
                            Support
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className={`p-4 text-center ${t.textSec} text-xs`}>
                        Support-funktionalitet kommer snart.
                    </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="item-2">
                    <AccordionTrigger className="p-4 font-bold text-sm">
                        <div className="flex items-center gap-3">
                            <BookOpen className="text-cyan-500" size={18}/>
                            Dokumentation
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 text-center text-muted-foreground text-xs">
                        API-dokumentation kommer snart.
                    </AccordionContent>
                </AccordionItem>
                
                <AccordionItem value="item-3">
                    <AccordionTrigger className="p-4 font-bold text-sm">
                        <div className="flex items-center gap-3">
                            <MessageSquare className="text-purple-500" size={18}/>
                            Chat
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="p-4 text-center text-muted-foreground text-xs">
                        Chat-funktionalitet kommer snart.
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </aside>
    );
};

export default RightSidebar;
