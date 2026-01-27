import React, { useCallback, useState } from "react";
import { Layers, MessageSquare, MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface VisualizationToolbarProps {
  viewerRef: React.MutableRefObject<any>;
  onToggleNavCube?: (visible: boolean) => void;
  onToggleMinimap?: (visible: boolean) => void;
  onToggleTreeView?: (visible: boolean) => void;
  onToggleVisualization?: (visible: boolean) => void;
  onPickCoordinate?: () => void;
  onShowProperties?: () => void;
  onOpenSettings?: () => void;
  isPickMode?: boolean;
  showTreeView?: boolean;
  showVisualization?: boolean;
  showNavCube?: boolean;
  showMinimap?: boolean;
  className?: string;
  inline?: boolean;
}

/**
 * Minimal VisualizationToolbar: only "Visa rum" and "Visa annotationer".
 */
const VisualizationToolbar: React.FC<VisualizationToolbarProps> = (props) => {
  const { viewerRef, className, inline = false } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [showSpaces, setShowSpaces] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);

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

  const containerClassName = cn(
    inline ? "" : "absolute top-4 right-4 z-20",
    className
  );

  return (
    <div className={containerClassName}>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className={cn(
                    "shadow-lg bg-card/95 backdrop-blur-sm border",
                    "h-8 w-8 sm:h-10 sm:w-10"
                  )}
                >
                  <MoreVertical className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">Visning</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </SheetTrigger>

        <SheetContent side="right" className="w-80 sm:w-96 p-0 bg-card/95 backdrop-blur-sm z-[60]">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle className="text-base">Visning</SheetTitle>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-80px)]">
            <div className="p-4 pt-0 space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">
                  Visa
                </Label>

                <div className="space-y-1">
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
                </div>
              </div>
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default VisualizationToolbar;
