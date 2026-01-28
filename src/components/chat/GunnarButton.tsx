import React, { useState, useEffect } from 'react';
import { Sparkles, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useApp } from '@/context/AppContext';
import GunnarChat from './GunnarChat';
import { cn } from '@/lib/utils';
import { VIEWER_CONTEXT_CHANGED_EVENT, ViewerContextChangedDetail } from '@/lib/viewer-events';

/**
 * Floating Gunnar AI assistant button available throughout the application.
 * Opens a Sheet containing the GunnarChat interface.
 */
export default function GunnarButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [viewerContext, setViewerContext] = useState<ViewerContextChangedDetail | null>(null);
  const { activeApp, selectedFacility, viewer3dFmGuid, navigatorTreeData } = useApp();

  // Listen for viewer context changes
  useEffect(() => {
    const handler = (e: CustomEvent<ViewerContextChangedDetail>) => {
      setViewerContext(e.detail);
    };
    window.addEventListener(VIEWER_CONTEXT_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEWER_CONTEXT_CHANGED_EVENT, handler as EventListener);
  }, []);

  // Clear viewer context when leaving viewer
  useEffect(() => {
    if (activeApp !== 'assetplus_viewer') {
      setViewerContext(null);
    }
  }, [activeApp]);

  // Build context object for GunnarChat
  const buildContext = () => {
    const context: any = {
      activeApp,
    };

    // Get current building info
    if (selectedFacility) {
      if (selectedFacility.category === 'Building') {
        context.currentBuilding = {
          fmGuid: selectedFacility.fmGuid,
          name: selectedFacility.commonName || selectedFacility.name,
        };
      } else if (selectedFacility.category === 'Building Storey') {
        context.currentStorey = {
          fmGuid: selectedFacility.fmGuid,
          name: selectedFacility.commonName || selectedFacility.name,
        };
        // Try to find parent building
        if (selectedFacility.buildingFmGuid) {
          const building = navigatorTreeData.find((b: any) => b.fmGuid === selectedFacility.buildingFmGuid);
          if (building) {
            context.currentBuilding = {
              fmGuid: building.fmGuid,
              name: building.commonName || building.name,
            };
          }
        }
      } else if (selectedFacility.category === 'Space') {
        context.currentSpace = {
          fmGuid: selectedFacility.fmGuid,
          name: selectedFacility.commonName || selectedFacility.name,
        };
        // Try to find parent building
        if (selectedFacility.buildingFmGuid) {
          const building = navigatorTreeData.find((b: any) => b.fmGuid === selectedFacility.buildingFmGuid);
          if (building) {
            context.currentBuilding = {
              fmGuid: building.fmGuid,
              name: building.commonName || building.name,
            };
          }
        }
      }
    }

    // If in 3D viewer, use viewer3dFmGuid to find building
    if (viewer3dFmGuid && !context.currentBuilding) {
      const building = navigatorTreeData.find((b: any) => b.fmGuid === viewer3dFmGuid);
      if (building) {
        context.currentBuilding = {
          fmGuid: building.fmGuid,
          name: building.commonName || building.name,
        };
      }
    }

    // Add viewer state if available
    if (viewerContext) {
      context.viewerState = viewerContext;
    }

    return context;
  };

  return (
    <TooltipProvider>
      {/* Floating button - positioned bottom right */}
      <div className="fixed bottom-20 right-4 z-50 sm:bottom-6">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => setIsOpen(true)}
              size="lg"
              className={cn(
                "h-12 w-12 rounded-full shadow-lg",
                "bg-gradient-to-br from-primary to-accent hover:from-primary/90 hover:to-accent/90",
                "transition-all duration-300 hover:scale-105 hover:shadow-xl",
                "sm:h-14 sm:w-14"
              )}
            >
              <div className="relative">
                <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6" />
                <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-yellow-300 animate-pulse" />
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="font-medium">
            Fråga Gunnar
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Chat Sheet */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent 
          side="right" 
          className="w-full sm:max-w-lg p-0 flex flex-col h-full"
        >
          <SheetTitle className="sr-only">Gunnar AI-assistent</SheetTitle>
          <GunnarChat 
            open={true} 
            onClose={() => setIsOpen(false)} 
            context={buildContext()}
            embedded 
          />
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
