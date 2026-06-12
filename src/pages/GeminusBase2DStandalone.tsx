/**
 * Standalone page for testing the Geminus Base 2D Viewer.
 * URL: /geminus-base-2d?building=<fmGuid>&floor=<floorName>&geminusBaseGuid=<geminusBaseBuildingGuid>&buildingName=<name>
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import GeminusBase2DPanel from '@/components/viewer/GeminusBase2DPanel';

const GeminusBase2DStandalone: React.FC = () => {
  const [params] = useSearchParams();

  const buildingFmGuid = params.get('building') || '';
  const floorName = params.get('floor') || undefined;
  const geminusBaseBuildingGuid = params.get('geminusBaseGuid') || undefined;
  const buildingName = params.get('buildingName') || undefined;

  if (!buildingFmGuid) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="text-center max-w-md space-y-2">
          <h1 className="text-lg font-semibold">Geminus Base 2D Viewer</h1>
          <p className="text-sm text-muted-foreground">
            Ange query-parametrar i URL:en för att ladda en ritning:
          </p>
          <code className="block text-xs bg-muted px-3 py-2 rounded">
            /geminus-base-2d?building=&lt;fmGuid&gt;&amp;floor=&lt;floorName&gt;&amp;geminusBaseGuid=&lt;geminusBaseGuid&gt;
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-background">
      <GeminusBase2DPanel
        buildingFmGuid={buildingFmGuid}
        floorName={floorName}
        geminusBaseBuildingGuid={geminusBaseBuildingGuid}
        buildingName={buildingName}
        className="h-full w-full"
      />
    </div>
  );
};

export default GeminusBase2DStandalone;
