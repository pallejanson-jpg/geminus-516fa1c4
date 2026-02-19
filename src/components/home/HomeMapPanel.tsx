/**
 * HomeMapPanel
 *
 * Shown on the home landing page (xl+ screens) to the right of AI assistants
 * and My Favorites. Shows a Mapbox map with buildings and a link to the full
 * Cesium globe view. CesiumGlobeView is intentionally NOT imported here because
 * resium/@cesium/engine use the bare "cesium" specifier which crashes in the
 * browser module system outside of its dedicated route bundle.
 */

import React, { Suspense, useState } from 'react';
import { Globe, Map, Loader2, AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useContext } from 'react';
import { AppContext } from '@/context/AppContext';

// Lazy load Mapbox only — no Cesium here
const MapView = React.lazy(() => import('@/components/map/MapView'));

// Error boundary to prevent map crashes from bubbling up to the whole app
interface MapErrorBoundaryState { hasError: boolean; }
class MapErrorBoundary extends React.Component<
  { children: React.ReactNode; onRetry: () => void },
  MapErrorBoundaryState
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) { console.warn('[HomeMapPanel] Map error caught by boundary:', error.message); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 opacity-50" />
          <p className="text-sm">Kartan kunde inte laddas</p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onRetry();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Försök igen
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function HomeMapPanel() {
  const [boundaryKey, setBoundaryKey] = useState(0);
  const { setActiveApp } = useContext(AppContext);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-border bg-card/40">
      {/* Action buttons — top right */}
      <div className="absolute top-3 right-3 z-20 flex gap-1 bg-background/80 backdrop-blur-sm rounded-lg p-0.5 border border-border/60 shadow-lg">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2.5 text-xs gap-1.5"
          onClick={() => setActiveApp('globe')}
          title="Öppna 3D-glob"
        >
          <Globe className="h-3.5 w-3.5" />
          Glob
        </Button>
        <Button
          size="sm"
          variant="default"
          className="h-7 px-2.5 text-xs gap-1.5"
          onClick={() => setActiveApp('map')}
          title="Öppna fullskärmskarta"
        >
          <Map className="h-3.5 w-3.5" />
          Karta
        </Button>
      </div>

      {/* Map content */}
      <div className="absolute inset-0">
        <MapErrorBoundary key={boundaryKey} onRetry={() => setBoundaryKey(k => k + 1)}>
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            }
          >
            <MapView />
          </Suspense>
        </MapErrorBoundary>
      </div>
    </div>
  );
}
