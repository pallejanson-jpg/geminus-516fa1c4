import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Navigation, X, LocateFixed, Car, Footprints, Bus, Building2, ArrowRight, Clock, MapPinned, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { MapFacility } from '@/hooks/useMapFacilities';
import StreetViewThumbnail from '@/components/map/StreetViewThumbnail';

interface RouteStep {
  instruction?: string;
  distance?: number;
  duration?: number;
  travelMode?: string;
  maneuver?: { location?: [number, number] };
  transit?: {
    lineName: string;
    lineColor: string | null;
    vehicleType: string;
    departureStop: string;
    arrivalStop: string;
    numStops: number;
    departureLocation?: { lat: number; lng: number };
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
    indoorSteps?: Array<{
      instruction: string;
      distance: number;
      coordinates: { lat: number; lng: number };
      type: string;
    }>;
  } | null;
  hasIndoorRoute?: boolean;
  onShowIndoor?: () => void;
  onRequestMapClick?: () => void;
  mapClickedPosition?: { lat: number; lng: number } | null;
  onStepClick?: (index: number, coords: { lat: number; lng: number }) => void;
  activeStepIndex?: number | null;
  pickingOrigin?: boolean;
}

interface RoomOption {
  fm_guid: string;
  name: string;
}

interface GeocodingResult {
  place_name: string;
  center: [number, number]; // [lng, lat]
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

interface DisplayStep {
  icon: string;
  label: string;
  detail: string;
  coordinates?: { lat: number; lng: number };
}

const StepTimeline: React.FC<{
  steps: RouteStep[];
  indoorDistance: number;
  indoorSteps?: Array<{
    instruction: string;
    distance: number;
    coordinates: { lat: number; lng: number };
    type: string;
  }>;
  profile: string;
  onStepClick?: (index: number, coords: { lat: number; lng: number }) => void;
  activeStepIndex?: number | null;
  streetViewApiKey?: string | null;
}> = ({ steps, indoorDistance, indoorSteps, profile, onStepClick, activeStepIndex, streetViewApiKey }) => {
  const displaySteps = useMemo(() => {
    const result: DisplayStep[] = [];

    for (const step of steps) {
      if (step.transit) {
        result.push({
          icon: 'TRANSIT',
          label: `${step.transit.lineName || step.transit.vehicleType}`,
          detail: `${step.transit.departureStop} → ${step.transit.arrivalStop}${step.transit.numStops > 0 ? ` (${step.transit.numStops} stops)` : ''}`,
          coordinates: step.transit.departureLocation || undefined,
        });
      } else if (step.instruction) {
        const coords = step.maneuver?.location
          ? { lat: step.maneuver.location[1], lng: step.maneuver.location[0] }
          : undefined;
        result.push({
          icon: profile,
          label: step.instruction,
          detail: [
            step.distance ? formatDistance(step.distance) : '',
            step.duration ? formatDuration(step.duration) : '',
          ].filter(Boolean).join(' · '),
          coordinates: coords,
        });
      }
    }

    // Detailed indoor steps or fallback summary
    if (indoorSteps && indoorSteps.length > 0) {
      for (const is of indoorSteps) {
        result.push({
          icon: 'indoor',
          label: is.instruction,
          detail: is.distance > 0 ? formatDistance(is.distance) : '',
          coordinates: is.coordinates,
        });
      }
    } else if (indoorDistance > 0) {
      result.push({
        icon: 'indoor',
        label: 'Walk indoors',
        detail: `~${formatDistance(indoorDistance)}`,
      });
    }

    return result;
  }, [steps, indoorDistance, indoorSteps, profile]);

  if (displaySteps.length === 0) return null;

  return (
    <div className="space-y-0">
      {displaySteps.map((step, i) => {
        const isActive = activeStepIndex === i;
        const isClickable = !!step.coordinates && !!onStepClick;
        return (
          <div
            key={i}
            className={`flex gap-2 items-start py-1 px-1 rounded transition-colors ${
              isActive ? 'bg-primary/15' : ''
            } ${isClickable ? 'cursor-pointer hover:bg-muted/80' : ''}`}
            onClick={() => {
              if (isClickable && step.coordinates) {
                onStepClick!(i, step.coordinates);
              }
            }}
          >
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
        );
      })}
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
  onRequestMapClick,
  mapClickedPosition,
  onStepClick,
  activeStepIndex,
  pickingOrigin,
}) => {
  const [profile, setProfile] = useState<'walking' | 'driving' | 'transit'>('walking');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedBuildingGuid, setSelectedBuildingGuid] = useState<string>('');
  const [selectedRoomGuid, setSelectedRoomGuid] = useState<string>('');
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [isLocating, setIsLocating] = useState(false);

  // Geocoding state
  const [originText, setOriginText] = useState('');
  const [geocodingResults, setGeocodingResults] = useState<GeocodingResult[]>([]);
  const [showGeoResults, setShowGeoResults] = useState(false);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch mapbox token for geocoding
  useEffect(() => {
    supabase.functions.invoke('get-mapbox-token').then(({ data }) => {
      if (data?.token) setMapboxToken(data.token);
    });
  }, []);

