import React, { useState, useEffect } from 'react';
import VisualizationLegendBar from './VisualizationLegendBar';
import { VisualizationType } from '@/lib/visualization-utils';
import { on } from '@/lib/event-bus';

interface VisState {
  visualizationType: VisualizationType;
  useMockData: boolean;
  rooms: { fmGuid: string; name: string | null; attributes: Record<string, any> | null }[];
}

/**
 * Lightweight wrapper that listens for VISUALIZATION_STATE_CHANGED events
 * and renders the legend bar independently of the right panel.
 */
const VisualizationLegendOverlay: React.FC = () => {
  const [visState, setVisState] = useState<VisState>({
    visualizationType: 'none',
    useMockData: false,
    rooms: [],
  });

  useEffect(() => {
    return on('VISUALIZATION_STATE_CHANGED', (detail) => {
      setVisState(detail as VisState);
    });
  }, []);

  if (visState.visualizationType === 'none') return null;

  return (
    <div className="pointer-events-auto">
      <VisualizationLegendBar
        visualizationType={visState.visualizationType}
        rooms={visState.rooms}
        useMockData={visState.useMockData}
      />
    </div>
  );
};

export default VisualizationLegendOverlay;
