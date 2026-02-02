import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, MessageCircle, GripHorizontal, X, Minimize2, Maximize2, Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useApp } from '@/context/AppContext';
import GunnarChat from './GunnarChat';
import { cn } from '@/lib/utils';
import { VIEWER_CONTEXT_CHANGED_EVENT, ViewerContextChangedDetail } from '@/lib/viewer-events';
import { getGunnarSettings, saveGunnarSettings, GUNNAR_SETTINGS_CHANGED_EVENT, type GunnarSettingsData } from '@/components/settings/GunnarSettings';

/**
 * Floating Gunnar AI assistant button available throughout the application.
 * Opens a draggable floating panel with semi-transparent background.
 * Can be minimized to a small bubble to view content behind it.
 * The trigger button itself is now draggable with position persistence.
 */
export default function GunnarButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [viewerContext, setViewerContext] = useState<ViewerContextChangedDetail | null>(null);
  const { activeApp, selectedFacility, viewer3dFmGuid, navigatorTreeData } = useApp();
  
  // Trigger button position (draggable)
  const [triggerPosition, setTriggerPosition] = useState<{ x: number; y: number } | null>(null);
  const [isTriggerDragging, setIsTriggerDragging] = useState(false);
  const triggerDragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const triggerDragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const wasDraggedRef = useRef(false);
  
  // Draggable panel state
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: -1, y: -1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Panel dimensions
  const panelWidth = typeof window !== 'undefined' && window.innerWidth < 640 ? window.innerWidth - 32 : 400;
  const panelHeight = typeof window !== 'undefined' && window.innerHeight < 700 ? window.innerHeight - 100 : 550;

  // Load saved position on mount
  useEffect(() => {
    const settings = getGunnarSettings();
    if (settings.buttonPosition) {
      setTriggerPosition(settings.buttonPosition);
    }
  }, []);

  // Initialize panel position on first open
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

  // Trigger button drag handlers
  const handleTriggerDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // Get current button position
    const currentX = triggerPosition?.x ?? (window.innerWidth - 64);
    const currentY = triggerPosition?.y ?? (window.innerHeight - 80);
    
    triggerDragOffsetRef.current = {
      x: clientX - currentX,
      y: clientY - currentY,
    };
    triggerDragStartPosRef.current = { x: clientX, y: clientY };
    wasDraggedRef.current = false;
    setIsTriggerDragging(true);
  }, [triggerPosition]);

  const handleTriggerDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isTriggerDragging) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // Check if we've moved enough to consider it a drag
    const dx = Math.abs(clientX - triggerDragStartPosRef.current.x);
    const dy = Math.abs(clientY - triggerDragStartPosRef.current.y);
    if (dx > 5 || dy > 5) {
      wasDraggedRef.current = true;
    }
    
    const newX = clientX - triggerDragOffsetRef.current.x;
    const newY = clientY - triggerDragOffsetRef.current.y;
    
    // Constrain to viewport
    const buttonSize = 56; // h-14 w-14
    const maxX = window.innerWidth - buttonSize;
    const maxY = window.innerHeight - buttonSize;
    
    setTriggerPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY)),
    });
  }, [isTriggerDragging]);

  const handleTriggerDragEnd = useCallback(() => {
    setIsTriggerDragging(false);
    
    // Save position if it was dragged
    if (wasDraggedRef.current && triggerPosition) {
      saveGunnarSettings({ buttonPosition: triggerPosition });
    }
  }, [triggerPosition]);

  // Add/remove global drag listeners for trigger button
  useEffect(() => {
    if (isTriggerDragging) {
      window.addEventListener('mousemove', handleTriggerDragMove);
      window.addEventListener('mouseup', handleTriggerDragEnd);
      window.addEventListener('touchmove', handleTriggerDragMove);
      window.addEventListener('touchend', handleTriggerDragEnd);
      
      return () => {
        window.removeEventListener('mousemove', handleTriggerDragMove);
        window.removeEventListener('mouseup', handleTriggerDragEnd);
        window.removeEventListener('touchmove', handleTriggerDragMove);
        window.removeEventListener('touchend', handleTriggerDragEnd);
      };
    }
  }, [isTriggerDragging, handleTriggerDragMove, handleTriggerDragEnd]);

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

  // Add/remove global drag listeners for panel
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

  const handleExpand = () => {
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const handleTriggerClick = () => {
    // Only open if not dragged
    if (!wasDraggedRef.current) {
      setIsOpen(true);
      setIsMinimized(false);
    }
    wasDraggedRef.current = false;
  };

  // Calculate trigger button style
  const triggerStyle = triggerPosition 
    ? {
        left: triggerPosition.x,
        top: triggerPosition.y,
        bottom: 'auto',
        right: 'auto',
      }
    : {};

  return (
    <TooltipProvider>
      {/* Floating trigger button - draggable */}
      <div 
        className={cn(
          "fixed z-50",
          !triggerPosition && "bottom-20 right-4 sm:bottom-6"
        )}
        style={triggerStyle}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="relative">
              <Button
                onClick={handleTriggerClick}
                onMouseDown={handleTriggerDragStart}
                onTouchStart={handleTriggerDragStart}
                size="lg"
                className={cn(
                  "h-12 w-12 rounded-full shadow-lg",
                  "bg-gradient-to-br from-primary to-accent hover:from-primary/90 hover:to-accent/90",
                  "transition-all duration-300 hover:scale-105 hover:shadow-xl",
                  "sm:h-14 sm:w-14",
                  isOpen && "opacity-0 pointer-events-none",
                  isTriggerDragging && "cursor-grabbing scale-110"
                )}
              >
                <div className="relative">
                  <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6" />
                  <Sparkles className="absolute -top-1 -right-1 h-3 w-3 text-yellow-300 animate-pulse" />
                </div>
              </Button>
              {/* Drag indicator */}
              {!isOpen && (
                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-muted/80 rounded-full flex items-center justify-center pointer-events-none">
                  <Move className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="font-medium">
            Fråga Gunnar (dra för att flytta)
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Minimized bubble */}
      {isOpen && isMinimized && (
        <div 
          className="fixed bottom-20 right-4 z-[60] cursor-pointer sm:bottom-6"
          onClick={handleExpand}
        >
          <div className={cn(
            "bg-card/90 backdrop-blur-lg border rounded-full p-3 shadow-lg",
            "flex items-center gap-2 hover:bg-card transition-colors"
          )}>
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium max-w-32 truncate">Gunnar</span>
            <Maximize2 className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Floating draggable panel */}
      {isOpen && !isMinimized && (
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
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-muted/50"
                    onClick={handleMinimize}
                  >
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Minimera</TooltipContent>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-muted/50"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
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
