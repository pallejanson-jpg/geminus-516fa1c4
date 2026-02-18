import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { generateMockSensorData } from '@/lib/visualization-utils';

export interface SenslincTimePoint {
  date: string; // ISO date string e.g. "2026-02-11"
  temperature: number | null;
  co2: number | null;
  humidity: number | null;
  occupancy: number | null;
}

export interface SenslincCurrentValues {
  temperature: number | null;
  co2: number | null;
  humidity: number | null;
  occupancy: number | null;
}

export interface SenslincMachineData {
  machinePk: number;
  machineName: string;
  dashboardUrl: string;
  current: SenslincCurrentValues;
  timeSeries: SenslincTimePoint[];
  availableFields: string[];
}

// Parse Elasticsearch aggregation bucket response into usable time series
function parseTimeSeries(esData: any): SenslincTimePoint[] {
  if (!esData?.aggregations?.per_day?.buckets) return [];
  return esData.aggregations.per_day.buckets.map((bucket: any) => ({
    date: bucket.key_as_string?.substring(0, 10) ?? new Date(bucket.key).toISOString().substring(0, 10),
    temperature: bucket.avg_temp?.value ?? null,
    co2: bucket.avg_co2?.value ?? null,
    humidity: bucket.avg_humidity?.value ?? null,
    occupancy: bucket.avg_occupancy?.value ?? null,
  }));
}

// Derive current values as the latest non-null reading from time series
function deriveCurrentValues(timeSeries: SenslincTimePoint[], latestValues: any): SenslincCurrentValues {
  // If the machine has latest_values directly, prefer those
  if (latestValues) {
    return {
      temperature: latestValues.temperature ?? null,
      co2: latestValues.co2 ?? null,
      humidity: latestValues.humidity ?? null,
      occupancy: latestValues.occupancy ?? null,
    };
  }

  // Otherwise use the last non-null entry from time series
  const result: SenslincCurrentValues = { temperature: null, co2: null, humidity: null, occupancy: null };
  for (let i = timeSeries.length - 1; i >= 0; i--) {
    const pt = timeSeries[i];
    if (result.temperature === null && pt.temperature !== null) result.temperature = pt.temperature;
    if (result.co2 === null && pt.co2 !== null) result.co2 = pt.co2;
    if (result.humidity === null && pt.humidity !== null) result.humidity = pt.humidity;
    if (result.occupancy === null && pt.occupancy !== null) result.occupancy = pt.occupancy;
    if (result.temperature !== null && result.co2 !== null && result.humidity !== null && result.occupancy !== null) break;
  }
  return result;
}

// Detect which fields actually have data
function detectAvailableFields(timeSeries: SenslincTimePoint[], properties: any[]): string[] {
  const fromTimeSeries = new Set<string>();
  timeSeries.forEach(pt => {
    if (pt.temperature !== null) fromTimeSeries.add('temperature');
    if (pt.co2 !== null) fromTimeSeries.add('co2');
    if (pt.humidity !== null) fromTimeSeries.add('humidity');
    if (pt.occupancy !== null) fromTimeSeries.add('occupancy');
  });

  // If time series is empty, look at property names from API
  if (fromTimeSeries.size === 0 && Array.isArray(properties)) {
    properties.forEach((p: any) => {
      const name = (p.name || p.field_name || '').toLowerCase();
      if (name.includes('temp')) fromTimeSeries.add('temperature');
      if (name.includes('co2')) fromTimeSeries.add('co2');
      if (name.includes('hum')) fromTimeSeries.add('humidity');
      if (name.includes('occup')) fromTimeSeries.add('occupancy');
    });
  }

  return Array.from(fromTimeSeries);
}

// Generate plausible mock time-series for a room
function generateMockTimeSeries(fmGuid: string, days = 7): SenslincTimePoint[] {
  const hash = fmGuid.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const pts: SenslincTimePoint[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const seed = (hash + i * 137) % 233280 / 233280;
    pts.push({
      date: d.toISOString().substring(0, 10),
      temperature: 18 + seed * 8,
      co2: 400 + seed * 800,
      humidity: 30 + seed * 40,
      occupancy: Math.round(seed * 100),
    });
  }
  return pts;
}

