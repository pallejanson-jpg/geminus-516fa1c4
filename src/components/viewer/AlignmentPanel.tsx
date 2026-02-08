/**
 * Alignment calibration panel for Virtual Twin mode.
 * 
 * Provides sliders for real-time adjustment of the Ivion-to-BIM transform
 * (offset X/Y/Z and rotation). Changes are applied live and can be saved
 * to the database per building.
 */

import React, { useState, useCallback } from 'react';
import { Save, RotateCcw, Move3D } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { IvionBimTransform } from '@/lib/ivion-bim-transform';

interface AlignmentPanelProps {
  /** Current transform values */
  transform: IvionBimTransform;
  /** Called when any value changes (live update) */
  onChange: (transform: IvionBimTransform) => void;
  /** Building FM GUID for saving */
  buildingFmGuid: string;
  /** Called after successful save */
  onSaved?: () => void;
}

const OFFSET_RANGE = 100;  // ±100m
const OFFSET_STEP = 0.01;
const ROTATION_STEP = 0.1;

const AlignmentPanel: React.FC<AlignmentPanelProps> = ({
  transform,
  onChange,
  buildingFmGuid,
  onSaved,
}) => {
  const [isSaving, setIsSaving] = useState(false);

  const updateField = useCallback(
    (field: keyof IvionBimTransform, value: number) => {
      onChange({ ...transform, [field]: value });
    },
    [transform, onChange]
  );

  const handleReset = useCallback(() => {
    onChange({ offsetX: 0, offsetY: 0, offsetZ: 0, rotation: 0 });
  }, [onChange]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('building_settings')
        .update({
          ivion_bim_offset_x: transform.offsetX,
          ivion_bim_offset_y: transform.offsetY,
          ivion_bim_offset_z: transform.offsetZ,
          ivion_bim_rotation: transform.rotation,
        })
        .eq('fm_guid', buildingFmGuid);

      if (error) throw error;

      toast.success('Alignment sparad');
      onSaved?.();
    } catch (err: any) {
      console.error('Failed to save alignment:', err);
      toast.error('Kunde inte spara alignment', { description: err.message });
    } finally {
      setIsSaving(false);
    }
  }, [transform, buildingFmGuid, onSaved]);

  return (
    <div className="w-72 bg-background/90 backdrop-blur-md border border-border rounded-lg shadow-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Move3D className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Alignment</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleReset} title="Återställ">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="default"
            size="icon"
            className="h-7 w-7"
            onClick={handleSave}
            disabled={isSaving}
            title="Spara"
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Offset X */}
      <SliderField
        label="Offset X"
        value={transform.offsetX}
        min={-OFFSET_RANGE}
        max={OFFSET_RANGE}
        step={OFFSET_STEP}
        unit="m"
        onChange={(v) => updateField('offsetX', v)}
      />

      {/* Offset Y */}
      <SliderField
        label="Offset Y"
        value={transform.offsetY}
        min={-OFFSET_RANGE}
        max={OFFSET_RANGE}
        step={OFFSET_STEP}
        unit="m"
        onChange={(v) => updateField('offsetY', v)}
      />

      {/* Offset Z */}
      <SliderField
        label="Offset Z"
        value={transform.offsetZ}
        min={-OFFSET_RANGE}
        max={OFFSET_RANGE}
        step={OFFSET_STEP}
        unit="m"
        onChange={(v) => updateField('offsetZ', v)}
      />

      {/* Rotation */}
      <SliderField
        label="Rotation"
        value={transform.rotation}
        min={-180}
        max={180}
        step={ROTATION_STEP}
        unit="°"
        onChange={(v) => updateField('rotation', v)}
      />
    </div>
  );
};

/** Reusable slider + numeric input field */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={value}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
            }}
            step={step}
            className="h-6 w-20 text-xs text-right px-1.5"
          />
          <span className="text-xs text-muted-foreground w-4">{unit}</span>
        </div>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="py-0"
      />
    </div>
  );
}

export default AlignmentPanel;
