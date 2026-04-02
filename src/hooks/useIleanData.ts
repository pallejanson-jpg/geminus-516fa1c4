import { useState, useEffect, useContext, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppContext } from '@/context/AppContext';

import { on } from '@/lib/event-bus';
export interface IleanMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  documentCount?: number;
}

export interface IleanContextEntity {
  entityName: string | null;
  entityType: 'building' | 'floor' | 'room' | null;
  pk: number | null;
  dashboardUrl: string | null;
}

/**
 * Hook that provides Ilean document Q&A chat functionality.
 * Proxies questions to Senslinc's Ilean API via senslinc-query edge function.
 */
export function useIleanData() {
  const { selectedFacility } = useContext(AppContext);
  const [contextFmGuid, setContextFmGuid] = useState<string | null>(null);
  const [contextLevel, setContextLevel] = useState<'building' | 'floor' | 'room'>('building');
  const [entityInfo, setEntityInfo] = useState<IleanContextEntity>({
    entityName: null, entityType: null, pk: null, dashboardUrl: null,
  });
  const [messages, setMessages] = useState<IleanMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolvingContext, setIsResolvingContext] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Track floor/room selection from viewer events
  useEffect(() => {
    const handleFloorChange = (detail: any) => {
      if (detail?.floorId && detail.isSoloFloor) {
        setContextFmGuid(detail.floorId);
        setContextLevel('floor');
      } else if (selectedFacility) {
        setContextFmGuid((selectedFacility as any).fmGuid || (selectedFacility as any).fm_guid || null);
        setContextLevel('building');
      }
    };

    const handleViewerContext = (detail: any) => {
      if (detail?.selectedFmGuids?.length > 0) {
        setContextFmGuid(detail.selectedFmGuids[0]);
        setContextLevel('room');
      }
    };

    const offHandleFloorChange = on('FLOOR_SELECTION_CHANGED', handleFloorChange);
    const offHandleViewerContext = on('VIEWER_CONTEXT_CHANGED', handleViewerContext);
    return () => {
      offHandleFloorChange();
      offHandleViewerContext();
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
        } else {
          setEntityInfo({
            entityName: result.data.entityName || null,
            entityType: result.data.entityType || null,
            pk: result.data.pk || null,
            dashboardUrl: result.data.dashboardUrl || null,
          });
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

  // Send a message to Ilean
  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || isLoading) return;

    const userMsg: IleanMessage = { role: 'user', content: question.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      const { data: result, error } = await supabase.functions.invoke('senslinc-query', {
        body: {
          action: 'ilean-ask',
          fmGuid: contextFmGuid,
          contextLevel,
          question: question.trim(),
          conversationHistory: updatedMessages.slice(-10), // last 10 messages for context
        },
      });

      if (error) throw new Error(error.message || 'Failed to reach Ilean');

      const answer = result?.data?.answer || result?.error || 'No response from Ilean.';
      const sources = result?.data?.sources as string[] | undefined;
      const documentCount = result?.data?.documentCount as number | undefined;
      const assistantMsg: IleanMessage = { role: 'assistant', content: answer, sources, documentCount };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: IleanMessage = {
        role: 'assistant',
        content: `Sorry, I couldn't get an answer: ${err.message}`,
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, contextFmGuid, contextLevel]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const setRoomContext = (roomFmGuid: string) => {
    setContextFmGuid(roomFmGuid);
    setContextLevel('room');
  };

  const isContextAvailable = !!(contextFmGuid && entityInfo.pk);

  return {
    messages,
    sendMessage,
    clearMessages,
    isLoading: isLoading || isResolvingContext,
    isSending: isLoading,
    contextEntity: entityInfo,
    contextLevel,
    contextFmGuid,
    setRoomContext,
    isContextAvailable,
  };
}
