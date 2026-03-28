import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, MessageCircle, GripHorizontal, X, Minimize2, Maximize2, Move } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useApp } from '@/context/AppContext';
import GunnarChat from './GunnarChat';
import { cn } from '@/lib/utils';
import { VIEWER_CONTEXT_CHANGED_EVENT, ViewerContextChangedDetail, AI_VIEWER_FOCUS_EVENT } from '@/lib/viewer-events';
import { getGunnarSettings, saveGunnarSettings, GUNNAR_SETTINGS_CHANGED_EVENT, type GunnarSettingsData } from '@/components/settings/GunnarSettings';

const BUTTON_SIZE = 56; // h-14 w-14

/**
 * Floating Gunnar AI assistant button available throughout the application.
 * Opens a draggable floating panel with semi-transparent background.
 * Can be minimized to a small bubble to view content behind it.
 * The trigger button itself is now draggable with position persistence.
 */
export default function GunnarButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [autoVoice, setAutoVoice] = useState(false);
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
  
  // Detect mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  
  // Panel dimensions — fullscreen on mobile, resizable on desktop
  const DEFAULT_WIDTH = 480;
  const DEFAULT_HEIGHT = typeof window !== 'undefined' && window.innerHeight < 700 ? window.innerHeight - 100 : 620;
  const MIN_WIDTH = 360;
  const MIN_HEIGHT = 400;
  const [panelSize, setPanelSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ x: number; y: number; w: number; h: number }>({ x: 0, y: 0, w: 0, h: 0 });
  const panelWidth = isMobile ? window.innerWidth : panelSize.width;
  const panelHeight = isMobile ? window.innerHeight : panelSize.height;

  // Load saved position on mount — clamp to current viewport
  useEffect(() => {
    const settings = getGunnarSettings();
    if (settings.buttonPosition) {
      const maxX = window.innerWidth - BUTTON_SIZE;
      const maxY = window.innerHeight - BUTTON_SIZE;
      setTriggerPosition({
        x: Math.max(0, Math.min(settings.buttonPosition.x, maxX)),
        y: Math.max(0, Math.min(settings.buttonPosition.y, maxY)),
      });
    }
  }, []);

  // Initialize panel position on first open
  useEffect(() => {
    if (isOpen && position.x === -1) {
      if (isMobile) {
        setPosition({ x: 0, y: 0 });
      } else {
        const x = typeof window !== 'undefined' ? window.innerWidth - panelWidth - 16 : 100;
        const y = typeof window !== 'undefined' ? window.innerHeight - panelHeight - 80 : 100;
        setPosition({ x: Math.max(16, x), y: Math.max(16, y) });
      }
    }
  }, [isOpen, position.x, panelWidth, panelHeight, isMobile]);

  // Listen for viewer context changes
  useEffect(() => {
    const handler = (e: CustomEvent<ViewerContextChangedDetail>) => {
      setViewerContext(e.detail);
    };
    window.addEventListener(VIEWER_CONTEXT_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(VIEWER_CONTEXT_CHANGED_EVENT, handler as EventListener);
  }, []);

  // Listen for auto-open voice deep link
  useEffect(() => {
    const handler = () => {
      setAutoVoice(true);
      setIsOpen(true);
      setIsMinimized(false);
    };
    window.addEventListener('GUNNAR_AUTO_OPEN_VOICE', handler);
    return () => window.removeEventListener('GUNNAR_AUTO_OPEN_VOICE', handler);
  }, []);

  // Auto-minimize on mobile when AI dispatches a viewer action
  useEffect(() => {
    if (!isMobile) return;
    const handler = () => {
      if (isOpen && !isMinimized) {
        setIsMinimized(true);
      }
    };
    window.addEventListener(AI_VIEWER_FOCUS_EVENT, handler);
    return () => window.removeEventListener(AI_VIEWER_FOCUS_EVENT, handler);
  }, [isMobile, isOpen, isMinimized]);

  // Clear viewer context when leaving viewer
  useEffect(() => {
    if (activeApp !== 'assetplus_viewer' && activeApp !== 'native_viewer') {
      setViewerContext(null);
    }
  }, [activeApp]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (isMobile) return; // No drag on mobile — fullscreen panel
    e.preventDefault();
    setIsDragging(true);
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    dragOffsetRef.current = {
      x: clientX - position.x,
      y: clientY - position.y,
    };
  }, [position, isMobile]);

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
    const maxX = window.innerWidth - BUTTON_SIZE;
    const maxY = window.innerHeight - BUTTON_SIZE;
    
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

    if (viewer3dFmGuid && !context.currentBuilding) {
      const building = navigatorTreeData.find((b: any) => b.fmGuid === viewer3dFmGuid);
      if (building) {
        context.currentBuilding = {
          fmGuid: building.fmGuid,
          name: building.commonName || building.name,
        };
      }
    }

    if (viewerContext) {
      context.viewerState = viewerContext;
    }

    return context;
  };

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    resizeStartRef.current = { x: clientX, y: clientY, w: panelSize.width, h: panelSize.height };
  }, [panelSize]);

  const handleResizeMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isResizing) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const dx = clientX - resizeStartRef.current.x;
    const dy = clientY - resizeStartRef.current.y;
    setPanelSize({
      width: Math.max(MIN_WIDTH, resizeStartRef.current.w + dx),
      height: Math.max(MIN_HEIGHT, resizeStartRef.current.h + dy),
    });
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResizeMove);
      window.addEventListener('mouseup', handleResizeEnd);
      window.addEventListener('touchmove', handleResizeMove);
      window.addEventListener('touchend', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeEnd);
        window.removeEventListener('touchmove', handleResizeMove);
        window.removeEventListener('touchend', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

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
          !triggerPosition && "right-4 sm:bottom-6"
        )}
        style={triggerPosition ? triggerStyle : {
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
        }}
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
            Fråga Geminus AI (dra för att flytta)
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Minimized bubble */}
      {isOpen && isMinimized && (
        <div 
          className="fixed right-4 z-[60] cursor-pointer"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
          onClick={handleExpand}
        >
          <div className={cn(
            "bg-card/90 backdrop-blur-lg border rounded-full p-3 shadow-lg",
            "flex items-center gap-2 hover:bg-card transition-colors"
          )}>
            <Sparkles className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium max-w-32 truncate">Geminus AI</span>
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
            "bg-card/70 backdrop-blur-lg",
            isDragging && "cursor-grabbing select-none"
          )}
          style={isMobile ? {
            inset: 0,
            width: '100%',
            height: '100%',
            borderRadius: 0,
          } : {
            left: position.x,
            top: position.y,
            width: panelWidth,
            height: panelHeight,
          }}
        >
          {/* Header — simplified on mobile (no drag grip) */}
          <div
            className={cn(
              "flex items-center justify-between px-3 py-2",
              "border-b border-border/50",
              !isMobile && "rounded-t-lg bg-muted/30 cursor-grab",
              isMobile && "bg-muted/30",
              isDragging && "cursor-grabbing"
            )}
            onMouseDown={isMobile ? undefined : handleDragStart}
            onTouchStart={isMobile ? undefined : handleDragStart}
          >
            <div className="flex items-center gap-2">
              {!isMobile && <GripHorizontal className="h-4 w-4 text-muted-foreground" />}
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Geminus AI</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {!isMobile && (
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
              )}
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
              autoVoice={autoVoice}
              onAutoVoiceConsumed={() => setAutoVoice(false)}
            />
          </div>

          {/* Resize handle (bottom-right corner) */}
          {!isMobile && (
            <div
              className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-10 group flex items-end justify-end p-0.5"
              onMouseDown={handleResizeStart}
              onTouchStart={handleResizeStart}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors">
                <line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" strokeWidth="1.5" />
                <line x1="12" y1="6" x2="6" y2="12" stroke="currentColor" strokeWidth="1.5" />
                <line x1="12" y1="10" x2="10" y2="12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
          )}
        </div>
      )}
    </TooltipProvider>
  );
}
