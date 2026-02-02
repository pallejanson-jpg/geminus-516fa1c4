import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { FileQuestion, GripHorizontal, X, Minimize2, Maximize2, Move, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getIleanSettings, saveIleanSettings, ILEAN_SETTINGS_CHANGED_EVENT, type IleanSettingsData } from '@/components/settings/IleanSettings';
import { AppContext } from '@/context/AppContext';

/**
 * Floating Ilean AI assistant button available throughout the application.
 * Opens a draggable floating panel with an iframe to Senslinc's Ilean service.
 * Can be minimized to a small bubble to view content behind it.
 * The trigger button itself is draggable with position persistence.
 */
export default function IleanButton() {
  const { selectedFacility, allData } = useContext(AppContext);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [ileanUrl, setIleanUrl] = useState<string | null>(null);
  
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
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Panel dimensions
  const panelWidth = typeof window !== 'undefined' && window.innerWidth < 640 ? window.innerWidth - 32 : 420;
  const panelHeight = typeof window !== 'undefined' && window.innerHeight < 700 ? window.innerHeight - 100 : 580;

  // Load saved position on mount
  useEffect(() => {
    const settings = getIleanSettings();
    if (settings.buttonPosition) {
      setTriggerPosition(settings.buttonPosition);
    }
  }, []);

  // Initialize panel position on first open
  useEffect(() => {
    if (isOpen && position.x === -1) {
      // Position in bottom-left by default (different from Gunnar)
      const x = 16;
      const y = typeof window !== 'undefined' ? window.innerHeight - panelHeight - 80 : 100;
      setPosition({ x, y: Math.max(16, y) });
    }
  }, [isOpen, position.x, panelHeight]);

  // Extract Ilean URL from selected facility or global config
  useEffect(() => {
    let url: string | null = null;
    
    // Try to find ilean URL from selected facility attributes
    if (selectedFacility) {
      const attrs = (selectedFacility as any).attributes || {};
      const ileanKey = Object.keys(attrs).find(k => 
        k.toLowerCase().includes('ilean')
      );
      if (ileanKey && attrs[ileanKey]?.value) {
        url = attrs[ileanKey].value;
      }
    }
    
    // If no URL from facility, try to get from global settings
    if (!url) {
      const savedConfigs = localStorage.getItem('appConfigs');
      if (savedConfigs) {
        const appConfigs = JSON.parse(savedConfigs);
        if (appConfigs.ilean?.url) {
          url = appConfigs.ilean.url;
        }
      }
    }
    
    // Fallback to Senslinc portal URL if available
    if (!url) {
      const savedConfigs = localStorage.getItem('appConfigs');
      if (savedConfigs) {
        const appConfigs = JSON.parse(savedConfigs);
        const senslincApiUrl = appConfigs.iot?.url;
        if (senslincApiUrl) {
          // Transform API URL to potential Ilean URL
          // e.g., https://api.swg-group.productinuse.com -> https://swg-group.productinuse.com/ilean
          const cleanUrl = senslincApiUrl.replace('/api', '').replace('api.', '');
          url = `${cleanUrl}/ilean`;
        }
      }
    }
    
    setIleanUrl(url);
  }, [selectedFacility]);

  // Drag handlers for panel
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
    
    // Get current button position (default to bottom-left)
    const currentX = triggerPosition?.x ?? 16;
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
    const buttonSize = 56;
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
      saveIleanSettings({ buttonPosition: triggerPosition });
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
      setIsLoading(true);
    }
    wasDraggedRef.current = false;
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const handleRefresh = () => {
    setIsLoading(true);
    if (iframeRef.current && ileanUrl) {
      iframeRef.current.src = ileanUrl;
    }
  };

  const handleOpenExternal = () => {
    if (ileanUrl) {
      window.open(ileanUrl, '_blank');
    }
  };

  // Calculate trigger button style (default to bottom-left, opposite from Gunnar)
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
          !triggerPosition && "bottom-20 left-4 sm:bottom-6"
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
                  "bg-gradient-to-br from-cyan-500 to-teal-600 hover:from-cyan-500/90 hover:to-teal-600/90",
                  "transition-all duration-300 hover:scale-105 hover:shadow-xl",
                  "sm:h-14 sm:w-14",
                  isOpen && "opacity-0 pointer-events-none",
                  isTriggerDragging && "cursor-grabbing scale-110"
                )}
              >
                <div className="relative">
                  <FileQuestion className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
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
          <TooltipContent side="right" className="font-medium">
            Öppna Ilean (dra för att flytta)
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Minimized bubble */}
      {isOpen && isMinimized && (
        <div 
          className="fixed bottom-20 left-4 z-[60] cursor-pointer sm:bottom-6"
          onClick={handleExpand}
        >
          <div className={cn(
            "bg-card/90 backdrop-blur-lg border rounded-full p-3 shadow-lg",
            "flex items-center gap-2 hover:bg-card transition-colors"
          )}>
            <FileQuestion className="h-5 w-5 text-cyan-500" />
            <span className="text-sm font-medium max-w-32 truncate">Ilean</span>
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
              "bg-gradient-to-r from-cyan-500/10 to-teal-500/10 cursor-grab",
              isDragging && "cursor-grabbing"
            )}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            <div className="flex items-center gap-2">
              <GripHorizontal className="h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-1.5">
                <FileQuestion className="h-4 w-4 text-cyan-500" />
                <span className="font-medium text-sm">Ilean AI</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-muted/50"
                    onClick={handleRefresh}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Uppdatera</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:bg-muted/50"
                    onClick={handleOpenExternal}
                    disabled={!ileanUrl}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Öppna i ny flik</TooltipContent>
              </Tooltip>
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

          {/* Content area */}
          <div className="flex-1 overflow-hidden relative">
            {isLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/50 z-10">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-500 mb-2" />
                <span className="text-sm text-muted-foreground">Laddar Ilean...</span>
              </div>
            )}
            
            {ileanUrl ? (
              <iframe
                ref={iframeRef}
                src={ileanUrl}
                className="w-full h-full border-0"
                title="Ilean AI Assistant"
                onLoad={handleIframeLoad}
                allow="microphone; camera"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <FileQuestion className="h-16 w-16 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">Ilean inte konfigurerad</h3>
                <p className="text-sm text-muted-foreground max-w-xs">
                  Ingen Ilean-URL hittades. Kontrollera att attributet "ileanUrl" är satt på objektet i Asset+, 
                  eller konfigurera en global Ilean-URL i inställningarna.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
