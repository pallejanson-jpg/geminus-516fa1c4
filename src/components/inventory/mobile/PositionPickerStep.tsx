import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Camera, MapPin, SkipForward, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import PositionPickerDialog from '@/components/inventory/PositionPickerDialog';
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
  const navigate = useNavigate();
  const [showPositionPicker, setShowPositionPicker] = useState(false);
  const [ivionSiteId, setIvionSiteId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check if building has Ivion 360 configured
  useEffect(() => {
    const checkIvionConfig = async () => {
      if (!formData.buildingFmGuid) {
        setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('building_settings')
          .select('ivion_site_id')
          .eq('fm_guid', formData.buildingFmGuid)
          .maybeSingle();

        if (!error && data?.ivion_site_id) {
          setIvionSiteId(data.ivion_site_id);
        }
      } catch (err) {
        console.error('Error checking Ivion config:', err);
      } finally {
        setIsLoading(false);
      }
    };

    checkIvionConfig();
  }, [formData.buildingFmGuid]);

  const handlePositionPicked = (coords: { x: number; y: number; z: number }) => {
    updateFormData({ coordinates: coords });
    onComplete();
  };

  const handleOpen360 = () => {
    if (ivionSiteId) {
      // Open Ivion in a new tab - user creates POI there and syncs later
      const ivionUrl = `https://swg.iv.navvis.com/?site=${ivionSiteId}`;
      window.open(ivionUrl, '_blank');
    }
  };

  // Navigate to fullscreen Ivion inventory mode
  const handleStartIvionInventory = () => {
    navigate(`/ivion-inventory?building=${formData.buildingFmGuid}`);
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
                <span className="font-medium">Position vald</span>
                <span className="text-muted-foreground ml-2">
                  ({formData.coordinates.x.toFixed(2)}, {formData.coordinates.y.toFixed(2)}, {formData.coordinates.z.toFixed(2)})
                </span>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Välj position (valfritt)</h2>
            <p className="text-sm text-muted-foreground">
              Markera var tillgången finns i 3D-modellen eller 360°-vyn. 
              Du kan hoppa över detta steg och lägga till position senare.
            </p>
          </div>

          {/* Position picker options */}
          <div className="space-y-3">
            {/* 3D Picker */}
            <Button
              variant="outline"
              className="w-full h-20 flex flex-col items-center justify-center gap-2 border-2"
              onClick={() => setShowPositionPicker(true)}
            >
              <Box className="h-8 w-8 text-primary" />
              <span className="text-base font-medium">Välj i 3D-modell</span>
            </Button>

            {/* 360° Inventory Mode - Recommended option */}
            {ivionSiteId && (
              <Button
                variant="default"
                className="w-full h-24 flex flex-col items-center justify-center gap-2 border-2"
                onClick={handleStartIvionInventory}
              >
                <Play className="h-8 w-8" />
                <span className="text-base font-medium">Starta inventering i 360°</span>
                <span className="text-xs opacity-80">Skapa POI → Registrera direkt</span>
              </Button>
            )}

            {/* Legacy 360° Option - open in new tab */}
            {ivionSiteId && (
              <Button
                variant="outline"
                className="w-full h-16 flex flex-col items-center justify-center gap-1 border"
                onClick={handleOpen360}
              >
                <Camera className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm">Öppna 360° i ny flik</span>
              </Button>
            )}
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
    </>
  );
};

export default PositionPickerStep;
