/**
 * Shared hook for Ivion SDK lifecycle management.
 * 
 * Consolidates the duplicated SDK loading, token refresh, and cleanup
 * logic from VirtualTwin.tsx and Ivion360View.tsx into a single hook.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { loadIvionSdk, createIvionElement, destroyIvionElement, type IvionApi, type IvionSdkStatus } from '@/lib/ivion-sdk';

interface UseIvionSdkOptions {
  /** Base URL of the Ivion instance (origin only) */
  baseUrl: string;
  /** Ivion site ID */
  siteId: string;
  /** Building FM GUID (for token fetch) */
  buildingFmGuid: string;
  /** Container ref where the <ivion> element is created */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether SDK loading is enabled */
  enabled: boolean;
}

interface UseIvionSdkResult {
  /** Current SDK status */
  sdkStatus: IvionSdkStatus;
  /** Reference to the Ivion API */
  ivApiRef: React.MutableRefObject<IvionApi | null>;
  /** Retry loading the SDK */
  retry: () => void;
}

/**
 * Manages the Ivion SDK lifecycle: load, authenticate, refresh tokens, cleanup.
 */
export function useIvionSdk({
  baseUrl,
  siteId,
  buildingFmGuid,
  containerRef,
  enabled,
}: UseIvionSdkOptions): UseIvionSdkResult {
  const [sdkStatus, setSdkStatus] = useState<IvionSdkStatus>('idle');
  const [retryKey, setRetryKey] = useState(0);
  const ivApiRef = useRef<IvionApi | null>(null);
  const ivionElementRef = useRef<HTMLElement | null>(null);

  // Fetch login token from backend
  const fetchLoginToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: { action: 'get-login-token', buildingFmGuid },
      });
      if (error || !data?.success) {
        console.warn('[useIvionSdk] Failed to fetch loginToken:', error || data?.error);
        return null;
      }
      console.log('[useIvionSdk] loginToken obtained');
      return data.loginToken;
    } catch (e) {
      console.warn('[useIvionSdk] loginToken fetch error:', e);
      return null;
    }
  }, [buildingFmGuid]);

  // SDK loading effect
  useEffect(() => {
    if (!enabled || !baseUrl || !siteId) {
      setSdkStatus('idle');
      return;
    }

    let cancelled = false;

    const tryLoadSdk = async () => {
      setSdkStatus('loading');

      try {
        // Step 1: Fetch login token
        const loginToken = await fetchLoginToken();
        if (cancelled) return;

        if (!loginToken) {
          console.error('[useIvionSdk] No loginToken available - cannot authenticate with Ivion');
          if (!cancelled) setSdkStatus('failed');
          return;
        }
        console.log('[useIvionSdk] Will use loginToken for auto-auth');

        // Step 2: Create <ivion> element in container
        if (containerRef.current && !ivionElementRef.current) {
          ivionElementRef.current = createIvionElement(containerRef.current);
        }

        // Step 3: Load SDK
        const cleanBaseUrl = baseUrl.replace(/\/$/, '');
        console.log('[useIvionSdk] Loading SDK from:', cleanBaseUrl, 'site:', siteId);

        const api = await loadIvionSdk(cleanBaseUrl, 45000, loginToken || undefined, siteId);
        if (cancelled) return;

        ivApiRef.current = api;
        setSdkStatus('ready');
        console.log('[useIvionSdk] ✅ SDK ready');
      } catch (err) {
        console.error('[useIvionSdk] SDK load failed:', err);
        if (!cancelled) {
          setSdkStatus('failed');
          // Clean up element on failure
          if (containerRef.current && ivionElementRef.current) {
            destroyIvionElement(containerRef.current, ivionElementRef.current);
            ivionElementRef.current = null;
          }
        }
      }
    };

    tryLoadSdk();

    return () => {
      cancelled = true;
      if (containerRef.current && ivionElementRef.current) {
        destroyIvionElement(containerRef.current, ivionElementRef.current);
        ivionElementRef.current = null;
      }
      ivApiRef.current = null;
      setSdkStatus('idle');
    };
  }, [enabled, baseUrl, siteId, retryKey, fetchLoginToken, containerRef]);

  // Token refresh loop (every 10 minutes)
  useEffect(() => {
    if (sdkStatus !== 'ready' || !ivApiRef.current?.auth) return;

    const refreshToken = async () => {
      try {
        const newToken = await fetchLoginToken();
        if (newToken && ivApiRef.current?.auth) {
          ivApiRef.current.auth.updateToken(newToken);
          console.log('[useIvionSdk] Token refreshed');
        }
      } catch (e) {
        console.warn('[useIvionSdk] Token refresh failed:', e);
      }
    };

    const interval = setInterval(refreshToken, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [sdkStatus, fetchLoginToken]);

  // Retry handler
  const retry = useCallback(() => {
    ivApiRef.current = null;
    if (containerRef.current && ivionElementRef.current) {
      destroyIvionElement(containerRef.current, ivionElementRef.current);
      ivionElementRef.current = null;
    }
    setRetryKey(k => k + 1);
  }, [containerRef]);

  return { sdkStatus, ivApiRef, retry };
}