// ── Main hook ──
export function useSenslincData(fmGuid: string | null | undefined) {
  const [data, setData] = useState<SenslincMachineData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!fmGuid) {
      setData(null);
      setIsLive(false);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    supabase.functions
      .invoke('senslinc-query', {
        body: { action: 'get-machine-data', fmGuid, days: 7 },
      })
      .then(({ data: result, error: fnError }) => {
        if (abortRef.current?.signal.aborted) return;

        if (fnError || !result?.success) {
          console.warn('[useSenslincData] Using mock data for', fmGuid, fnError || result?.error);
          // Graceful mock fallback
          const mockTs = generateMockTimeSeries(fmGuid);
          setData({
            machinePk: 0,
            machineName: 'Sensor (Demo)',
            dashboardUrl: '',
            current: deriveCurrentValues(mockTs, null),
            timeSeries: mockTs,
            availableFields: ['temperature', 'co2', 'humidity'],
          });
          setIsLive(false);
          setError(fnError?.message ?? result?.error ?? 'Senslinc not available');
        } else {
          const { machine, dashboardUrl, properties, timeSeries: esData } = result.data;
          const timeSeries = parseTimeSeries(esData);
          const availableFields = detectAvailableFields(timeSeries, properties);

          // If no time series data but we have machine, still show with mock trend
          const finalTimeSeries = timeSeries.length > 0 ? timeSeries : generateMockTimeSeries(fmGuid);
          const finalFields = availableFields.length > 0 ? availableFields : ['temperature', 'co2', 'humidity'];

          setData({
            machinePk: machine.pk,
            machineName: machine.name || fmGuid,
            dashboardUrl: dashboardUrl || '',
            current: deriveCurrentValues(timeSeries, machine.latest_values),
            timeSeries: finalTimeSeries,
            availableFields: finalFields,
          });
          setIsLive(timeSeries.length > 0);
        }
        setIsLoading(false);
      })
      .catch(err => {
        if (abortRef.current?.signal.aborted) return;
        console.error('[useSenslincData] Unexpected error:', err);
        const mockTs = generateMockTimeSeries(fmGuid);
        setData({
          machinePk: 0,
          machineName: 'Sensor (Demo)',
          dashboardUrl: '',
          current: deriveCurrentValues(mockTs, null),
          timeSeries: mockTs,
          availableFields: ['temperature', 'co2', 'humidity'],
        });
        setIsLive(false);
        setError(err.message);
        setIsLoading(false);
      });

    return () => { abortRef.current?.abort(); };
  }, [fmGuid]);

  return { data, isLoading, isLive, error };
}

// ── Hook for building-level aggregate data ──
export interface SenslincBuildingData {
  siteName: string;
  siteDashboardUrl: string;
  machines: Array<{
    pk: number;
    code: string;
    name: string;
    dashboard_url: string;
    latest_values: any;
  }>;
}

export function useSenslincBuildingData(buildingFmGuid: string | null | undefined) {
  const [data, setData] = useState<SenslincBuildingData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!buildingFmGuid) { setData(null); return; }
    setIsLoading(true);
    setError(null);

    supabase.functions
      .invoke('senslinc-query', {
        body: { action: 'get-building-sensor-data', fmGuid: buildingFmGuid },
      })
      .then(({ data: result, error: fnError }) => {
        if (fnError || !result?.success) {
          setError(fnError?.message ?? result?.error ?? 'No Senslinc data for this building');
          setIsLive(false);
        } else {
          setData({
            siteName: result.data.site.name,
            siteDashboardUrl: result.data.site.dashboard_url,
            machines: result.data.machines,
          });
          setIsLive(true);
        }
        setIsLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setIsLive(false);
        setIsLoading(false);
      });
  }, [buildingFmGuid]);

  return { data, isLoading, isLive, error };
}
