import React, { useState, useEffect } from 'react';
import { Box, Camera, MapPin, SkipForward, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import PositionPickerDialog from '@/components/inventory/PositionPickerDialog';
import Ivion360PositionPicker from './Ivion360PositionPicker';
import type { WizardFormData } from './MobileInventoryWizard';

interface PositionPickerStepProps {
  formData: WizardFormData;
  updateFormData: (updates: Partial<WizardFormData>) => void;
  onComplete: () => void;
  onSkip: () => void;
}

const PositionPickerStep: React.FC<PositionPickerStepProps> = ({
  formData,
  updateFormData,
  onComplete,
  onSkip,
}) => {
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [show360Picker, setShow360Picker] = useState(false);
  const [ivionSiteId, setIvionSiteId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check building capabilities: Ivion 360
  useEffect(() => {
    const checkConfig = async () => {
      if (!formData.buildingFmGuid) {
        setIsLoading(false);
        return;
      }

      try {
        const settingsResult = await supabase
          .from('building_settings')
          .select('ivion_site_id')
          .eq('fm_guid', formData.buildingFmGuid)
          .maybeSingle();

        if (!settingsResult.error && settingsResult.data?.ivion_site_id) {
          setIvionSiteId(settingsResult.data.ivion_site_id);
        }
      } catch (err) {
        console.error('Error checking config:', err);
      } finally {
        setIsLoading(false);
      }
    };

    checkConfig();
  }, [formData.buildingFmGuid]);

  const handlePositionPicked = (coords: { x: number; y: number; z: number }) => {
    updateFormData({ coordinates: coords });
    onComplete();
  };

  const handle360PositionPicked = (result: {
    coordinates: { x: number; y: number; z: number };
    ivionPoiId: number;
    ivionImageId: number;
    fmGuid: string;
  }) => {
    updateFormData({
      coordinates: result.coordinates,
      ivionPoiId: result.ivionPoiId,
      ivionImageId: result.ivionImageId,
      fmGuid: result.fmGuid,
      ivionSiteId: ivionSiteId || undefined,
    });
    onComplete();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="p-4 space-y-6">
          {/* Location summary */}
          <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
            <span className="font-medium">{formData.categoryLabel}</span>
            <span className="mx-2">•</span>
            <span>{formData.buildingName}</span>
            {formData.levelName && <span> → {formData.levelName}</span>}
            {formData.roomName && <span> → {formData.roomName}</span>}
          </div>

          {/* Current position status */}
          {formData.coordinates && (
            <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <MapPin className="h-5 w-5 text-primary" />
              <div className="text-sm">
                <span className="font-medium">Position selected</span>
                <span className="text-muted-foreground ml-2">
                  ({formData.coordinates.x.toFixed(2)}, {formData.coordinates.y.toFixed(2)}, {formData.coordinates.z.toFixed(2)})
                </span>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Select position (optional)</h2>
            <p className="text-sm text-muted-foreground">
              Mark where the asset is located in the 3D model or 360° view. 
              You can skip this step and add a position later.
            </p>
          </div>

          {/* Position picker options */}
          <div className="space-y-3">
            {/* 360° Picker — primary option */}
            {ivionSiteId && (
              <Button
                variant="default"
                className="w-full h-24 flex flex-col items-center justify-center gap-2 border-2"
                onClick={() => setShow360Picker(true)}
              >
                <Camera className="h-8 w-8" />
                <span className="text-base font-medium">Select in 360° view</span>
                <span className="text-xs opacity-80">Navigate → Confirm position</span>
              </Button>
            )}

            {/* 3D Picker */}
            <Button
              variant="outline"
              className="w-full h-20 flex flex-col items-center justify-center gap-2 border-2"
              onClick={() => setShowPositionPicker(true)}
            >
              <Box className="h-8 w-8 text-primary" />
              <span className="text-base font-medium">Select in 3D model</span>
            </Button>
          </div>

          {/* Skip option */}
          <Button
            variant="ghost"
            className="w-full h-14 text-muted-foreground"
            onClick={onSkip}
          >
            <SkipForward className="h-4 w-4 mr-2" />
            Hoppa över - lägg till position senare
          </Button>
        </div>
      </ScrollArea>

      {/* 3D Position Picker Dialog */}
      <PositionPickerDialog
        open={showPositionPicker}
        onOpenChange={setShowPositionPicker}
        buildingFmGuid={formData.buildingFmGuid}
        roomFmGuid={formData.roomFmGuid}
        onPositionPicked={handlePositionPicked}
      />

      {/* 360° Position Picker */}
      {ivionSiteId && (
        <Ivion360PositionPicker
          open={show360Picker}
          onOpenChange={setShow360Picker}
          ivionSiteId={ivionSiteId}
          buildingFmGuid={formData.buildingFmGuid}
          formData={formData}
          onPositionPicked={handle360PositionPicked}
        />
      )}
    </>
  );
};

export default PositionPickerStep;
