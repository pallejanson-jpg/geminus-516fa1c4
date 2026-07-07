import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Navigation, X, LocateFixed, Car, Footprints, Bus, Building2, ArrowRight, Clock, MapPinned, Search, Accessibility } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/context/LanguageContext';
import { MapFacility } from '@/hooks/useMapFacilities';
import { useIsMobile } from '@/hooks/use-mobile';
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
    preferElevator: boolean;
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
              {/* Street View thumbnail for outdoor steps with coordinates */}
              {streetViewApiKey && step.coordinates && step.icon !== 'indoor' && (
                <StreetViewThumbnail
                  lat={step.coordinates.lat}
                  lng={step.coordinates.lng}
                  heading={0}
                  apiKey={streetViewApiKey}
                />
              )}
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
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const [profile, setProfile] = useState<'walking' | 'driving' | 'transit'>('walking');
  const [preferElevator, setPreferElevator] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedBuildingGuid, setSelectedBuildingGuid] = useState<string>('');
  const [selectedRoomGuid, setSelectedRoomGuid] = useState<string>('');
  const [roomSearch, setRoomSearch] = useState('');
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [drawerExpanded, setDrawerExpanded] = useState(true);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);

  // Geocoding state
  const [originText, setOriginText] = useState('');
  const [geocodingResults, setGeocodingResults] = useState<GeocodingResult[]>([]);
  const [showGeoResults, setShowGeoResults] = useState(false);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const geocodeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streetViewApiKey, setStreetViewApiKey] = useState<string | null>(null);

  // Fetch mapbox token for geocoding
  useEffect(() => {
    supabase.functions.invoke('get-mapbox-token').then(({ data }) => {
      if (data?.token) setMapboxToken(data.token);
    });
  }, []);

  // Fetch Street View API key
  useEffect(() => {
    supabase.functions.invoke('get-streetview-key').then(({ data }) => {
      if (data?.key) setStreetViewApiKey(data.key);
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
    setIsLoadingRooms(true);
    supabase
      .from('assets')
      .select('fm_guid, name')
      .eq('building_fm_guid', selectedBuildingGuid)
      .in('category', ['Space', 'IfcSpace'])
      .order('name')
      .then(({ data }) => {
        setRooms((data || []).map(r => ({ fm_guid: r.fm_guid, name: r.name || r.fm_guid })));
        setIsLoadingRooms(false);
      });
  }, [selectedBuildingGuid]);

  const selectedBuilding = useMemo(
    () => facilities.find(f => f.fmGuid === selectedBuildingGuid),
    [facilities, selectedBuildingGuid]
  );

  const filteredRooms = useMemo(() => {
    if (!roomSearch.trim()) return rooms;
    const q = roomSearch.toLowerCase();
    return rooms.filter(r => r.name.toLowerCase().includes(q));
  }, [rooms, roomSearch]);

  const handleNavigate = useCallback(() => {
    if (!userLocation || !selectedBuilding) return;
    onNavigate({
      origin: userLocation,
      destination: { lat: selectedBuilding.lat, lng: selectedBuilding.lng },
      buildingFmGuid: selectedBuildingGuid,
      targetRoomFmGuid: selectedRoomGuid || null,
      profile,
      preferElevator,
    });
  }, [userLocation, selectedBuilding, selectedBuildingGuid, selectedRoomGuid, profile, preferElevator, onNavigate]);

  const allSteps = useMemo(() => {
    if (!routeSummary) return [];
    return routeSummary.transitSteps || routeSummary.outdoorSteps || [];
  }, [routeSummary]);

  const totalDuration = useMemo(() => {
    if (!routeSummary) return 0;
    const indoorTime = routeSummary.indoorDistance / (profile === 'walking' ? 1.4 : 8);
    return routeSummary.outdoorDuration + indoorTime;
  }, [routeSummary, profile]);

  // Shared panel content
  const panelContent = (
    <div className="space-y-3">
      {/* Picking origin banner */}
      {pickingOrigin && (
        <div className="bg-primary/10 border border-primary/30 rounded-md px-2 py-1.5 text-xs text-primary font-medium text-center animate-pulse">
          {t('Klicka på kartan för att välja startpunkt', 'Click on the map to select start point')}
        </div>
      )}

      {/* Origin */}
      <div className="space-y-1 relative">
        <label className="text-xs text-muted-foreground">{t('Från', 'From')}</label>
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
              placeholder={t('Ange adress eller välj på kartan', 'Enter address or select on map')}
              className="h-9 text-xs"
            />
            {/* Geocoding dropdown */}
            {showGeoResults && geocodingResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-[60] mt-0.5 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
                {geocodingResults.map((r, i) => (
                  <button
                    key={i}
                    className="w-full text-left px-2 py-2 text-xs hover:bg-muted/80 transition-colors flex items-start gap-1.5"
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
            className="h-9 w-9 shrink-0"
            onClick={handleLocate}
            disabled={isLocating}
            title={t('Min plats (GPS)', 'My location (GPS)')}
          >
            <LocateFixed size={14} className={isLocating ? 'animate-pulse' : ''} />
          </Button>
          {onRequestMapClick && (
            <Button
              variant={pickingOrigin ? 'default' : 'secondary'}
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={onRequestMapClick}
              title={t('Välj position på kartan', 'Select position on map')}
            >
              <MapPinned size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Destination building */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{t('Till byggnad', 'To building')}</label>
        <Select value={selectedBuildingGuid} onValueChange={v => { setSelectedBuildingGuid(v); setSelectedRoomGuid(''); }}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder={t('Välj byggnad', 'Select building')} />
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

      {/* Destination room — always shown when a building is selected */}
      {selectedBuildingGuid && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t('Till rum (valfritt)', 'To room (optional)')}</label>
          {isLoadingRooms ? (
            <div className="h-9 flex items-center px-3 text-xs text-muted-foreground border border-input rounded-md bg-background">
              {t('Hämtar rum…', 'Loading rooms…')}
            </div>
          ) : rooms.length === 0 ? (
            <div className="h-9 flex items-center px-3 text-xs text-muted-foreground border border-input rounded-md bg-background">
              {t('Inga rum hittades för denna byggnad', 'No rooms found for this building')}
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={roomSearch}
                  onChange={e => setRoomSearch(e.target.value)}
                  placeholder={t('Sök rum…', 'Search rooms…')}
                  className="w-full h-9 pl-6 pr-2 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <Select value={selectedRoomGuid} onValueChange={setSelectedRoomGuid}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t('Välj rum', 'Select room')} />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {filteredRooms.map(r => (
                    <SelectItem key={r.fm_guid} value={r.fm_guid} className="text-xs">
                      {r.name}
                    </SelectItem>
                  ))}
                  {filteredRooms.length === 0 && roomSearch && (
                    <div className="px-2 py-2 text-xs text-muted-foreground">{t(`Inget rum matchar "${roomSearch}"`, `No room matches "${roomSearch}"`)}</div>
                  )}
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}

      {/* Profile toggle */}
      <div className="flex gap-1">
        <Button
          variant={profile === 'walking' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 h-9 text-xs gap-1"
          onClick={() => setProfile('walking')}
        >
          <Footprints size={12} /> {t('Gå', 'Walk')}
        </Button>
        <Button
          variant={profile === 'driving' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 h-9 text-xs gap-1"
          onClick={() => setProfile('driving')}
        >
          <Car size={12} /> {t('Kör', 'Drive')}
        </Button>
        <Button
          variant={profile === 'transit' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 h-9 text-xs gap-1"
          onClick={() => setProfile('transit')}
        >
          <Bus size={12} /> {t('Kollektivtrafik', 'Transit')}
        </Button>
      </div>

      {/* Accessibility toggle */}
      <div className="flex items-center justify-between py-0.5">
        <div className="flex items-center gap-2">
          <Accessibility size={13} className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t('Undvik trappor', 'Avoid stairs')}</span>
        </div>
        <button
          role="switch"
          aria-checked={preferElevator}
          onClick={() => setPreferElevator(p => !p)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${preferElevator ? 'bg-primary' : 'bg-input'}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${preferElevator ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Navigate button */}
      <Button
        className="w-full h-9 text-xs"
        disabled={!userLocation || !selectedBuildingGuid}
        onClick={handleNavigate}
      >
        <Navigation size={14} className="mr-1" /> {t('Visa väg', 'Get Directions')}
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
            <ScrollArea className={isMobile ? 'max-h-[40dvh]' : 'max-h-[60vh]'}>
              <StepTimeline
                steps={allSteps}
                indoorDistance={routeSummary.indoorDistance}
                indoorSteps={routeSummary.indoorSteps}
                profile={profile}
                onStepClick={onStepClick}
                activeStepIndex={activeStepIndex}
                streetViewApiKey={streetViewApiKey}
              />
            </ScrollArea>
          )}

          {/* Fallback for no steps */}
          {allSteps.length === 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="secondary" className="text-[10px]">{t('Utomhus', 'Outdoor')}</Badge>
                <span>{formatDistance(routeSummary.outdoorDistance)}</span>
                <span className="text-muted-foreground">·</span>
                <span>{formatDuration(routeSummary.outdoorDuration)}</span>
              </div>
              {routeSummary.indoorDistance > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">{t('Inomhus', 'Indoor')}</Badge>
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
              className="w-full h-9 text-xs gap-1"
              onClick={onShowIndoor}
            >
              <Building2 size={12} />
              {t('Visa i byggnad', 'Show in building')}
              <ArrowRight size={12} />
            </Button>
          )}
        </div>
      )}
    </div>
  );

  // Mobile: bottom drawer
  if (isMobile) {
    // Compact summary bar when route exists (shown when drawer is collapsed)
    const summaryBar = routeSummary ? (
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          <Clock size={12} className="text-primary" />
          <span>{formatDuration(totalDuration)}</span>
          <span className="text-muted-foreground">·</span>
          <span>{formatDistance(routeSummary.outdoorDistance + routeSummary.indoorDistance)}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
    ) : null;

    return (
      <Drawer
        open={true}
        modal={false}
        onOpenChange={(open) => { if (!open) onClose(); }}
      >
        <DrawerContent className="max-h-[92dvh] h-[92dvh] flex flex-col">
          <DrawerHeader className="py-2 px-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Navigation size={16} className="text-primary" />
              <DrawerTitle className="text-sm">{t('Navigation', 'Navigation')}</DrawerTitle>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X size={14} />
            </Button>
          </DrawerHeader>
          <div className="px-3 pb-6 flex-1 overflow-y-auto overscroll-contain -webkit-overflow-scrolling-touch">
            {panelContent}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: positioned card
  return (
    <div className="absolute top-3 left-3 z-20 w-80">
      <Card className="bg-card/95 backdrop-blur-sm shadow-xl border-border">
        {/* Sticky header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <Navigation size={16} className="text-primary" />
            <span className="text-sm font-semibold">{t('Navigation', 'Navigation')}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
        <CardContent className="p-3 pt-0 space-y-3 overflow-y-auto max-h-[calc(100dvh-5.5rem)]">
          {panelContent}
        </CardContent>
      </Card>
    </div>
  );
};

export default NavigationMapPanel;
