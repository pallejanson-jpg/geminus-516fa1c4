import { useState, useEffect, useRef, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppContext } from '@/context/AppContext';

export interface IleanContextData {
  ileanUrl: string | null;
  dashboardUrl: string | null;
  entityName: string | null;
  entityType: 'building' | 'floor' | 'room' | null;
  pk: number | null;
}

/**
 * Hook that resolves the Ilean URL based on current navigation context.
 * Listens to AppContext for selectedFacility and viewer events for floor/room.
 */
export function useIleanContext() {
  const { selectedFacility } = useContext(AppContext);
  const [data, setData] = useState<IleanContextData>({
    ileanUrl: null, dashboardUrl: null, entityName: null, entityType: null, pk: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [contextFmGuid, setContextFmGuid] = useState<string | null>(null);
  const [contextLevel, setContextLevel] = useState<'building' | 'floor' | 'room'>('building');
  const abortRef = useRef<AbortController | null>(null);

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

    window.addEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
    return () => window.removeEventListener('FLOOR_SELECTION_CHANGED', handleFloorChange as EventListener);
  }, [selectedFacility]);

  // Set building context when facility changes
  useEffect(() => {
    if (selectedFacility) {
      const fmGuid = (selectedFacility as any).fmGuid || (selectedFacility as any).fm_guid;
      if (fmGuid) {
        setContextFmGuid(fmGuid);
        setContextLevel('building');
      }
    } else {
      setContextFmGuid(null);
    }
  }, [selectedFacility]);

  // Fetch Ilean context when fmGuid/level changes
  useEffect(() => {
    if (!contextFmGuid) {
      setData({ ileanUrl: null, dashboardUrl: null, entityName: null, entityType: null, pk: null });
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const controller = abortRef.current;

    setIsLoading(true);

    supabase.functions
      .invoke('senslinc-query', {
        body: { action: 'get-ilean-context', fmGuid: contextFmGuid, contextLevel },
      })
      .then(({ data: result, error }) => {
        if (controller.signal.aborted) return;
        if (error || !result?.success) {
          setData({ ileanUrl: null, dashboardUrl: null, entityName: null, entityType: null, pk: null });
        } else {
          setData({
            ileanUrl: result.data.ileanUrl || null,
            dashboardUrl: result.data.dashboardUrl || null,
            entityName: result.data.entityName || null,
            entityType: result.data.entityType || null,
            pk: result.data.pk || null,
          });
        }
        setIsLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setData({ ileanUrl: null, dashboardUrl: null, entityName: null, entityType: null, pk: null });
          setIsLoading(false);
        }
      });

    return () => { controller.abort(); };
  }, [contextFmGuid, contextLevel]);

  /**
   * Manually set room context (e.g., from room click in viewer)
   */
  const setRoomContext = (roomFmGuid: string) => {
    setContextFmGuid(roomFmGuid);
    setContextLevel('room');
  };

  return { data, isLoading, contextLevel, setRoomContext };
}
