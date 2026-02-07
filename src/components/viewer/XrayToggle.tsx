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
    if (!xeokitViewer?.scene) {
      console.warn('[XrayToggle] Viewer not available');
      return;
    }

    const scene = xeokitViewer.scene;

    // Primary: batch API
    if (typeof scene.setObjectsXRayed === 'function') {
      const objectIds = scene.objectIds || [];
      scene.setObjectsXRayed(objectIds, enabled);
      console.log('[XrayToggle] setObjectsXRayed:', enabled, objectIds.length, 'objects');
    } else {
      // Fallback: iterate objects directly
      const objects = scene.objects || {};
      let count = 0;
      for (const id of Object.keys(objects)) {
        const entity = objects[id];
        if (entity && entity.isObject) {
          entity.xrayed = enabled;
          count++;
        }
      }
      console.log('[XrayToggle] Fallback xray on', count, 'entities');
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
