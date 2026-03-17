/**
 * Standalone page for testing the FM Access 2D Viewer.
 * URL: /fma-2d?building=<fmGuid>&floor=<floorName>&fmaGuid=<fmAccessBuildingGuid>&buildingName=<name>
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import FmAccess2DPanel from '@/components/viewer/FmAccess2DPanel';

const FmAccess2DStandalone: React.FC = () => {
  const [params] = useSearchParams();

  const buildingFmGuid = params.get('building') || '';
  const floorName = params.get('floor') || undefined;
  const fmAccessBuildingGuid = params.get('fmaGuid') || undefined;
  const buildingName = params.get('buildingName') || undefined;

  if (!buildingFmGuid) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="text-center max-w-md space-y-2">
          <h1 className="text-lg font-semibold">FM Access 2D Viewer</h1>
          <p className="text-sm text-muted-foreground">
            Ange query-parametrar i URL:en för att ladda en ritning:
          </p>
          <code className="block text-xs bg-muted px-3 py-2 rounded">
            /fma-2d?building=&lt;fmGuid&gt;&amp;floor=&lt;floorName&gt;&amp;fmaGuid=&lt;fmAccessGuid&gt;
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-background">
      <FmAccess2DPanel
        buildingFmGuid={buildingFmGuid}
        floorName={floorName}
        fmAccessBuildingGuid={fmAccessBuildingGuid}
        buildingName={buildingName}
        className="h-full w-full"
      />
    </div>
  );
};

export default FmAccess2DStandalone;
