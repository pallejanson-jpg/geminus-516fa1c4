import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigation, X, LocateFixed, Car, Footprints, Bus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { MapFacility } from '@/hooks/useMapFacilities';

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
    transitSteps?: Array<{
      travelMode: string;
      distance?: number;
      duration?: string;
      transit?: {
        lineName: string;
        lineColor: string | null;
        vehicleType: string;
        departureStop: string;
        arrivalStop: string;
        numStops: number;
      };
    }>;
  } | null;
}

interface RoomOption {
  fm_guid: string;
  name: string;
}

const NavigationMapPanel: React.FC<NavigationMapPanelProps> = ({
  facilities,
  onNavigate,
  onClose,
  routeSummary,
}) => {
  const [profile, setProfile] = useState<'walking' | 'driving' | 'transit'>('walking');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedBuildingGuid, setSelectedBuildingGuid] = useState<string>('');
  const [selectedRoomGuid, setSelectedRoomGuid] = useState<string>('');
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [isLocating, setIsLocating] = useState(false);

  // Get user GPS location
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

  // Load rooms when building selected
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

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.round(seconds / 60);
    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  const formatDistance = (meters: number) =>
    meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;

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
            <label className="text-xs text-muted-foreground">From</label>
            <div className="flex gap-1.5">
              <Input
                readOnly
                value={userLocation ? `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}` : ''}
                placeholder="Your location"
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
                  <SelectValue placeholder="Any entrance" />
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
          </div>

          {/* Navigate button */}
          <Button
            className="w-full h-8 text-xs"
            disabled={!userLocation || !selectedBuildingGuid}
            onClick={handleNavigate}
          >
            <Navigation size={14} className="mr-1" /> Find route
          </Button>

          {/* Route summary */}
          {routeSummary && (
            <div className="bg-muted/50 rounded-md p-2 space-y-1">
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
              <div className="text-xs font-medium pt-1 border-t border-border mt-1">
                Total: {formatDistance(routeSummary.outdoorDistance + routeSummary.indoorDistance)}
                {' · '}
                {formatDuration(routeSummary.outdoorDuration + (routeSummary.indoorDistance / (profile === 'walking' ? 1.4 : 8)))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default NavigationMapPanel;
