import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigation, X, LocateFixed, Car, Footprints, Bus, Building2, ArrowRight, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { MapFacility } from '@/hooks/useMapFacilities';

interface RouteStep {
  instruction?: string;
  distance?: number;
  duration?: number;
  travelMode?: string;
  transit?: {
    lineName: string;
    lineColor: string | null;
    vehicleType: string;
    departureStop: string;
    arrivalStop: string;
    numStops: number;
  };
}

interface NavigationMapPanelProps {
  facilities: MapFacility[];
  onNavigate: (params: {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    buildingFmGuid: string;
    targetRoomFmGuid: string | null;
    profile: 'walking' | 'driving' | 'transit';
  }) => void;
  onClose: () => void;
  routeSummary?: {
    outdoorDistance: number;
    outdoorDuration: number;
    indoorDistance: number;
    transitSteps?: RouteStep[];
    outdoorSteps?: RouteStep[];
  } | null;
  hasIndoorRoute?: boolean;
  onShowIndoor?: () => void;
}

interface RoomOption {
  fm_guid: string;
  name: string;
}

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const formatDistance = (meters: number) =>
  meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;

const StepIcon: React.FC<{ mode?: string }> = ({ mode }) => {
  switch (mode) {
    case 'TRANSIT': return <Bus size={12} className="text-primary shrink-0" />;
    case 'driving': return <Car size={12} className="text-primary shrink-0" />;
    case 'indoor': return <Building2 size={12} className="text-primary shrink-0" />;
    default: return <Footprints size={12} className="text-primary shrink-0" />;
  }
};

