/**
 * NavVis IVION Frontend API - Type definitions and dynamic loader.
 * 
 * The SDK renders the 360° viewer natively in a <div>/<ivion> element,
 * providing full programmatic control vs the limited iframe approach.
 * 
 * PREFERRED: Install the @navvis/ivion npm package (distributed as .tgz
 * from NavVis Knowledge Base) and this module will import getApi directly.
 * 
 * FALLBACK: If the package is not installed, the caller should use iframe mode.
 * 
 * A CORS proxy edge function (ivion-proxy) is available at:
 *   /functions/v1/ivion-proxy/<path>
 * This can be used to proxy any NavVis asset requests.
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

export interface IvionMenuItem {
  /** Unique key for the menu item */
  key?: string;
  /** Display label */
  label?: string;
  /** Whether the item is visible — can be overridden to hide */
  isVisible?: () => boolean;
  /** Override to control visibility */
  setVisible?: (visible: boolean) => void;
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
  /** Get sidebar menu items for programmatic control */
  getMenuItems?(): IvionMenuItem[];
  /** Close the sidebar menu */
  closeMenu?(): void;
}

/** Load status for the SDK */
export type IvionSdkStatus = 'idle' | 'loading' | 'ready' | 'failed';

type GetApiFn = (baseUrl: string, config?: any) => Promise<IvionApi>;

// Module-level guard against concurrent SDK loads
let activeLoadPromise: Promise<IvionApi> | null = null;

/**
 * Load the getApi bootstrap function from a remote script URL.
 * The NavVis IVION instance (and the CORS proxy) serve ivion.js at the root.
 * After loading, getApi is available on window.IV.getApi (or window.getApi).
 */
function loadGetApiViaScript(scriptUrl: string): Promise<GetApiFn> {
  return new Promise((resolve, reject) => {
    // Check if already loaded from a previous attempt
    const win = window as any;
    const existing: GetApiFn | undefined =
      win.IvApi?.getApi ?? win.IV?.getApi ?? win.ivion?.getApi ?? win.getApi;
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.crossOrigin = 'anonymous';

    const cleanup = () => {
      script.onload = null;
      script.onerror = null;
    };

    script.onload = () => {
      cleanup();
      const fn: GetApiFn | undefined =
        win.IvApi?.getApi ?? win.IV?.getApi ?? win.ivion?.getApi ?? win.getApi;
      if (fn) {
        resolve(fn);
      } else {
        reject(new Error('ivion.js loaded but getApi not found on window'));
      }
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`Failed to load script: ${scriptUrl}`));
    };

    document.head.appendChild(script);
  });
}

/**
 * Dynamically load the NavVis IVION SDK.
 *
 * Loading priority:
 * 1. Try the @navvis/ivion npm package (fastest, preferred if installed)
 * 2. Try loading ivion.js directly from the IVION instance (script tag)
 * 3. Try loading ivion.js through the CORS proxy edge function
 *
 * If all methods fail the caller falls back to iframe mode.
 *
 * @param baseUrl - Base URL of the Ivion instance (no trailing slash)
 * @param timeoutMs - Maximum time to wait for SDK initialization (default 45s)
 * @param loginToken - Optional JWT token for automatic authentication
 * @param siteId - Optional site ID for auto-selection
 * @returns Promise resolving to the Ivion API interface
 */
export async function loadIvionSdk(
  baseUrl: string,
  timeoutMs: number = 45000,
  loginToken?: string,
  siteId?: string,
): Promise<IvionApi> {
  // Guard against concurrent loads — wait for any in-progress attempt
  if (activeLoadPromise) {
    console.log('[Ivion SDK] Another load is in progress, waiting for it…');
    try {
      const result = await activeLoadPromise;
      console.log('[Ivion SDK] Reusing result from concurrent load');
      return result;
    } catch (e) {
      console.log('[Ivion SDK] Concurrent load failed, starting fresh attempt');
      // Fall through to start a new load
    }
  }

  const loadPromise = doLoadIvionSdk(baseUrl, timeoutMs, loginToken, siteId);
  activeLoadPromise = loadPromise;
  
  try {
    const result = await loadPromise;
    return result;
  } finally {
    if (activeLoadPromise === loadPromise) {
      activeLoadPromise = null;
    }
  }
}

