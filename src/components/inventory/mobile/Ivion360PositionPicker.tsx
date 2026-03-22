import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Check, X, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useIvionSdk } from '@/hooks/useIvionSdk';
import { resolveMainView } from '@/lib/ivion-sdk';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';
import type { WizardFormData } from './MobileInventoryWizard';

interface Ivion360PositionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ivionSiteId: string;
  buildingFmGuid: string;
  formData: WizardFormData;
  onPositionPicked: (result: {
    coordinates: { x: number; y: number; z: number };
    ivionPoiId: number;
    ivionImageId: number;
    fmGuid: string;
  }) => void;
}

const Ivion360PositionPicker: React.FC<Ivion360PositionPickerProps> = ({
  open,
  onOpenChange,
  ivionSiteId,
  buildingFmGuid,
  formData,
  onPositionPicked,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pendingPosition, setPendingPosition] = useState<{
    coords: { x: number; y: number; z: number };
    imageId: number;
  } | null>(null);
  const [isCreatingPoi, setIsCreatingPoi] = useState(false);

  const { sdkStatus, ivApiRef, retry, errorMessage } = useIvionSdk({
    baseUrl: IVION_DEFAULT_BASE_URL,
    siteId: ivionSiteId,
    buildingFmGuid,
    containerRef,
    enabled: open,
  });

  // Listen for clicks on the 360° view to capture position
  useEffect(() => {
    if (sdkStatus !== 'ready' || !ivApiRef.current) return;

    const api = ivApiRef.current;
    const mainView = resolveMainView(api);
    if (!mainView) return;

    // Use pov.onChange to detect when user navigates to a new image
    // The actual "pick position" is triggered by the user tapping the confirm area
    // We track current image position continuously
    const updatePosition = () => {
      const image = mainView.getImage();
      if (image) {
        setPendingPosition({
          coords: {
            x: image.location.x,
            y: image.location.y,
            z: image.location.z,
          },
          imageId: image.id,
        });
      }
    };

    // Initial position
    updatePosition();

    // Subscribe to view changes
    let unsub: (() => void) | void;
    if (api.pov?.onChange) {
      unsub = api.pov.onChange(updatePosition);
    }

    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [sdkStatus, ivApiRef]);

  const handleConfirm = useCallback(async () => {
    if (!pendingPosition) return;

    setIsCreatingPoi(true);
    try {
      const fmGuid = crypto.randomUUID();
      const displayName = formData.name || formData.categoryLabel || 'New asset';

      // Build custom data with all AI info
      const customData: Record<string, any> = {
        fm_guid: fmGuid,
        asset_type: formData.category || null,
        source: 'geminus',
      };
      if (formData.aiProperties) {
        customData.ai_properties = formData.aiProperties;
      }

      const poiData = {
        titles: { sv: displayName },
        descriptions: { sv: formData.description || '' },
        scsLocation: {
          type: 'Point',
          coordinates: [
            pendingPosition.coords.x,
            pendingPosition.coords.y,
            pendingPosition.coords.z,
          ],
        },
        scsOrientation: { x: 0, y: 0, z: 0, w: 1 },
        security: { groupRead: 0, groupWrite: 0 },
        visibilityCheck: false,
        importance: 1,
        pointOfView: {
          imageId: pendingPosition.imageId,
          location: pendingPosition.coords,
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          fov: 90,
        },
        customData: JSON.stringify(customData),
      };

      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'create-poi',
          siteId: ivionSiteId,
          poiData,
        },
      });

      if (error || !data?.id) {
        throw new Error(error?.message || data?.error || 'Could not create POI');
      }

      toast.success('Position saved in 360°');
      onPositionPicked({
        coordinates: pendingPosition.coords,
        ivionPoiId: data.id,
        ivionImageId: pendingPosition.imageId,
        fmGuid,
      });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[Ivion360Picker] Create POI error:', err);
      toast.error('Kunde inte spara position', { description: err.message });
    } finally {
      setIsCreatingPoi(false);
    }
  }, [pendingPosition, formData, ivionSiteId, onPositionPicked, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[100vw] w-full h-[100dvh] p-0 gap-0 [&>button]:hidden">
        <div className="relative w-full h-full flex flex-col">
          {/* Compact header */}
          <div className="flex items-center justify-between px-3 py-2 bg-background/90 backdrop-blur border-b z-10">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate">Välj position i 360°</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Ivion container */}
          <div ref={containerRef} className="flex-1 relative bg-black" />

          {/* Loading overlay */}
          {sdkStatus === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Laddar 360°-vy...</span>
              </div>
            </div>
          )}

          {/* Error */}
          {sdkStatus === 'failed' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <span className="text-sm text-destructive">{errorMessage || 'Kunde inte ladda 360°-vyn'}</span>
                <Button variant="outline" size="sm" onClick={retry}>Försök igen</Button>
              </div>
            </div>
          )}

          {/* Instruction + confirm bar */}
          {sdkStatus === 'ready' && (
            <div className="absolute bottom-0 left-0 right-0 z-10">
              {!pendingPosition ? (
                <div className="bg-background/90 backdrop-blur px-4 py-3 text-center">
                  <span className="text-sm text-muted-foreground">Navigera till rätt plats...</span>
                </div>
              ) : (
                <div className="bg-background/95 backdrop-blur border-t px-4 py-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground truncate">
                    Bild #{pendingPosition.imageId} — ({pendingPosition.coords.x.toFixed(1)}, {pendingPosition.coords.y.toFixed(1)}, {pendingPosition.coords.z.toFixed(1)})
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      onClick={handleConfirm}
                      disabled={isCreatingPoi}
                      className="gap-1.5"
                    >
                      {isCreatingPoi ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Bekräfta
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Ivion360PositionPicker;
