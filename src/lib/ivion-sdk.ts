/**
 * NavVis IVION Frontend API - Type definitions and dynamic loader.
 * 
 * The SDK renders the 360° viewer natively in a <div>/<ivion> element,
 * providing full programmatic control vs the limited iframe approach.
 * 
 * @see https://ivion-api.docs.navvis.com
 */

export interface IvionVector3 {
  x: number;
  y: number;
  z: number;
}

export interface IvionQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface IvionViewDir {
  lon: number; // radians
  lat: number; // radians
}

export interface IvionImage {
  id: number;
  location: IvionVector3;
  orientation?: IvionQuaternion;
  datasetId?: number;
  datasetLocation?: IvionVector3;
  datasetOrientation?: IvionQuaternion;
}

export interface IvionMainView {
  /** Get currently active image (position in local/site coordinates) */
  getImage(): IvionImage | null;
  /** Current viewing direction in radians (lon = yaw, lat = pitch) */
  currViewingDir: IvionViewDir;
  /** Update camera orientation */
  updateOrientation?(dir: Partial<IvionViewDir>): void;
}

export interface IvionPointOfView {
  /** Subscribe to point-of-view changes */
  onChange?(callback: () => void): (() => void) | void;
  /** Set point of view */
  set?(location: IvionVector3, orientation: IvionQuaternion, fov?: number, imageId?: number): void;
}

export interface IvionAuthApi {
  /** Get current access token */
  getToken(): string;
  /** Update the access token (call before expiry) */
  updateToken(token: string, uploadToken?: string): void;
  /** Login with a JWT token */
  loginWithToken(token: string, awaitDataLoad?: boolean): Promise<any>;
  /** Currently authenticated user */
  currentUser: any;
}

export interface IvionApi {
  /** Get the main panorama view */
  getMainView(): IvionMainView;
  /** Navigate to an image by its ID */
  moveToImageId(imageId: number, viewDir?: IvionViewDir, fov?: number): Promise<void>;
  /** Navigate to a geographic or local position */
  moveToGeoLocation(
    loc: IvionVector3,
    isLocal: boolean,
    viewDir?: IvionViewDir,
    fixedLat?: number,
    fov?: number,
    normal?: IvionVector3,
    forceLoc?: boolean,
    sameFloor?: boolean,
  ): Promise<void>;
  /** Navigate to an image object */
  moveToImage(image: IvionImage, viewDir?: IvionViewDir, viewDistance?: number, fov?: number): Promise<void>;
  /** Check if licensed */
  isLicensed?(): boolean;
  /** Check if currently moving */
  isMoving?(): boolean;
  /** Point of view interface (events + setter) */
  pov?: IvionPointOfView;
  /** Reset to starting location */
  resetView?(): void;
  /** Get current share URL with position params */
  getShareUrl?(): string;
  /** Authentication API (available when loginToken is used) */
  auth?: IvionAuthApi;
}

/** Load status for the SDK */
export type IvionSdkStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Dynamically load the NavVis IVION SDK from an instance URL.
 * 
 * The SDK must be loaded from the Ivion instance itself (e.g., https://swg.iv.navvis.com).
 * This requires proper CORS configuration on the Ivion instance to allow our domain.
 * 
 * @param baseUrl - Base URL of the Ivion instance (no trailing slash)
 * @param timeoutMs - Maximum time to wait for SDK load (default 10s)
 * @param loginToken - Optional JWT token for automatic authentication
 * @returns Promise resolving to the Ivion API interface
 */
export function loadIvionSdk(baseUrl: string, timeoutMs: number = 10000, loginToken?: string): Promise<IvionApi> {
  return new Promise((resolve, reject) => {
    let settled = false;
    
    const settle = (action: 'resolve' | 'reject', value: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (action === 'resolve') resolve(value);
      else reject(value);
    };

    // Build config object for getApi
    const sdkConfig: Record<string, any> = {};
    if (loginToken) {
      sdkConfig.loginToken = loginToken;
      console.log('[Ivion SDK] Using loginToken for auto-authentication');
    }

    // Check if already loaded from a previous mount
    const existingGetApi = (window as any).NavVis?.getApi || (window as any).getApi;
    if (existingGetApi) {
      console.log('[Ivion SDK] getApi already available, initializing...');
      existingGetApi(baseUrl, Object.keys(sdkConfig).length > 0 ? sdkConfig : undefined)
        .then((iv: IvionApi) => {
          console.log('[Ivion SDK] Initialized from existing global');
          settle('resolve', iv);
        })
        .catch((err: any) => {
          console.error('[Ivion SDK] Failed to initialize from existing global:', err);
          settle('reject', err);
        });
      return;
    }

    // Create and load the script
    const script = document.createElement('script');
    script.src = `${baseUrl}/ivion.js`;
    script.async = true;
    script.id = `navvis-ivion-sdk-${Date.now()}`; // Unique ID to avoid conflicts

    const timeout = setTimeout(() => {
      console.warn('[Ivion SDK] Load timeout after', timeoutMs, 'ms');
      settle('reject', new Error(`SDK load timeout after ${timeoutMs}ms`));
      cleanup();
    }, timeoutMs);

    const cleanup = () => {
      try {
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
    };

    const handleError = () => {
      console.warn('[Ivion SDK] Script load failed (likely CORS or network issue)');
      settle('reject', new Error('Failed to load ivion.js - CORS or network error'));
      cleanup();
    };

    // Use both onerror and addEventListener for maximum compatibility
    script.onerror = handleError;
    script.addEventListener('error', handleError);

    script.onload = () => {
      const getApi = (window as any).NavVis?.getApi || (window as any).getApi;
      if (!getApi) {
        console.error('[Ivion SDK] Script loaded but getApi not found on window');
        settle('reject', new Error('getApi function not found after script load'));
        return;
      }

      console.log('[Ivion SDK] Script loaded, calling getApi()...');
      
      getApi(baseUrl, Object.keys(sdkConfig).length > 0 ? sdkConfig : undefined)
        .then((iv: IvionApi) => {
          console.log('[Ivion SDK] ✅ API ready');
          settle('resolve', iv);
        })
        .catch((err: any) => {
          console.error('[Ivion SDK] getApi() failed:', err);
          settle('reject', err);
        });
    };

    document.head.appendChild(script);
  });
}

/**
 * Create the <ivion> custom element that the SDK renders into.
 * Must be in the DOM before calling getApi().
 */
export function createIvionElement(container: HTMLElement): HTMLElement {
  const ivionEl = document.createElement('ivion');
  ivionEl.style.width = '100%';
  ivionEl.style.height = '100%';
  ivionEl.style.display = 'block';
  ivionEl.style.position = 'relative';
  container.appendChild(ivionEl);
  return ivionEl;
}

/**
 * Remove the <ivion> element and clean up.
 */
export function destroyIvionElement(container: HTMLElement, element: HTMLElement): void {
  try {
    if (container.contains(element)) {
      container.removeChild(element);
    }
  } catch (e) {
    console.warn('[Ivion SDK] Cleanup error:', e);
  }
}