async function doLoadIvionSdk(
  baseUrl: string,
  timeoutMs: number,
  loginToken?: string,
  siteId?: string,
): Promise<IvionApi> {
  // Build config object for getApi
  const sdkConfig: Record<string, any> = {};
  if (loginToken) {
    sdkConfig.loginToken = loginToken;
    console.log('[Ivion SDK] Using loginToken for auto-authentication');
  }

  // Also pass siteId in config (future SDK versions may support it)
  if (siteId) {
    sdkConfig.siteId = siteId;
    console.log('[Ivion SDK] Passing siteId in SDK config:', siteId);
  }

  const cleanBaseUrl = baseUrl.replace(/\/$/, '');

  let getApi: GetApiFn | null = null;

  // ── Attempt 1: local SDK bundle (/lib/ivion/api.js) ────────────────
  try {
    getApi = await loadGetApiViaScript('/lib/ivion/api.js');
    console.log('[Ivion SDK] Loaded via local /lib/ivion/api.js');
  } catch (e) {
    console.log('[Ivion SDK] Local SDK not available:', (e as Error).message);
  }

  // ── Attempt 2: script tag from IVION instance ─────────────────────
  if (!getApi) {
    const directUrl = `${cleanBaseUrl}/ivion.js`;
    try {
      getApi = await loadGetApiViaScript(directUrl);
      console.log('[Ivion SDK] Loaded via direct script tag:', directUrl);
    } catch (e) {
      console.log('[Ivion SDK] Direct script-tag failed:', (e as Error).message);
    }
  }

  // ── Attempt 3: script tag through CORS proxy ──────────────────────
  if (!getApi) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (supabaseUrl) {
      const proxyUrl = `${supabaseUrl}/functions/v1/ivion-proxy/ivion.js`;
      try {
        getApi = await loadGetApiViaScript(proxyUrl);
        console.log('[Ivion SDK] Loaded via CORS proxy:', proxyUrl);
      } catch (e) {
        console.log('[Ivion SDK] CORS proxy script-tag failed:', (e as Error).message);
      }
    }
  }

  if (!getApi) {
    throw new Error(
      'NavVis SDK not available. All loading methods failed (npm, direct, proxy).',
    );
  }

  // Wait for <ivion> element to be in the DOM with non-zero dimensions
  const waitForIvionElement = async () => {
    const maxWait = 3000;
    const interval = 100;
    let elapsed = 0;
    while (elapsed < maxWait) {
      const el = document.querySelector('ivion');
      if (el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) {
        console.log('[Ivion SDK] <ivion> element found with dimensions');
        return true;
      }
      await new Promise(r => setTimeout(r, interval));
      elapsed += interval;
    }
    console.warn('[Ivion SDK] <ivion> element not found or has zero dimensions after', maxWait, 'ms');
    return false;
  };

  await waitForIvionElement();

  // Initialize with timeout — pass clean baseUrl (no query params)
  const config = Object.keys(sdkConfig).length > 0 ? sdkConfig : undefined;

  // Temporarily inject ?site= into URL for SDK initialization (SDK reads window.location)
  let urlModified = false;
  let originalUrl = '';
  if (siteId) {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('site')) {
        originalUrl = window.location.href;
        url.searchParams.set('site', siteId);
        window.history.replaceState(null, '', url.toString());
        urlModified = true;
        console.log('[Ivion SDK] Temporarily injected ?site= for getApi()');
      }
    } catch (e) {
      console.warn('[Ivion SDK] Could not inject ?site= param:', e);
    }
  }

  console.log('[Ivion SDK] Calling getApi with baseUrl:', cleanBaseUrl);
  const apiPromise = getApi(cleanBaseUrl, config);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Ivion SDK initialization timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );

  let iv: IvionApi;
  try {
    iv = await Promise.race([apiPromise, timeoutPromise]);
    console.log('[Ivion SDK] Initialized successfully');
  } finally {
    // Always clean up the injected ?site= param immediately
    if (urlModified) {
      try {
        window.history.replaceState(null, '', originalUrl);
        console.log('[Ivion SDK] Cleaned up ?site= from URL');
      } catch (e) {
        console.warn('[Ivion SDK] Failed to clean up ?site= param:', e);
      }
    }
  }

  // ── Auto-navigate to site if siteId provided (API fallback) ──────
  if (siteId) {
    try {
      const siteApi = (iv as any).site;
      if (siteApi?.repository?.findOne && siteApi?.service?.loadSite) {
        // Check if site was already auto-selected via config
        const activeSite = siteApi?.service?.activeSite;
        if (activeSite) {
          console.log('[Ivion SDK] Site already active (selected via config):', siteId);
        } else {
          console.log('[Ivion SDK] Loading site via API:', siteId);
          const site = await siteApi.repository.findOne(Number(siteId));
          if (site) {
            await siteApi.service.loadSite(site);
            console.log('[Ivion SDK] Site loaded successfully:', siteId);
          } else {
            console.warn('[Ivion SDK] Site not found:', siteId);
          }
        }
      } else {
        console.warn('[Ivion SDK] Site API not available on SDK instance');
      }
    } catch (e) {
      console.warn('[Ivion SDK] Failed to auto-load site (user will see site menu):', e);
    }
  }

  // ── Hide sidebar menu items ───────────────────────────────────────
  try {
    const menuItems = iv.getMenuItems?.();
    if (menuItems && Array.isArray(menuItems)) {
      menuItems.forEach(item => {
        if (item.setVisible) {
          item.setVisible(false);
        } else if (item.isVisible) {
          item.isVisible = () => false;
        }
      });
      console.log('[Ivion SDK] Hidden', menuItems.length, 'sidebar menu items');
    }
    iv.closeMenu?.();
  } catch (e) {
    console.debug('[Ivion SDK] Could not hide sidebar items:', e);
  }

  return iv;
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
