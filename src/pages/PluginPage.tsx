/**
 * PluginPage — Standalone route for GeminusPluginMenu.
 * URL: /plugin?building=GUID&floor=GUID&room=GUID&source=external
 * Renders only the FAB menu with a transparent background,
 * designed to be opened as a companion popup or iframe overlay.
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import GeminusPluginMenu from '@/components/viewer/GeminusPluginMenu';

export default function PluginPage() {
  const [params] = useSearchParams();
  const buildingFmGuid = params.get('building') || undefined;
  const floorGuid = params.get('floor') || undefined;
  const roomGuid = params.get('room') || undefined;
  const source = params.get('source') || 'plugin';

  return (
    <div className="fixed inset-0 bg-transparent">
      <GeminusPluginMenu
        buildingFmGuid={buildingFmGuid}
        buildingName={undefined}
        source={source}
        contextMetadata={{
          floorGuid,
          roomGuid,
          standalone: true,
        }}
      />
    </div>
  );
}
