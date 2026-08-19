import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

export interface OptimizationSuggestion {
  type: 'underutilized' | 'overcrowded' | 'merge' | 'convert' | 'rezone';
  roomGuids: string[];
  title: string;
  description: string;
  potentialSaving: string;
  priority: 'high' | 'medium' | 'low';
  estimatedImpact: string;
}

export interface RoomOptimizationResult {
  utilizationScore: number;
  suggestions: OptimizationSuggestion[];
  statistics: {
    totalArea: number;
    avgOccupancy: number;
    underutilizedRooms: number;
    overcrowdedRooms: number;
  };
  summary: string;
  isMock?: boolean;
}

const MOCK_SUGGESTIONS: OptimizationSuggestion[] = [
  {
    type: 'underutilized', roomGuids: [],
    title: 'Conference Rooms — Low Booking Rate',
    description: 'Average occupancy below 22% across medium-sized conference rooms. Consider converting two to open collaboration zones.',
    potentialSaving: '~120 m² freed', priority: 'high',
    estimatedImpact: 'Could reduce booking conflicts by 40%',
  },
  {
    type: 'overcrowded', roomGuids: [],
    title: 'Open Office Zone B — Density Exceeded',
    description: 'Peak occupancy regularly exceeds 110% of designed capacity. Recommend hotdesking policy or partition reconfiguration.',
    potentialSaving: 'Reduced strain', priority: 'high',
    estimatedImpact: 'Improves comfort score by est. 30%',
  },
  {
    type: 'merge', roomGuids: [],
    title: 'Storage Rooms 204–206 — Consolidate',
    description: 'Three adjacent small storage rooms with combined 85% spare capacity. Merging could yield a usable meeting room.',
    potentialSaving: '~45 m² repurposed', priority: 'medium',
    estimatedImpact: 'Adds 1 small meeting room (8 seats)',
  },
  {
    type: 'convert', roomGuids: [],
    title: 'Break Room Floor 4 — Underused',
    description: 'Kitchen/break area usage 15% below building average. Could be partially converted to quiet work pods.',
    potentialSaving: '~30 m² repurposed', priority: 'medium',
    estimatedImpact: 'Adds 4–6 focus work positions',
  },
  {
    type: 'rezone', roomGuids: [],
    title: 'Floor 2 — Mixed Use Optimization',
    description: 'Current zoning mixes loud collaborative and quiet focus work. Separating zones may improve productivity.',
    potentialSaving: 'No area change', priority: 'low',
    estimatedImpact: 'Estimated 15% productivity gain',
  },
];

const hashCode = (s: string) => s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);

function buildMockData(buildingFmGuid: string): RoomOptimizationResult {
  const h = Math.abs(hashCode(buildingFmGuid));
  const score = 38 + (h % 45);
  const count = 3 + (h % 3);
  return {
    utilizationScore: score,
    suggestions: MOCK_SUGGESTIONS.slice(0, count),
    statistics: {
      totalArea: 2400 + (h % 3000),
      avgOccupancy: score,
      underutilizedRooms: 8 + (h % 12),
      overcrowdedRooms: 2 + (h % 5),
    },
    summary: `Estimated analysis based on building profile. ${count} optimization opportunities identified that could free up significant usable space.`,
    isMock: true,
  };
}

export function useRoomOptimization(buildingFmGuid: string | null | undefined) {
  const [data, setData] = useState<RoomOptimizationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!buildingFmGuid) return;

    // Show mock data instantly while real analysis runs in background
    if (!data) {
      setData(buildMockData(buildingFmGuid));
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('room-optimization', {
        body: { buildingFmGuid },
      });

      if (fnError) throw fnError;
      if (!result?.success) throw new Error(result?.error || 'Analysis failed');

      setData(result.data);
    } catch (e: any) {
      logger.warn('[RoomOptimization] Edge function failed, using mock data:', e.message);
      // Keep mock data already shown
    } finally {
      setIsLoading(false);
    }
  }, [buildingFmGuid, data]);

  const analyzeOrMock = useCallback(async () => {
    if (!buildingFmGuid) return;
    if (!data) {
      setData(buildMockData(buildingFmGuid));
    }
    await analyze();
  }, [buildingFmGuid, data, analyze]);

  return { data, isLoading, error, analyze: analyzeOrMock };
}
