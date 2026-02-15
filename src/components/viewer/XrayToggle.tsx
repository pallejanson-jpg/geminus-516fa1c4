import React, { useState, useCallback } from "react";
import { Box } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface XrayToggleProps {
  viewerRef: React.MutableRefObject<any>;
}

/**
 * X-ray toggle for the 3D viewer.
 * Sets non-colorized scene objects to xrayed mode, preserving room visualization colors.
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
    const objectIds = scene.objectIds || [];

    if (enabled) {
      // Configure xray material for transparent ghosting (xeokit issue #175)
      const xrayMaterial = scene?.xrayMaterial;
      if (xrayMaterial) {
        xrayMaterial.fill = true;
        xrayMaterial.fillAlpha = 0.1;
        xrayMaterial.fillColor = [0.5, 0.5, 0.5];
        xrayMaterial.edges = true;
        xrayMaterial.edgeAlpha = 0.2;
        xrayMaterial.edgeColor = [0.3, 0.3, 0.3];
      }
      scene.alphaDepthMask = false;

      let count = 0;
      objectIds.forEach(id => {
        const entity = scene.objects?.[id];
        if (!entity) return;
        // Skip entities that are already colorized (from room visualization)
        const c = entity.colorize;
        if (c && (c[0] !== 1 || c[1] !== 1 || c[2] !== 1)) {
          return; // Don't xray colored rooms
        }
        entity.xrayed = true;
        count++;
      });
      console.log('[XrayToggle] xray ON, skipped colorized entities:', objectIds.length - count, 'xrayed:', count);
    } else {
      scene.setObjectsXRayed(objectIds, false);
      console.log('[XrayToggle] xray OFF');
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
