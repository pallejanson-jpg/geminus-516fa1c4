/**
 * ACC XKT Converter Service
 * 
 * Handles client-side conversion of Model Derivative output (OBJ/glTF) to XKT format
 * for display in the xeokit-based 3D viewer.
 * 
 * Pipeline:
 * 1. Trigger translation via edge function (RVT -> SVF2)
 * 2. Poll for completion
 * 3. Download derivative via edge function -> storage
 * 4. (Future) Convert to XKT client-side using @xeokit/xeokit-convert
 * 5. Store XKT in xkt-models bucket
 */

import { supabase } from '@/integrations/supabase/client';
import { xktCacheService } from './xkt-cache-service';

export interface TranslationStatus {
  status: 'idle' | 'pending' | 'inprogress' | 'success' | 'failed' | 'downloading' | 'converting' | 'complete';
  progress?: string;
  message?: string;
  error?: string;
  derivativeCount?: number;
  downloadUrl?: string;
}

export class AccXktConverter {
  private static instance: AccXktConverter;
  private pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  private constructor() {}

  static getInstance(): AccXktConverter {
    if (!AccXktConverter.instance) {
      AccXktConverter.instance = new AccXktConverter();
    }
    return AccXktConverter.instance;
  }

  /**
   * Start the full translation pipeline for a BIM file
   */
  async startTranslation(
    versionUrn: string,
    options: {
      buildingFmGuid?: string;
      folderId?: string;
      fileName?: string;
      region?: string;
    } = {}
  ): Promise<TranslationStatus> {
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: {
          action: 'translate-model',
          versionUrn,
          buildingFmGuid: options.buildingFmGuid,
          folderId: options.folderId,
          fileName: options.fileName,
          region: options.region,
        },
      });

      if (error) throw error;

      if (data?.alreadyDone) {
        return { status: 'success', message: data.message };
      }

      return {
        status: data?.status === 'success' ? 'success' : 'pending',
        message: data?.message || 'Översättning startad',
      };
    } catch (e: any) {
      return { status: 'failed', error: e.message };
    }
  }

  /**
   * Check translation status
   */
  async checkTranslation(versionUrn: string): Promise<TranslationStatus> {
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: { action: 'check-translation', versionUrn },
      });

      if (error) throw error;

      return {
        status: data?.status || 'pending',
        progress: data?.progress,
        derivativeCount: data?.derivativeCount,
        message: data?.status === 'success'
          ? `Översättning klar (${data?.derivativeCount || 0} derivatives)`
          : data?.status === 'inprogress'
            ? `Översätter... ${data?.progress || ''}`
            : undefined,
      };
    } catch (e: any) {
      return { status: 'failed', error: e.message };
    }
  }

  /**
   * Download derivative to storage
   */
  async downloadDerivative(
    versionUrn: string,
    options: {
      buildingFmGuid?: string;
      fileName?: string;
      derivativeUrn?: string;
    } = {}
  ): Promise<TranslationStatus> {
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: {
          action: 'download-derivative',
          versionUrn,
          buildingFmGuid: options.buildingFmGuid,
          fileName: options.fileName,
          derivativeUrn: options.derivativeUrn,
        },
      });

      if (error) throw error;

      if (data?.success) {
        return {
          status: 'complete',
          downloadUrl: data.downloadUrl,
          message: data.message,
        };
      }

      return { status: 'failed', error: data?.error || 'Download failed' };
    } catch (e: any) {
      return { status: 'failed', error: e.message };
    }
  }

  /**
   * Start polling for translation completion
   * Returns a cleanup function
   */
  startPolling(
    versionUrn: string,
    onStatusChange: (status: TranslationStatus) => void,
    intervalMs: number = 5000
  ): () => void {
    // Clear existing poll for this URN
    this.stopPolling(versionUrn);

    const poll = async () => {
      const status = await this.checkTranslation(versionUrn);
      onStatusChange(status);

      if (status.status === 'success' || status.status === 'failed') {
        this.stopPolling(versionUrn);
      }
    };

    // Immediate first check
    poll();

    const interval = setInterval(poll, intervalMs);
    this.pollingIntervals.set(versionUrn, interval);

    return () => this.stopPolling(versionUrn);
  }

  /**
   * Stop polling for a specific URN
   */
  stopPolling(versionUrn: string) {
    const interval = this.pollingIntervals.get(versionUrn);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(versionUrn);
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling() {
    for (const [, interval] of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
  }

  /**
   * Full pipeline: translate -> poll -> download
   */
  async runFullPipeline(
    versionUrn: string,
    options: {
      buildingFmGuid?: string;
      folderId?: string;
      fileName?: string;
      region?: string;
    },
    onStatusChange: (status: TranslationStatus) => void
  ): Promise<TranslationStatus> {
    // Step 1: Start translation
    onStatusChange({ status: 'pending', message: 'Startar översättning...' });
    const startResult = await this.startTranslation(versionUrn, options);
    
    if (startResult.status === 'failed') {
      onStatusChange(startResult);
      return startResult;
    }

    if (startResult.status === 'success') {
      // Already done, skip to download
      onStatusChange({ status: 'downloading', message: 'Laddar ner geometri...' });
      const dlResult = await this.downloadDerivative(versionUrn, options);
      onStatusChange(dlResult);
      return dlResult;
    }

    // Step 2: Poll for completion
    return new Promise((resolve) => {
      this.startPolling(versionUrn, async (status) => {
        onStatusChange(status);

        if (status.status === 'success') {
          // Step 3: Download derivative
          onStatusChange({ status: 'downloading', message: 'Laddar ner geometri...' });
          const dlResult = await this.downloadDerivative(versionUrn, options);
          onStatusChange(dlResult);
          resolve(dlResult);
        } else if (status.status === 'failed') {
          resolve(status);
        }
      }, 8000); // Poll every 8 seconds
    });
  }
}

export const accXktConverter = AccXktConverter.getInstance();
