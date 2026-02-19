/**
 * HomeMapPanel
 * 
 * Shown on the home landing page (xl+ screens) to the right of AI assistants
 * and My Favorites. Provides a quick geographic overview of buildings with
 * a toggle between Cesium globe and Mapbox.
 */

import React, { Suspense, useState } from 'react';
import { Globe, Map, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Lazy load to avoid heavy bundle impact on initial render
const CesiumGlobeView = React.lazy(() => import('@/components/globe/CesiumGlobeView'));
const MapView = React.lazy(() => import('@/components/map/MapView'));

type MapMode = 'cesium' | 'mapbox';

export default function HomeMapPanel() {
  const [mapMode, setMapMode] = useState<MapMode>('cesium');

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-border bg-card/40">
      {/* Toggle buttons — top right */}
      <div className="absolute top-3 right-3 z-20 flex gap-1 bg-background/80 backdrop-blur-sm rounded-lg p-0.5 border border-border/60 shadow-lg">
        <Button
          size="sm"
          variant={mapMode === 'cesium' ? 'default' : 'ghost'}
          className="h-7 px-2.5 text-xs gap-1.5"
          onClick={() => setMapMode('cesium')}
        >
          <Globe className="h-3.5 w-3.5" />
          Glob
        </Button>
        <Button
          size="sm"
          variant={mapMode === 'mapbox' ? 'default' : 'ghost'}
          className="h-7 px-2.5 text-xs gap-1.5"
          onClick={() => setMapMode('mapbox')}
        >
          <Map className="h-3.5 w-3.5" />
          Karta
        </Button>
      </div>

      {/* Map content */}
      <div className="absolute inset-0">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          }
        >
          {mapMode === 'cesium' ? (
            <CesiumGlobeView />
          ) : (
            <MapView />
          )}
        </Suspense>
      </div>
    </div>
  );
}