  // Update origin text when location changes externally
  useEffect(() => {
    if (userLocation) {
      setOriginText(`${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`);
      setShowGeoResults(false);
    }
  }, [userLocation]);

  // Accept map-clicked position
  useEffect(() => {
    if (mapClickedPosition) {
      setUserLocation(mapClickedPosition);
    }
  }, [mapClickedPosition]);

  // Geocode on text change
  useEffect(() => {
    if (!originText || originText.length < 3 || !mapboxToken) {
      setGeocodingResults([]);
      return;
    }
    // Skip geocoding if text looks like coordinates
    if (/^\d+\.\d+,\s*\d+\.\d+$/.test(originText.trim())) {
      setGeocodingResults([]);
      return;
    }
    if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current);
    geocodeTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(originText)}.json?access_token=${mapboxToken}&limit=5&language=sv`
        );
        const data = await res.json();
        if (data.features) {
          setGeocodingResults(data.features.map((f: any) => ({
            place_name: f.place_name,
            center: f.center,
          })));
          setShowGeoResults(true);
        }
      } catch {
        setGeocodingResults([]);
      }
    }, 300);
    return () => { if (geocodeTimeout.current) clearTimeout(geocodeTimeout.current); };
  }, [originText, mapboxToken]);

  const handleSelectGeoResult = useCallback((result: GeocodingResult) => {
    setUserLocation({ lat: result.center[1], lng: result.center[0] });
    setOriginText(result.place_name);
    setShowGeoResults(false);
    setGeocodingResults([]);
  }, []);

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

          {/* Picking origin banner */}
          {pickingOrigin && (
            <div className="bg-primary/10 border border-primary/30 rounded-md px-2 py-1.5 text-xs text-primary font-medium text-center animate-pulse">
              Click on the map to select start point
            </div>
          )}

          {/* Origin */}
          <div className="space-y-1 relative">
            <label className="text-xs text-muted-foreground">From</label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  value={originText}
                  onChange={(e) => {
                    setOriginText(e.target.value);
                    setShowGeoResults(true);
                  }}
                  onFocus={() => { if (geocodingResults.length > 0) setShowGeoResults(true); }}
                  onBlur={() => setTimeout(() => setShowGeoResults(false), 200)}
                  placeholder="Enter address or select on map"
                  className="h-8 text-xs"
                />
                {/* Geocoding dropdown */}
                {showGeoResults && geocodingResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-0.5 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
                    {geocodingResults.map((r, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted/80 transition-colors flex items-start gap-1.5"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectGeoResult(r)}
                      >
                        <Search size={10} className="text-muted-foreground mt-0.5 shrink-0" />
                        <span className="truncate">{r.place_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={handleLocate}
                disabled={isLocating}
                title="My location (GPS)"
              >
                <LocateFixed size={14} className={isLocating ? 'animate-pulse' : ''} />
              </Button>
              {onRequestMapClick && (
                <Button
                  variant={pickingOrigin ? 'default' : 'secondary'}
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={onRequestMapClick}
                  title="Select position on map"
                >
                  <MapPinned size={14} />
                </Button>
              )}
            </div>
          </div>

          {/* Destination building */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">To building</label>
            <Select value={selectedBuildingGuid} onValueChange={v => { setSelectedBuildingGuid(v); setSelectedRoomGuid(''); }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select building" />
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
             <label className="text-xs text-muted-foreground">To room (optional)</label>
              <Select value={selectedRoomGuid} onValueChange={setSelectedRoomGuid}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Optional entrance" />
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
              <Footprints size={12} /> Walk
            </Button>
            <Button
              variant={profile === 'driving' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs gap-1"
              onClick={() => setProfile('driving')}
            >
              <Car size={12} /> Drive
            </Button>
            <Button
              variant={profile === 'transit' ? 'default' : 'outline'}
              size="sm"
              className="flex-1 h-7 text-xs gap-1"
              onClick={() => setProfile('transit')}
            >
              <Bus size={12} /> Transit
            </Button>
          </div>

          {/* Navigate button */}
          <Button
            className="w-full h-8 text-xs"
            disabled={!userLocation || !selectedBuildingGuid}
            onClick={handleNavigate}
          >
            <Navigation size={14} className="mr-1" /> Get Directions
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
                    indoorSteps={routeSummary.indoorSteps}
                    profile={profile}
                    onStepClick={onStepClick}
                    activeStepIndex={activeStepIndex}
                  />
                </ScrollArea>
              )}

              {/* Fallback for no steps */}
              {allSteps.length === 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="secondary" className="text-[10px]">Outdoor</Badge>
                    <span>{formatDistance(routeSummary.outdoorDistance)}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{formatDuration(routeSummary.outdoorDuration)}</span>
                  </div>
                  {routeSummary.indoorDistance > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">Indoor</Badge>
                      <span>~{formatDistance(routeSummary.indoorDistance)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Show in building button — visible whenever route + building selected */}
              {routeSummary && selectedBuildingGuid && onShowIndoor && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full h-7 text-xs gap-1"
                  onClick={onShowIndoor}
                >
                  <Building2 size={12} />
                  Show in building
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
