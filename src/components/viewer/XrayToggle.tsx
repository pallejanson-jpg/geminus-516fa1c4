import React, { useState, useCallback, useEffect } from "react";
import { Box } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface XrayToggleProps {
  viewerRef: React.MutableRefObject<any>;
  /** Initial enabled state (e.g. from Insights forceXray) */
  initialEnabled?: boolean;
}

const BATCH_SIZE = 100;

/**
 * X-ray toggle for the 3D viewer.
 * Sets non-colorized scene objects to xrayed mode, preserving room visualization colors.
 * Uses batched requestAnimationFrame for performance on large models.
 */
const XrayToggle: React.FC<XrayToggleProps> = ({ viewerRef, initialEnabled = false }) => {
  const [xrayEnabled, setXrayEnabled] = useState(initialEnabled);

  // Sync initial state when prop changes (e.g. Insights mode navigation)
  useEffect(() => {
    setXrayEnabled(initialEnabled);
  }, [initialEnabled]);

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
        xrayMaterial.fillAlpha = 0.15;
        xrayMaterial.fillColor = [0.55, 0.55, 0.6];
        xrayMaterial.edges = true;
        xrayMaterial.edgeAlpha = 0.35;
        xrayMaterial.edgeColor = [0.4, 0.4, 0.45];
      }
      scene.alphaDepthMask = false;

      // Only protect sensor-visualization-colored spaces, not architect-colored objects
      const vizGuids = (window as any).__vizColorizedEntityIds as Set<string> | undefined;

      const idsToXray: string[] = [];
      objectIds.forEach((id: string) => {
        const entity = scene.objects?.[id];
        if (!entity) return;
        // Skip entities that are currently colored by sensor visualization
        if (vizGuids?.has(id)) return;
        idsToXray.push(id);
      });

      let i = 0;
      const processBatch = () => {
        const end = Math.min(i + BATCH_SIZE, idsToXray.length);
        for (; i < end; i++) {
          const entity = scene.objects?.[idsToXray[i]];
          if (entity) {
            entity.xrayed = true;
            entity.pickable = false;
          }
        }
        if (i < idsToXray.length) requestAnimationFrame(processBatch);
      };
      requestAnimationFrame(processBatch);

      console.log('[XrayToggle] xray ON, protected viz entities:', vizGuids?.size ?? 0, 'xraying:', idsToXray.length);
    } else {
      // Batched OFF processing
      let i = 0;
      const ids = [...objectIds];
      const processBatchOff = () => {
        const end = Math.min(i + BATCH_SIZE, ids.length);
        for (; i < end; i++) {
          const entity = scene.objects?.[ids[i]];
          if (entity) {
            entity.xrayed = false;
            entity.pickable = true;
            if (entity.opacity < 1.0) entity.opacity = 1.0;
          }
        }
        if (i < ids.length) requestAnimationFrame(processBatchOff);
      };
      requestAnimationFrame(processBatchOff);

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
