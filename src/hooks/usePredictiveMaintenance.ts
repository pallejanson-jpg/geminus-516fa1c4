import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MaintenancePrediction {
  equipmentGuid: string | null;
  roomGuid: string | null;
  riskLevel: 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  estimatedTimeToFailure: string;
  confidence: number;
}

export interface PredictiveMaintenanceResult {
  predictions: MaintenancePrediction[];
  overallRiskScore: number;
  summary: string;
}

export function usePredictiveMaintenance(buildingFmGuid: string | null | undefined) {
  const [data, setData] = useState<PredictiveMaintenanceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (roomFmGuids?: string[]) => {
    if (!buildingFmGuid) return;
    setIsLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('predictive-maintenance', {
        body: { buildingFmGuid, roomFmGuids },
      });

      if (fnError) throw fnError;
      if (!result?.success) throw new Error(result?.error || 'Analysis failed');

      setData(result.data);
    } catch (e: any) {
      console.error('[PredictiveMaintenance] Error:', e);
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, [buildingFmGuid]);

  return { data, isLoading, error, analyze };
}
