import { useState, useEffect, useContext, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppContext } from '@/context/AppContext';
import { useSenslincData, type SenslincMachineData } from '@/hooks/useSenslincData';

export interface IleanData {
  /** Senslinc entity info */
  entityName: string | null;
  entityType: 'building' | 'floor' | 'room' | null;
  pk: number | null;
  /** External dashboard URL (for "Open in Senslinc" button) */
  dashboardUrl: string | null;
  /** Sensor data from useSenslincData */
  sensorData: SenslincMachineData | null;
  /** Whether sensor data is live */
  isLive: boolean;
}

/**
 * Hook that provides Ilean contextual data natively —
 * no iframe needed. Uses Senslinc APIs to fetch sensor data
 * for the current building/floor/room context.
 */
export function useIleanData() {
  const { selectedFacility } = useContext(AppContext);
  const [contextFmGuid, setContextFmGuid] = useState<string | null>(null);
  const [contextLevel, setContextLevel] = useState<'building' | 'floor' | 'room'>('building');
  const [entityInfo, setEntityInfo] = useState<{
    entityName: string | null;
    entityType: 'building' | 'floor' | 'room' | null;
    pk: number | null;
    dashboardUrl: string | null;
  }>({ entityName: null, entityType: null, pk: null, dashboardUrl: null });
  const [isResolvingContext, setIsResolvingContext] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // For room-level, we fetch sensor data using the machine fmGuid
  const [machineFmGuid, setMachineFmGuid] = useState<string | null>(null);
  const { data: sensorData, isLoading: sensorLoading, isLive } = useSenslincData(machineFmGuid);

  // Track floor/room selection from viewer events
  useEffect(() => {
    const handleFloorChange = (e: CustomEvent) => {
      const detail = e.detail;
      if (detail?.floorId && detail.isSoloFloor) {
        setContextFmGuid(detail.floorId);
        setContextLevel('floor');
      } else if (selectedFacility) {
        setContextFmGuid((selectedFacility as any).fmGuid || (selectedFacility as any).fm_guid || null);
        setContextLevel('building');
      }
    };

    const handleViewerContext = (e: CustomEvent) => {
      const detail = e.detail;
      if (detail?.selectedFmGuids?.length > 0) {
        setContextFmGuid(detail.selectedFmGuids[0]);
        setContextLevel('room');
      }
    };

    window.addEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
    window.addEventListener('VIEWER_CONTEXT_CHANGED', handleViewerContext as EventListener);
    return () => {
      window.removeEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
      window.removeEventListener('VIEWER_CONTEXT_CHANGED', handleViewerContext as EventListener);
    };
  }, [selectedFacility]);

  // Set building context when facility changes
  useEffect(() => {
    if (selectedFacility) {
      const fmGuid = (selectedFacility as any).fmGuid || (selectedFacility as any).fm_guid;
      if (fmGuid) { setContextFmGuid(fmGuid); setContextLevel('building'); }
    } else {
      setContextFmGuid(null);
    }
  }, [selectedFacility]);

  // Resolve entity info from Senslinc
  useEffect(() => {
    if (!contextFmGuid) {
      setEntityInfo({ entityName: null, entityType: null, pk: null, dashboardUrl: null });
      setMachineFmGuid(null);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const controller = abortRef.current;

    setIsResolvingContext(true);

    supabase.functions
      .invoke('senslinc-query', {
        body: { action: 'get-ilean-context', fmGuid: contextFmGuid, contextLevel },
      })
      .then(({ data: result, error }) => {
        if (controller.signal.aborted) return;
        if (error || !result?.success) {
          setEntityInfo({ entityName: null, entityType: null, pk: null, dashboardUrl: null });
          // Still try to use fmGuid for sensor data at room level
          if (contextLevel === 'room') setMachineFmGuid(contextFmGuid);
          else setMachineFmGuid(null);
        } else {
          setEntityInfo({
            entityName: result.data.entityName || null,
            entityType: result.data.entityType || null,
            pk: result.data.pk || null,
            dashboardUrl: result.data.dashboardUrl || null,
          });
          // If room-level, use fmGuid for sensor data
          if (contextLevel === 'room') setMachineFmGuid(contextFmGuid);
          else setMachineFmGuid(null);
        }
        setIsResolvingContext(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setEntityInfo({ entityName: null, entityType: null, pk: null, dashboardUrl: null });
          setIsResolvingContext(false);
        }
      });

    return () => { controller.abort(); };
  }, [contextFmGuid, contextLevel]);

  const setRoomContext = (roomFmGuid: string) => {
    setContextFmGuid(roomFmGuid);
    setContextLevel('room');
  };

  return {
    data: {
      ...entityInfo,
      sensorData: sensorData || null,
      isLive,
    } as IleanData,
    isLoading: isResolvingContext || sensorLoading,
    contextLevel,
    contextFmGuid,
    setRoomContext,
  };
}
