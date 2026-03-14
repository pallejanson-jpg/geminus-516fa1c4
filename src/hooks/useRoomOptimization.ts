import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
}

export function useRoomOptimization(buildingFmGuid: string | null | undefined) {
  const [data, setData] = useState<RoomOptimizationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!buildingFmGuid) return;
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
      console.error('[RoomOptimization] Error:', e);
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [buildingFmGuid]);

  return { data, isLoading, error, analyze };
}
