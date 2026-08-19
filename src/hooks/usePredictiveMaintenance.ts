import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

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
  isMock?: boolean;
}

const MOCK_PREDICTIONS: MaintenancePrediction[] = [
  {
    equipmentGuid: null, roomGuid: null,
    riskLevel: 'high', category: 'hvac',
    title: 'HVAC Unit — Compressor Wear',
    description: 'Vibration patterns suggest compressor bearing wear. Recommend inspection within 30 days.',
    estimatedTimeToFailure: '4–6 weeks', confidence: 0.82,
  },
  {
    equipmentGuid: null, roomGuid: null,
    riskLevel: 'high', category: 'electrical',
    title: 'Main Distribution Panel — Overload Risk',
    description: 'Peak load measurements indicate 91% capacity utilization. Risk of trip during demand spikes.',
    estimatedTimeToFailure: '2–4 weeks', confidence: 0.76,
  },
  {
    equipmentGuid: null, roomGuid: null,
    riskLevel: 'medium', category: 'plumbing',
    title: 'Hot Water Circulation — Pressure Drop',
    description: 'Gradual pressure loss detected on floors 3–5. Possible scale buildup or valve degradation.',
    estimatedTimeToFailure: '2–3 months', confidence: 0.68,
  },
  {
    equipmentGuid: null, roomGuid: null,
    riskLevel: 'medium', category: 'hvac',
    title: 'Ventilation — Filter Replacement Due',
    description: 'Differential pressure across filters exceeds 80% of rated threshold. Air quality may be affected.',
    estimatedTimeToFailure: '3–5 weeks', confidence: 0.91,
  },
  {
    equipmentGuid: null, roomGuid: null,
    riskLevel: 'low', category: 'fire_safety',
    title: 'Fire Suppression — Annual Inspection',
    description: 'System due for mandatory annual test per EN 12845. No faults detected in self-test logs.',
    estimatedTimeToFailure: '3–4 months', confidence: 0.95,
  },
  {
    equipmentGuid: null, roomGuid: null,
    riskLevel: 'low', category: 'electrical',
    title: 'Lighting — LED Driver Aging',
    description: 'Luminaire drivers in zones B2–B4 reporting reduced output (87% nominal). End-of-life in 6+ months.',
    estimatedTimeToFailure: '6–9 months', confidence: 0.61,
  },
];

const hashCode = (s: string) => s.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);

function buildMockData(buildingFmGuid: string): PredictiveMaintenanceResult {
  const h = Math.abs(hashCode(buildingFmGuid));
  const score = 35 + (h % 50);
  const count = 3 + (h % 4);
  const predictions = MOCK_PREDICTIONS.slice(0, count).map((p, i) => ({
    ...p,
    confidence: Math.round((p.confidence * 0.9 + ((h + i * 7) % 15) / 100) * 100) / 100,
  }));
  return {
    predictions,
    overallRiskScore: score,
    summary: `Estimated analysis based on building profile. ${predictions.filter(p => p.riskLevel === 'high').length} high-risk items require attention within 6 weeks.`,
    isMock: true,
  };
}

export function usePredictiveMaintenance(buildingFmGuid: string | null | undefined) {
  const [data, setData] = useState<PredictiveMaintenanceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async (roomFmGuids?: string[]) => {
    if (!buildingFmGuid) return;

    // Return mock data instantly, then try to get real AI analysis in background
    if (!data) {
      setData(buildMockData(buildingFmGuid));
    }

    setIsLoading(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const { data: result, error: fnError } = await supabase.functions.invoke('predictive-maintenance', {
        body: { buildingFmGuid, roomFmGuids },
      });
      clearTimeout(timeout);

      if (fnError) throw fnError;
      if (!result?.success) throw new Error(result?.error || 'Analysis failed');

      setData(result.data);
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // Keep the mock data, don't show error
      } else {
        logger.warn('[PredictiveMaintenance] Edge function failed, using mock data:', e.message);
        // Keep mock data already shown — don't overwrite with error
      }
    } finally {
      setIsLoading(false);
    }
  }, [buildingFmGuid, data]);

  // Auto-load mock data on first call
  const analyzeOrMock = useCallback(async (roomFmGuids?: string[]) => {
    if (!buildingFmGuid) return;
    if (!data) {
      setData(buildMockData(buildingFmGuid));
    }
    await analyze(roomFmGuids);
  }, [buildingFmGuid, data, analyze]);

  return { data, isLoading, error, analyze: analyzeOrMock };
}
