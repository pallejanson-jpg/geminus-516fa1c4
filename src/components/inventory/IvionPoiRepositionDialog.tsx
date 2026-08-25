import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Check, X, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useIvionSdk } from '@/hooks/useIvionSdk';
import { resolveMainView } from '@/lib/ivion-sdk';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';

interface IvionPoiRepositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ivionSiteId: string;
  buildingFmGuid: string;
  /** The asset row id (Supabase primary key) whose position is being confirmed */
  assetId: string;
  /** Existing Ivion POI id to update in place */
  ivionPoiId: number;
  /** Display name shown in the header, e.g. the asset name */
  displayName: string;
  onConfirmed: (result: { coordinates: { x: number; y: number; z: number }; ivionImageId: number }) => void;
}

/**
 * Desktop "drag this POI into place" flow for assets that were auto-placed
 * near a cluster anchor. The Ivion SDK has no native marker-drag primitive,
 * so — same as the mobile Ivion360PositionPicker — the user navigates the
 * embedded 360° view to the right spot and confirms, and we update the
 * existing POI's position instead of creating a new one.
 */
const IvionPoiRepositionDialog: React.FC<IvionPoiRepositionDialogProps> = ({
  open,
  onOpenChange,
  ivionSiteId,
  buildingFmGuid,
  assetId,
  ivionPoiId,
  displayName,
  onConfirmed,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pendingPosition, setPendingPosition] = useState<{
    coords: { x: number; y: number; z: number };
    imageId: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { sdkStatus, ivApiRef, retry, errorMessage } = useIvionSdk({
    baseUrl: IVION_DEFAULT_BASE_URL,
    siteId: ivionSiteId,
    buildingFmGuid,
    containerRef,
    enabled: open,
  });

  useEffect(() => {
    if (!open) setPendingPosition(null);
  }, [open]);

  useEffect(() => {
    if (sdkStatus !== 'ready' || !ivApiRef.current) return;

    const api = ivApiRef.current;
    const mainView = resolveMainView(api);
    if (!mainView) return;

    const updatePosition = () => {
      const image = mainView.getImage();
      if (image) {
        setPendingPosition({
          coords: { x: image.location.x, y: image.location.y, z: image.location.z },
          imageId: image.id,
        });
      }
    };

    updatePosition();

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

    setIsSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'update-poi',
          siteId: ivionSiteId,
          poiId: ivionPoiId,
          poiData: {
            scsLocation: {
              type: 'Point',
              coordinates: [pendingPosition.coords.x, pendingPosition.coords.y, pendingPosition.coords.z],
            },
            pointOfView: {
              imageId: pendingPosition.imageId,
              location: pendingPosition.coords,
              orientation: { x: 0, y: 0, z: 0, w: 1 },
              fov: 90,
            },
          },
        },
      });

      if (error) throw new Error(error.message || 'Could not update POI');

      const { error: assetError } = await supabase
        .from('assets')
        .update({
          coordinate_x: pendingPosition.coords.x,
          coordinate_y: pendingPosition.coords.y,
          coordinate_z: pendingPosition.coords.z,
          ivion_image_id: pendingPosition.imageId,
          ivion_poi_confirmed_at: new Date().toISOString(),
        })
        .eq('id', assetId);

      if (assetError) throw assetError;

      toast.success('Position confirmed');
      onConfirmed({ coordinates: pendingPosition.coords, ivionImageId: pendingPosition.imageId });
      onOpenChange(false);
    } catch (err: any) {
      console.error('[IvionPoiRepositionDialog] Update POI error:', err);
      toast.error('Could not save position', { description: err.message });
    } finally {
      setIsSaving(false);
    }
  }, [pendingPosition, ivionSiteId, ivionPoiId, assetId, onConfirmed, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full h-[85vh] p-0 gap-0 [&>button]:hidden">
        <div className="relative w-full h-full flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-background/90 backdrop-blur border-b z-10">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm font-medium truncate">Move "{displayName}" into place</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div ref={containerRef} className="flex-1 relative bg-black" />

          {sdkStatus === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Loading 360° view...</span>
              </div>
            </div>
          )}

          {sdkStatus === 'failed' && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <span className="text-sm text-destructive">{errorMessage || 'Could not load 360° view'}</span>
                <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
              </div>
            </div>
          )}

          {sdkStatus === 'ready' && (
            <div className="absolute bottom-0 left-0 right-0 z-10">
              {!pendingPosition ? (
                <div className="bg-background/90 backdrop-blur px-4 py-3 text-center">
                  <span className="text-sm text-muted-foreground">Navigate to the right location...</span>
                </div>
              ) : (
                <div className="bg-background/95 backdrop-blur border-t px-4 py-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-muted-foreground truncate">
                    Image #{pendingPosition.imageId} — ({pendingPosition.coords.x.toFixed(1)}, {pendingPosition.coords.y.toFixed(1)}, {pendingPosition.coords.z.toFixed(1)})
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" onClick={handleConfirm} disabled={isSaving} className="gap-1.5">
                      {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Confirm position
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

export default IvionPoiRepositionDialog;
