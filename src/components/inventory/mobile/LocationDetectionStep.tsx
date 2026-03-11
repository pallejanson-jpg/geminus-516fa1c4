import React, { useEffect } from 'react';
import { MapPin, Loader2, MapPinOff, Navigation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useNearbyBuilding } from '@/hooks/useNearbyBuilding';

interface LocationDetectionStepProps {
  onComplete: (building: { fmGuid: string; name: string } | null) => void;
}

const LocationDetectionStep: React.FC<LocationDetectionStepProps> = ({ onComplete }) => {
  const { nearbyBuilding, isLoading, error, requestLocation, allBuildings } = useNearbyBuilding(200);

  // Auto-advance if no buildings have coordinates
  useEffect(() => {
    if (error === 'no_buildings') {
      // Skip GPS detection, go to manual selection
      onComplete(null);
    }
  }, [error, onComplete]);

  // Format distance for display
  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 gap-6">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
            <Navigation className="h-12 w-12 text-primary animate-pulse" />
          </div>
          <div className="absolute inset-0 rounded-full border-4 border-primary/30 animate-ping" />
        </div>
        <div className="text-center space-y-2">
           <h2 className="text-xl font-semibold">Looking for your location...</h2>
           <p className="text-muted-foreground">Allow access to location services</p>
         </div>
         <Loader2 className="h-6 w-6 animate-spin text-primary" />
       </div>
     );
   }
 
   // Error state
   if (error && error !== 'no_buildings') {
     const errorMessages: Record<string, { title: string; description: string }> = {
       permission_denied: {
         title: 'Location services denied',
         description: 'Enable location services in your browser settings to use GPS detection.',
       },
       position_unavailable: {
         title: 'Could not get position',
         description: 'Your position could not be determined. Select building manually.',
       },
       timeout: {
         title: 'Timeout',
         description: 'It took too long to get your position. Try again or select manually.',
       },
       geolocation_not_supported: {
         title: 'GPS not supported',
         description: 'Your device does not support location services. Select building manually.',
       },
       default: {
         title: 'Something went wrong',
         description: 'Could not get your position. Select building manually.',
       },
    };

    const msg = errorMessages[error] || errorMessages.default;

    return (
      <div className="h-full flex flex-col items-center justify-center p-6 gap-6">
        <div className="w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center">
          <MapPinOff className="h-12 w-12 text-destructive" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">{msg.title}</h2>
          <p className="text-muted-foreground max-w-xs">{msg.description}</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button onClick={requestLocation} variant="outline" className="h-12">
            <Navigation className="h-5 w-5 mr-2" />
             Try again
           </Button>
           <Button onClick={() => onComplete(null)} className="h-12">
             Select building manually
           </Button>
        </div>
      </div>
    );
  }

  // Found nearby building
  if (nearbyBuilding) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 gap-6">
        <div className="w-24 h-24 rounded-full bg-green-500/10 flex items-center justify-center">
          <MapPin className="h-12 w-12 text-green-600" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">Are you at {nearbyBuilding.commonName}?</h2>
          <p className="text-muted-foreground">
            Ca {formatDistance(nearbyBuilding.distance)} bort
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <Button
            onClick={() =>
              onComplete({ fmGuid: nearbyBuilding.fmGuid, name: nearbyBuilding.commonName })
            }
            className="h-14 text-lg"
          >
            ✅ Ja, stämmer
          </Button>
          <Button onClick={() => onComplete(null)} variant="outline" className="h-14 text-lg">
            ❌ Nej, välj annan
          </Button>
        </div>

        {/* Show other nearby buildings if any */}
        {allBuildings.length > 1 && (
          <Card className="w-full max-w-xs p-4 mt-4">
            <p className="text-sm text-muted-foreground mb-3">Andra byggnader i närheten:</p>
            <div className="space-y-2">
              {allBuildings.slice(1, 4).map((b) => (
                <Button
                  key={b.fmGuid}
                  variant="ghost"
                  className="w-full justify-between h-auto py-2"
                  onClick={() => onComplete({ fmGuid: b.fmGuid, name: b.commonName })}
                >
                  <span className="truncate">{b.commonName}</span>
                  <span className="text-muted-foreground text-sm ml-2">
                    {formatDistance(b.distance)}
                  </span>
                </Button>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  // No building nearby
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-6">
      <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center">
        <MapPin className="h-12 w-12 text-muted-foreground" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">Ingen byggnad i närheten</h2>
        <p className="text-muted-foreground max-w-xs">
          Det finns ingen registrerad byggnad inom 200 meter från dig.
        </p>
      </div>
      <Button onClick={() => onComplete(null)} className="h-14 text-lg w-full max-w-xs">
        Välj byggnad manuellt
      </Button>
    </div>
  );
};

export default LocationDetectionStep;
