/**
 * Alignment calibration panel for Virtual Twin mode.
 * 
 * Provides coarse + fine sliders for real-time adjustment of the Ivion-to-BIM
 * transform (offset X/Y/Z and rotation). Changes are applied live and can be
 * saved to the database per building.
 */

import React, { useState, useCallback } from 'react';
import { Save, RotateCcw, Move3D, ChevronDown, ChevronUp, Minus, Plus, Info, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { IvionBimTransform } from '@/lib/ivion-bim-transform';
import AlignmentPointPicker from './AlignmentPointPicker';

interface AlignmentPanelProps {
  /** Current transform values */
  transform: IvionBimTransform;
  /** Called when any value changes (live update) */
  onChange: (transform: IvionBimTransform) => void;
  /** Building FM GUID for saving */
  buildingFmGuid: string;
  /** Called after successful save */
  onSaved?: () => void;
  /** Whether crosshair is shown (controlled by parent) */
  showCrosshair?: boolean;
  /** Toggle crosshair overlay */
  onToggleCrosshair?: (show: boolean) => void;
  /** Ivion API ref for point-picking (optional, only in split mode) */
  ivApiRef?: React.MutableRefObject<any>;
  /** Whether point-picking is available (split mode with SDK ready) */
  canPointPick?: boolean;
}

const COARSE_OFFSET_RANGE = 100; // ±100m
const COARSE_OFFSET_STEP = 0.1;
const FINE_OFFSET_RANGE = 2;    // ±2m
const FINE_OFFSET_STEP = 0.01;
const NUDGE_OFFSET = 0.05;      // m
const NUDGE_ROTATION = 0.5;     // °

const AlignmentPanel: React.FC<AlignmentPanelProps> = ({
  transform,
  onChange,
  buildingFmGuid,
  onSaved,
  showCrosshair,
  onToggleCrosshair,
  ivApiRef,
  canPointPick,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [fineOpen, setFineOpen] = useState(false);
  const [showPointPicker, setShowPointPicker] = useState(false);

  const updateField = useCallback(
    (field: keyof IvionBimTransform, value: number) => {
      onChange({ ...transform, [field]: value });
    },
    [transform, onChange]
  );

  const nudge = useCallback(
    (field: keyof IvionBimTransform, delta: number) => {
      const current = transform[field];
      onChange({ ...transform, [field]: parseFloat((current + delta).toFixed(4)) });
    },
    [transform, onChange]
  );

  const handleReset = useCallback(() => {
    onChange({ offsetX: 0, offsetY: 0, offsetZ: 0, rotation: 0 });
  }, [onChange]);

  const handlePointPickOffsets = useCallback((offsets: { offsetX: number; offsetY: number; offsetZ: number }) => {
    onChange({ ...transform, ...offsets });
    setShowPointPicker(false);
  }, [transform, onChange]);

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
    <div className="w-80 bg-background/90 backdrop-blur-md border border-border rounded-lg shadow-lg p-4 space-y-3">
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

      {/* Help text */}
      <div className="flex gap-2 bg-muted/50 rounded-md p-2.5">
        <Info className="h-3.5 w-3.5 text-foreground/70 shrink-0 mt-0.5" />
        <p className="text-[11px] text-foreground/70 leading-relaxed">
          Navigera i 360° till en plats med tydliga element (dörr, vägg, pelare). 
          Justera värdena tills 3D-modellen överlappar panoramabilden.
        </p>
      </div>

      {/* Point-pick button (split mode only) */}
      {canPointPick && ivApiRef && !showPointPicker && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs gap-1.5"
          onClick={() => setShowPointPicker(true)}
        >
          <Crosshair className="h-3 w-3" />
          Punktkalibrering (360° → 3D)
        </Button>
      )}

      {/* Point picker UI */}
      {showPointPicker && ivApiRef && (
        <AlignmentPointPicker
          transform={transform}
          ivApiRef={ivApiRef}
          onOffsetsCalculated={handlePointPickOffsets}
          onClose={() => setShowPointPicker(false)}
        />
      )}

      {/* Coarse sliders */}
      <div className="space-y-2.5">
        <CoarseSliderField
          label="Offset X"
          value={transform.offsetX}
          min={-COARSE_OFFSET_RANGE}
          max={COARSE_OFFSET_RANGE}
          step={COARSE_OFFSET_STEP}
          unit="m"
          nudgeStep={NUDGE_OFFSET}
          onChange={(v) => updateField('offsetX', v)}
          onNudge={(d) => nudge('offsetX', d)}
        />
        <CoarseSliderField
          label="Offset Y"
          value={transform.offsetY}
          min={-COARSE_OFFSET_RANGE}
          max={COARSE_OFFSET_RANGE}
          step={COARSE_OFFSET_STEP}
          unit="m"
          nudgeStep={NUDGE_OFFSET}
          onChange={(v) => updateField('offsetY', v)}
          onNudge={(d) => nudge('offsetY', d)}
        />
        <CoarseSliderField
          label="Offset Z"
          value={transform.offsetZ}
          min={-COARSE_OFFSET_RANGE}
          max={COARSE_OFFSET_RANGE}
          step={COARSE_OFFSET_STEP}
          unit="m"
          nudgeStep={NUDGE_OFFSET}
          onChange={(v) => updateField('offsetZ', v)}
          onNudge={(d) => nudge('offsetZ', d)}
        />
        <CoarseSliderField
          label="Rotation"
          value={transform.rotation}
          min={-180}
          max={180}
          step={0.5}
          unit="°"
          nudgeStep={NUDGE_ROTATION}
          onChange={(v) => updateField('rotation', v)}
          onNudge={(d) => nudge('rotation', d)}
        />
      </div>

      {/* Fine-tuning section */}
      <Collapsible open={fineOpen} onOpenChange={setFineOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between h-7 text-xs text-muted-foreground hover:text-foreground px-1">
            Finjustera
            {fineOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2.5 pt-2">
          <FineSliderField
            label="Fine X"
            value={transform.offsetX}
            min={transform.offsetX - FINE_OFFSET_RANGE}
            max={transform.offsetX + FINE_OFFSET_RANGE}
            step={FINE_OFFSET_STEP}
            unit="m"
            nudgeStep={FINE_OFFSET_STEP}
            onChange={(v) => updateField('offsetX', v)}
            onNudge={(d) => nudge('offsetX', d)}
          />
          <FineSliderField
            label="Fine Y"
            value={transform.offsetY}
            min={transform.offsetY - FINE_OFFSET_RANGE}
            max={transform.offsetY + FINE_OFFSET_RANGE}
            step={FINE_OFFSET_STEP}
            unit="m"
            nudgeStep={FINE_OFFSET_STEP}
            onChange={(v) => updateField('offsetY', v)}
            onNudge={(d) => nudge('offsetY', d)}
          />
          <FineSliderField
            label="Fine Z"
            value={transform.offsetZ}
            min={transform.offsetZ - FINE_OFFSET_RANGE}
            max={transform.offsetZ + FINE_OFFSET_RANGE}
            step={FINE_OFFSET_STEP}
            unit="m"
            nudgeStep={FINE_OFFSET_STEP}
            onChange={(v) => updateField('offsetZ', v)}
            onNudge={(d) => nudge('offsetZ', d)}
          />
          <FineSliderField
            label="Fine Rot"
            value={transform.rotation}
            min={transform.rotation - 10}
            max={transform.rotation + 10}
            step={0.1}
            unit="°"
            nudgeStep={0.1}
            onChange={(v) => updateField('rotation', v)}
            onNudge={(d) => nudge('rotation', d)}
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Crosshair toggle */}
      {onToggleCrosshair && (
        <label className="flex items-center gap-2 cursor-pointer select-none px-1">
          <input
            type="checkbox"
            checked={showCrosshair ?? false}
            onChange={(e) => onToggleCrosshair(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-xs text-foreground/70">Visa korsmarkering</span>
        </label>
      )}
    </div>
  );
};

/** Coarse slider with nudge buttons */
function CoarseSliderField({
  label, value, min, max, step, unit, nudgeStep, onChange, onNudge,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  nudgeStep: number;
  onChange: (v: number) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-foreground/70">{label}</Label>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost" size="icon"
            className="h-5 w-5"
            onClick={() => onNudge(-nudgeStep)}
            title={`-${nudgeStep}${unit}`}
          >
            <Minus className="h-3 w-3" />
          </Button>
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
          <Button
            variant="ghost" size="icon"
            className="h-5 w-5"
            onClick={() => onNudge(nudgeStep)}
            title={`+${nudgeStep}${unit}`}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <span className="text-xs text-foreground/70 w-4">{unit}</span>
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

/** Fine-tuning slider with tight range centered on current value */
function FineSliderField({
  label, value, min, max, step, unit, nudgeStep, onChange, onNudge,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  nudgeStep: number;
  onChange: (v: number) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-foreground/70">{label}</Label>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost" size="icon"
            className="h-5 w-5"
            onClick={() => onNudge(-nudgeStep)}
            title={`-${nudgeStep}${unit}`}
          >
            <Minus className="h-2.5 w-2.5" />
          </Button>
          <span className="text-[11px] text-foreground w-16 text-right font-mono">
            {value.toFixed(unit === '°' ? 1 : 2)}{unit}
          </span>
          <Button
            variant="ghost" size="icon"
            className="h-5 w-5"
            onClick={() => onNudge(nudgeStep)}
            title={`+${nudgeStep}${unit}`}
          >
            <Plus className="h-2.5 w-2.5" />
          </Button>
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
