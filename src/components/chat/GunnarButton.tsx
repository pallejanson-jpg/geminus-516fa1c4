import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, MessageCircle, GripHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useApp } from '@/context/AppContext';
import GunnarChat from './GunnarChat';
import { cn } from '@/lib/utils';
import { VIEWER_CONTEXT_CHANGED_EVENT, ViewerContextChangedDetail } from '@/lib/viewer-events';

/**
 * Floating Gunnar AI assistant button available throughout the application.
 * Opens a draggable floating panel with semi-transparent background.
 */
export default function GunnarButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [viewerContext, setViewerContext] = useState<ViewerContextChangedDetail | null>(null);
  const { activeApp, selectedFacility, viewer3dFmGuid, navigatorTreeData } = useApp();
  
  // Draggable panel state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Panel dimensions
  const panelWidth = typeof window !== 'undefined' && window.innerWidth < 640 ? window.innerWidth - 32 : 400;
  const panelHeight = typeof window !== 'undefined' && window.innerHeight < 700 ? window.innerHeight - 100 : 550;

  // Initialize position on first open
  useEffect(() => {
    if (isOpen && position.x === -1) {
      // Position in bottom-right by default
      const x = typeof window !== 'undefined' ? window.innerWidth - panelWidth - 16 : 100;
      const y = typeof window !== 'undefined' ? window.innerHeight - panelHeight - 80 : 100;
      setPosition({ x: Math.max(16, x), y: Math.max(16, y) });
    }
  }, [isOpen, position.x, panelWidth, panelHeight]);

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

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    dragOffsetRef.current = {
      x: clientX - position.x,
      y: clientY - position.y,
    };
  }, [position]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const newX = clientX - dragOffsetRef.current.x;
    const newY = clientY - dragOffsetRef.current.y;
    
    // Constrain to viewport
    const maxX = window.innerWidth - panelWidth;
    const maxY = window.innerHeight - 50;
    
    setPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY)),
    });
  }, [isDragging, panelWidth]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add/remove global drag listeners
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
      
      return () => {
        window.removeEventListener('mousemove', handleDragMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleDragMove);
        window.removeEventListener('touchend', handleDragEnd);
      };
    }
  }, [isDragging, handleDragMove, handleDragEnd]);

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
      {/* Floating trigger button - positioned bottom right */}
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
                "sm:h-14 sm:w-14",
                isOpen && "opacity-0 pointer-events-none"
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

      {/* Floating draggable panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className={cn(
            "fixed z-[60] flex flex-col",
            "border rounded-lg shadow-xl",
            // Semi-transparent frosted glass effect
            "bg-card/70 backdrop-blur-lg",
            isDragging && "cursor-grabbing select-none"
          )}
          style={{
            left: position.x,
            top: position.y,
            width: panelWidth,
            height: panelHeight,
          }}
        >
          {/* Draggable header */}
          <div
            className={cn(
              "flex items-center justify-between px-3 py-2",
              "border-b border-border/50 rounded-t-lg",
              "bg-muted/30 cursor-grab",
              isDragging && "cursor-grabbing"
            )}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            <div className="flex items-center gap-2">
              <GripHorizontal className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Gunnar AI</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-muted/50"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Chat content */}
          <div className="flex-1 overflow-hidden">
            <GunnarChat 
              open={true} 
              onClose={() => setIsOpen(false)} 
              context={buildContext()}
              embedded 
            />
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
