/**
 * Lighting Controls Panel
 * 
 * UI component for controlling scene lighting and sun study features.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Sun, Moon, Clock, MapPin, Calendar } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useLightingControls } from '@/hooks/useLightingControls';

interface LightingControlsPanelProps {
  viewerRef: React.MutableRefObject<any>;
  isViewerReady?: boolean;
}

/**
 * LightingControlsPanel provides controls for:
 * - Toggle lighting on/off
 * - Adjust light intensity
 * - Sun study with location and time
 */
const LightingControlsPanel: React.FC<LightingControlsPanelProps> = ({
  viewerRef,
  isViewerReady = false,
}) => {
  const {
    lightingState,
    sunStudyState,
    sunPosition,
    setViewer,
    toggleLighting,
    setAmbientIntensity,
    setDirectionalIntensity,
    toggleSunStudy,
    updateSunStudy,
    getSunTimes,
    formatAltitude,
    formatAzimuth,
  } = useLightingControls();

  const [sunStudyExpanded, setSunStudyExpanded] = useState(false);

  // Set viewer reference when ready
  useEffect(() => {
    if (isViewerReady && viewerRef.current) {
      setViewer(viewerRef.current);
    }
  }, [isViewerReady, viewerRef, setViewer]);

  // Format date for input
  const formatDateForInput = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  // Handle date change
  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = new Date(e.target.value);
    if (!isNaN(newDate.getTime())) {
      updateSunStudy({ date: newDate });
    }
  }, [updateSunStudy]);

  // Handle time change
  const handleTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateSunStudy({ time: e.target.value });
  }, [updateSunStudy]);

  // Quick time presets
  const timePresets = [
    { label: 'Gryning', time: '06:00' },
    { label: 'Morgon', time: '09:00' },
    { label: 'Middag', time: '12:00' },
    { label: 'Eftermiddag', time: '15:00' },
    { label: 'Kväll', time: '18:00' },
    { label: 'Skymning', time: '21:00' },
  ];

  // Location presets (Swedish cities)
  const locationPresets = [
    { label: 'Stockholm', lat: 59.3293, lng: 18.0686 },
    { label: 'Göteborg', lat: 57.7089, lng: 11.9746 },
    { label: 'Malmö', lat: 55.6050, lng: 13.0038 },
    { label: 'Uppsala', lat: 59.8586, lng: 17.6389 },
    { label: 'Luleå', lat: 65.5848, lng: 22.1547 },
  ];

  return (
    <div className="space-y-3">
      {/* Main lighting toggle */}
      <div className="flex items-center justify-between py-1.5 sm:py-2">
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className={cn(
              "p-1 sm:p-1.5 rounded-md",
              lightingState.enabled
                ? "bg-amber-500/10 text-amber-500"
                : "bg-muted text-muted-foreground"
            )}
          >
            {lightingState.enabled ? (
              <Sun className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            ) : (
              <Moon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            )}
          </div>
          <span className="text-xs sm:text-sm">Belysning</span>
        </div>
        <Switch 
          checked={lightingState.enabled} 
          onCheckedChange={toggleLighting}
          disabled={!isViewerReady}
        />
      </div>

      {/* Intensity sliders - only show when lighting is enabled */}
      {lightingState.enabled && (
        <div className="space-y-2 pl-8 sm:pl-10">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] sm:text-xs text-muted-foreground">Omgivningsljus</Label>
              <span className="text-[10px] sm:text-xs text-muted-foreground">
                {Math.round(lightingState.ambientIntensity * 100)}%
              </span>
            </div>
            <Slider
              value={[lightingState.ambientIntensity]}
              onValueChange={([v]) => setAmbientIntensity(v)}
              min={0}
              max={2}
              step={0.1}
              className="w-full"
              disabled={!isViewerReady}
            />
          </div>
          
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] sm:text-xs text-muted-foreground">Riktat ljus</Label>
              <span className="text-[10px] sm:text-xs text-muted-foreground">
                {Math.round(lightingState.directionalIntensity * 100)}%
              </span>
            </div>
            <Slider
              value={[lightingState.directionalIntensity]}
              onValueChange={([v]) => setDirectionalIntensity(v)}
              min={0}
              max={2}
              step={0.1}
              className="w-full"
              disabled={!isViewerReady}
            />
          </div>
        </div>
      )}

      <Separator />

      {/* Sun Study Section */}
      <Collapsible open={sunStudyExpanded} onOpenChange={setSunStudyExpanded}>
        <div className="flex items-center justify-between py-1.5 sm:py-2">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity">
              <div
                className={cn(
                  "p-1 sm:p-1.5 rounded-md",
                  sunStudyState.enabled
                    ? "bg-orange-500/10 text-orange-500"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Sun className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </div>
              <span className="text-xs sm:text-sm">Solstudie</span>
            </button>
          </CollapsibleTrigger>
          <Switch 
            checked={sunStudyState.enabled} 
            onCheckedChange={toggleSunStudy}
            disabled={!isViewerReady}
          />
        </div>

        <CollapsibleContent>
          <div className="space-y-3 pl-8 sm:pl-10 pt-2">
            {/* Location */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-muted-foreground" />
                <Label className="text-[10px] sm:text-xs text-muted-foreground">Plats</Label>
              </div>
              <div className="flex flex-wrap gap-1">
                {locationPresets.map(loc => (
                  <Button
                    key={loc.label}
                    variant={
                      sunStudyState.latitude === loc.lat && sunStudyState.longitude === loc.lng
                        ? "secondary"
                        : "outline"
                    }
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => updateSunStudy({ latitude: loc.lat, longitude: loc.lng })}
                    disabled={!sunStudyState.enabled}
                  >
                    {loc.label}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div>
                  <Label className="text-[9px] text-muted-foreground">Lat</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={sunStudyState.latitude}
                    onChange={(e) => updateSunStudy({ latitude: parseFloat(e.target.value) })}
                    className="h-7 text-xs"
                    disabled={!sunStudyState.enabled}
                  />
                </div>
                <div>
                  <Label className="text-[9px] text-muted-foreground">Lng</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={sunStudyState.longitude}
                    onChange={(e) => updateSunStudy({ longitude: parseFloat(e.target.value) })}
                    className="h-7 text-xs"
                    disabled={!sunStudyState.enabled}
                  />
                </div>
              </div>
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                <Label className="text-[10px] sm:text-xs text-muted-foreground">Datum</Label>
              </div>
              <Input
                type="date"
                value={formatDateForInput(sunStudyState.date)}
                onChange={handleDateChange}
                className="h-7 text-xs"
                disabled={!sunStudyState.enabled}
              />
            </div>

            {/* Time */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <Label className="text-[10px] sm:text-xs text-muted-foreground">Tid</Label>
              </div>
              <Input
                type="time"
                value={sunStudyState.time}
                onChange={handleTimeChange}
                className="h-7 text-xs"
                disabled={!sunStudyState.enabled}
              />
              <div className="flex flex-wrap gap-1 mt-1">
                {timePresets.map(preset => (
                  <Button
                    key={preset.label}
                    variant={sunStudyState.time === preset.time ? "secondary" : "outline"}
                    size="sm"
                    className="h-5 px-1.5 text-[9px]"
                    onClick={() => updateSunStudy({ time: preset.time })}
                    disabled={!sunStudyState.enabled}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Sun position info */}
            {sunPosition && sunStudyState.enabled && (
              <div className="mt-2 p-2 rounded-md bg-muted/50 text-[10px] space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Höjd:</span>
                  <span>{formatAltitude(sunPosition.altitude)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Riktning:</span>
                  <span>{formatAzimuth(sunPosition.azimuth)}</span>
                </div>
                {sunPosition.altitude < 0 && (
                  <div className="text-orange-500 mt-1">
                    ⚠️ Solen är under horisonten
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default LightingControlsPanel;