const StepTimeline: React.FC<{ steps: RouteStep[]; indoorDistance: number; profile: string }> = ({ steps, indoorDistance, profile }) => {
  const displaySteps = useMemo(() => {
    const result: Array<{ icon: string; label: string; detail: string }> = [];

    for (const step of steps) {
      if (step.transit) {
        result.push({
          icon: 'TRANSIT',
          label: `${step.transit.lineName || step.transit.vehicleType}`,
          detail: `${step.transit.departureStop} → ${step.transit.arrivalStop}${step.transit.numStops > 0 ? ` (${step.transit.numStops} hållplatser)` : ''}`,
        });
      } else if (step.instruction) {
        result.push({
          icon: profile,
          label: step.instruction,
          detail: [
            step.distance ? formatDistance(step.distance) : '',
            step.duration ? formatDuration(step.duration) : '',
          ].filter(Boolean).join(' · '),
        });
      }
    }

    if (indoorDistance > 0) {
      result.push({
        icon: 'indoor',
        label: 'Gå inomhus',
        detail: `~${formatDistance(indoorDistance)}`,
      });
    }

    return result;
  }, [steps, indoorDistance, profile]);

  if (displaySteps.length === 0) return null;

  return (
    <div className="space-y-0">
      {displaySteps.map((step, i) => (
        <div key={i} className="flex gap-2 items-start py-1">
          <div className="flex flex-col items-center mt-0.5">
            <StepIcon mode={step.icon} />
            {i < displaySteps.length - 1 && (
              <div className="w-px h-full min-h-[12px] bg-border mt-0.5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium leading-tight truncate">{step.label}</p>
            {step.detail && <p className="text-[10px] text-muted-foreground truncate">{step.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
};

const NavigationMapPanel: React.FC<NavigationMapPanelProps> = ({
  facilities,
  onNavigate,
  onClose,
  routeSummary,
  hasIndoorRoute,
  onShowIndoor,
}) => {
  const [profile, setProfile] = useState<'walking' | 'driving' | 'transit'>('walking');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedBuildingGuid, setSelectedBuildingGuid] = useState<string>('');
  const [selectedRoomGuid, setSelectedRoomGuid] = useState<string>('');
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [isLocating, setIsLocating] = useState(false);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setIsLocating(false);
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true }
    );
  }, []);

  useEffect(() => {
    if (!selectedBuildingGuid) { setRooms([]); return; }
    supabase
      .from('assets')
      .select('fm_guid, name')
      .eq('building_fm_guid', selectedBuildingGuid)
      .eq('category', 'Space')
      .order('name')
      .then(({ data }) => {
        setRooms((data || []).map(r => ({ fm_guid: r.fm_guid, name: r.name || r.fm_guid })));
      });
  }, [selectedBuildingGuid]);

  const selectedBuilding = useMemo(
    () => facilities.find(f => f.fmGuid === selectedBuildingGuid),
    [facilities, selectedBuildingGuid]
  );

  const handleNavigate = useCallback(() => {
    if (!userLocation || !selectedBuilding) return;
    onNavigate({
      origin: userLocation,
      destination: { lat: selectedBuilding.lat, lng: selectedBuilding.lng },
      buildingFmGuid: selectedBuildingGuid,
      targetRoomFmGuid: selectedRoomGuid || null,
      profile,
    });
  }, [userLocation, selectedBuilding, selectedBuildingGuid, selectedRoomGuid, profile, onNavigate]);

  const allSteps = useMemo(() => {
    if (!routeSummary) return [];
    return routeSummary.transitSteps || routeSummary.outdoorSteps || [];
  }, [routeSummary]);

  const totalDuration = useMemo(() => {
    if (!routeSummary) return 0;
    const indoorTime = routeSummary.indoorDistance / (profile === 'walking' ? 1.4 : 8);
    return routeSummary.outdoorDuration + indoorTime;
  }, [routeSummary, profile]);

  return (
    <div className="absolute top-3 left-3 z-20 w-80">
      <Card className="bg-card/95 backdrop-blur-sm shadow-xl border-border">
        <CardContent className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Navigation size={16} className="text-primary" />
              <span className="text-sm font-semibold">Navigation</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X size={14} />
            </Button>
          </div>

          {/* Origin */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Från</label>
            <div className="flex gap-1.5">
              <Input
                readOnly
                value={userLocation ? `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}` : ''}
                placeholder="Din position"
                className="h-8 text-xs flex-1"
              />
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleLocate}
                disabled={isLocating}
              >
                <LocateFixed size={14} className={isLocating ? 'animate-pulse' : ''} />
              </Button>
            </div>
          </div>

          {/* Destination building */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Till byggnad</label>
            <Select value={selectedBuildingGuid} onValueChange={v => { setSelectedBuildingGuid(v); setSelectedRoomGuid(''); }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Välj byggnad" />
              </SelectTrigger>
              <SelectContent>
                {facilities.filter(f => f.lat && f.lng).map(f => (
                  <SelectItem key={f.fmGuid} value={f.fmGuid!} className="text-xs">
                    {f.commonName || f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Destination room */}
          {rooms.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Till rum (valfritt)</label>
              <Select value={selectedRoomGuid} onValueChange={setSelectedRoomGuid}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Valfri entré" />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {rooms.map(r => (
                    <SelectItem key={r.fm_guid} value={r.fm_guid} className="text-xs">
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Profile toggle */}
          <div className="flex gap-1">
            <Button
              variant={profile === 'walking' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs gap-1"
              onClick={() => setProfile('walking')}
            >
              <Footprints size={12} /> Gå
            </Button>
            <Button
              variant={profile === 'driving' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs gap-1"
              onClick={() => setProfile('driving')}
            >
              <Car size={12} /> Kör
            </Button>
            <Button
              variant={profile === 'transit' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs gap-1"
              onClick={() => setProfile('transit')}
            >
              <Bus size={12} /> Kollektivt
            </Button>
          </div>

          {/* Navigate button */}
          <Button
            className="w-full h-8 text-xs"
            disabled={!userLocation || !selectedBuildingGuid}
            onClick={handleNavigate}
          >
            <Navigation size={14} className="mr-1" /> Hitta väg
          </Button>

          {/* Route summary with steps */}
          {routeSummary && (
            <div className="bg-muted/50 rounded-md p-2 space-y-2">
              {/* Total summary header */}
              <div className="flex items-center justify-between text-xs font-medium">
                <div className="flex items-center gap-1.5">
                  <Clock size={12} className="text-primary" />
                  <span>{formatDuration(totalDuration)}</span>
                </div>
                <span className="text-muted-foreground">
                  {formatDistance(routeSummary.outdoorDistance + routeSummary.indoorDistance)}
                </span>
              </div>

              {/* Step-by-step timeline */}
              {allSteps.length > 0 && (
                <ScrollArea className="max-h-48">
                  <StepTimeline
                    steps={allSteps}
                    indoorDistance={routeSummary.indoorDistance}
                    profile={profile}
                  />
                </ScrollArea>
              )}

              {/* Fallback for no steps */}
              {allSteps.length === 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="text-[10px]">Utomhus</Badge>
                    <span>{formatDistance(routeSummary.outdoorDistance)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{formatDuration(routeSummary.outdoorDuration)}</span>
                  </div>
                  {routeSummary.indoorDistance > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">Inomhus</Badge>
                      <span>~{formatDistance(routeSummary.indoorDistance)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Show in building button */}
              {hasIndoorRoute && onShowIndoor && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full h-7 text-xs gap-1"
                  onClick={onShowIndoor}
                >
                  <Building2 size={12} />
                  Visa i byggnaden
                  <ArrowRight size={12} />
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default NavigationMapPanel;
