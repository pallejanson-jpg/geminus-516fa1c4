import React, { useState, useCallback } from "react";
import { Box } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface XrayToggleProps {
  viewerRef: React.MutableRefObject<any>;
}

/**
 * X-ray toggle for the 3D viewer.
 * Sets all scene objects to xrayed mode, making them semi-transparent.
 */
const XrayToggle: React.FC<XrayToggleProps> = ({ viewerRef }) => {
  const [xrayEnabled, setXrayEnabled] = useState(false);

  const handleToggleXray = useCallback((enabled: boolean) => {
    setXrayEnabled(enabled);
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (xeokitViewer?.scene) {
      const objectIds = xeokitViewer.scene.objectIds || [];
      console.log('[XrayToggle] Setting X-ray:', enabled, 'on', objectIds.length, 'objects');
      xeokitViewer.scene.setObjectsXRayed(objectIds, enabled);
    } else {
      console.warn('[XrayToggle] xeokit viewer not available');
    }
  }, [viewerRef]);

  return (
    <div className="flex items-center justify-between py-1.5 sm:py-2">
      <div className="flex items-center gap-2 sm:gap-3">
        <div
          className={cn(
            "p-1 sm:p-1.5 rounded-md",
            xrayEnabled
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
        <span className="text-xs sm:text-sm">X-ray</span>
      </div>
      <Switch checked={xrayEnabled} onCheckedChange={handleToggleXray} />
    </div>
  );
};

export default XrayToggle;
