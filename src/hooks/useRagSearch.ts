import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface RagSearchResult {
  id: string;
  content: string;
  fileName: string;
  sourceType: string;
  buildingFmGuid: string | null;
}

export interface RagSearchResponse {
  results: RagSearchResult[];
  answer: string;
  sources: string[];
  confidence: number;
  query: string;
  keywords: string[];
}

export function useRagSearch() {
  const [data, setData] = useState<RagSearchResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string, options?: { buildingFmGuid?: string; sourceType?: string; topK?: number }) => {
    if (!query.trim()) return;
    setIsLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await supabase.functions.invoke('rag-search', {
        body: { query, ...options },
      });

      if (fnError) throw fnError;
      if (!result?.success) throw new Error(result?.error || 'Search failed');

      setData(result.data);
    } catch (e: any) {
      console.error('[RagSearch] Error:', e);
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { data, isLoading, error, search };
}
