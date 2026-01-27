import React, { useCallback, useState, useEffect } from "react";
import { Layers, MessageSquare, MoreVertical, Palette, Plus, GripVertical, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { getVisualizationToolSettings, ToolConfig, TOOLBAR_SETTINGS_CHANGED_EVENT } from "./ToolbarSettings";
import FloorVisibilitySelector from "./FloorVisibilitySelector";

interface VisualizationToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onToggleNavCube?: (visible: boolean) => void;
  onToggleMinimap?: (visible: boolean) => void;
  onToggleTreeView?: (visible: boolean) => void;
  onToggleVisualization?: (visible: boolean) => void;
  onAddAsset?: () => void;
  onPickCoordinate?: () => void;
  onShowProperties?: () => void;
  onOpenSettings?: () => void;
  onVisibleFloorsChange?: (visibleFloorIds: string[]) => void;
  isPickMode?: boolean;
  showTreeView?: boolean;
  showVisualization?: boolean;
  showNavCube?: boolean;
  showMinimap?: boolean;
  className?: string;
  inline?: boolean;
}

/**
 * VisualizationToolbar with configurable tools based on ToolbarSettings.
 * Renders as a floating, draggable panel when opened.
 * Includes floor visibility selector with multi-select switches.
 */
const VisualizationToolbar: React.FC<VisualizationToolbarProps> = (props) => {
  const { 
    viewerRef, 
    className, 
    inline = false,
    onToggleVisualization,
    showVisualization = false,
    onAddAsset,
    onVisibleFloorsChange,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [showSpaces, setShowSpaces] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [toolSettings, setToolSettings] = useState<ToolConfig[]>(getVisualizationToolSettings());
  
  // Draggable panel state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Initialize position when panel opens
  useEffect(() => {
    if (isOpen && position.x === 0 && position.y === 0) {
      // Position to the left of the trigger button (top-right area)
      const initialX = typeof window !== 'undefined' ? window.innerWidth - 340 : 200;
      setPosition({ x: initialX, y: 60 });
    }
  }, [isOpen, position.x, position.y]);

  // Reload settings when they change
  useEffect(() => {
    const handleSettingsChange = () => {
      setToolSettings(getVisualizationToolSettings());
    };
    window.addEventListener('storage', handleSettingsChange);
    window.addEventListener(TOOLBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    return () => {
      window.removeEventListener('storage', handleSettingsChange);
      window.removeEventListener(TOOLBAR_SETTINGS_CHANGED_EVENT, handleSettingsChange);
    };
  }, []);

  // Tool visibility check
  const isToolVisible = useCallback((toolId: string) => {
    const setting = toolSettings.find(t => t.id === toolId);
    return setting?.visible ?? true;
  }, [toolSettings]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, [role="switch"]')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 280, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleToggleSpaces = useCallback(() => {
    const newValue = !showSpaces;
    setShowSpaces(newValue);
    try {
      const assetViewer = viewerRef.current?.assetViewer;
      assetViewer?.onShowSpacesChanged?.(newValue);
    } catch (e) {
      console.debug("Toggle spaces failed:", e);
    }
  }, [viewerRef, showSpaces]);

  const handleToggleAnnotations = useCallback(() => {
    const newValue = !showAnnotations;
    setShowAnnotations(newValue);
    try {
      const assetViewer = viewerRef.current?.assetViewer;
      assetViewer?.onToggleAnnotation?.(newValue);
    } catch (e) {
      console.debug("Toggle annotations failed:", e);
    }
  }, [viewerRef, showAnnotations]);

  const handleToggleVisualization = useCallback(() => {
    onToggleVisualization?.(!showVisualization);
  }, [onToggleVisualization, showVisualization]);

  const handleAddAsset = useCallback(() => {
    setIsOpen(false);
    onAddAsset?.();
  }, [onAddAsset]);

  // Handle visible floors change from floor selector
  const handleVisibleFloorsChange = useCallback((visibleFloorIds: string[]) => {
    console.log("Visible floors changed:", visibleFloorIds);
    onVisibleFloorsChange?.(visibleFloorIds);
  }, [onVisibleFloorsChange]);

  const containerClassName = cn(
    inline ? "" : "absolute top-4 right-4 z-20",
    className
  );

  return (
    <div className={containerClassName}>
      {/* Trigger button */}
      <Button
        variant="secondary"
        size="icon"
        title="Visning"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "shadow-lg bg-card/95 backdrop-blur-sm border",
          "h-8 w-8 sm:h-10 sm:w-10",
          isOpen && "ring-2 ring-primary"
        )}
      >
        <MoreVertical className="h-4 w-4 sm:h-5 sm:w-5" />
      </Button>

      {/* Floating draggable panel */}
      {isOpen && (
        <div
          className={cn(
            "fixed z-[60] bg-card/95 backdrop-blur-sm border rounded-lg shadow-xl",
            "w-72 max-h-[500px] flex flex-col",
            isDragging && "cursor-grabbing opacity-90"
          )}
          style={{ left: position.x, top: position.y }}
        >
          {/* Header - Draggable */}
          <div
            className="flex items-center justify-between p-3 border-b cursor-grab select-none"
            onMouseDown={handleMouseDown}
          >
            <div className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">Visning</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-4">
              {/* Floor visibility section - NEW */}
              <FloorVisibilitySelector
                viewerRef={viewerRef}
                onVisibleFloorsChange={handleVisibleFloorsChange}
              />

              <Separator />

              {/* Visibility section */}
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                  Visa
                </Label>

                <div className="space-y-1">
                  {isToolVisible('spaces') && (
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "p-1.5 rounded-md",
                            showSpaces
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Layers className="h-4 w-4" />
                        </div>
                        <span className="text-sm">Visa rum</span>
                      </div>
                      <Switch checked={showSpaces} onCheckedChange={handleToggleSpaces} />
                    </div>
                  )}

                  {isToolVisible('annotations') && (
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "p-1.5 rounded-md",
                            showAnnotations
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <span className="text-sm">Visa annotationer</span>
                      </div>
                      <Switch checked={showAnnotations} onCheckedChange={handleToggleAnnotations} />
                    </div>
                  )}

                  {isToolVisible('visualization') && onToggleVisualization && (
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "p-1.5 rounded-md",
                            showVisualization
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Palette className="h-4 w-4" />
                        </div>
                        <span className="text-sm">Rumsvisualisering</span>
                      </div>
                      <Switch checked={showVisualization} onCheckedChange={handleToggleVisualization} />
                    </div>
                  )}
                </div>
              </div>

              {/* Actions section */}
              {isToolVisible('addAsset') && onAddAsset && (
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                    Åtgärder
                  </Label>

                  <div className="space-y-1">
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-3"
                      onClick={handleAddAsset}
                    >
                      <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                        <Plus className="h-4 w-4" />
                      </div>
                      <span className="text-sm">Registrera tillgång</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
};

export default VisualizationToolbar;
