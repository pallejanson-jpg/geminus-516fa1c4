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
 * Dynamically load the NavVis IVION SDK.
 * 
 * This attempts to import getApi from the @navvis/ivion npm package.
 * If the package is installed (via .tgz), it initializes the SDK directly.
 * If not installed, it rejects so the caller can fall back to iframe mode.
 * 
 * @param baseUrl - Base URL of the Ivion instance (no trailing slash)
 * @param timeoutMs - Maximum time to wait for SDK initialization (default 10s)
 * @param loginToken - Optional JWT token for automatic authentication
 * @returns Promise resolving to the Ivion API interface
 */
export async function loadIvionSdk(baseUrl: string, timeoutMs: number = 10000, loginToken?: string): Promise<IvionApi> {
  // Build config object for getApi
  const sdkConfig: Record<string, any> = {};
  if (loginToken) {
    sdkConfig.loginToken = loginToken;
    console.log('[Ivion SDK] Using loginToken for auto-authentication');
  }

  // Try to dynamically import the @navvis/ivion npm package
  let getApi: ((baseUrl: string, config?: any) => Promise<IvionApi>) | null = null;

  try {
    // Use a variable to prevent bundler from statically analyzing the import
    const moduleName = '@navvis/ivion';
    const ivionModule = await import(/* @vite-ignore */ moduleName);
    getApi = ivionModule.getApi || ivionModule.default?.getApi;
    console.log('[Ivion SDK] @navvis/ivion npm package loaded successfully');
  } catch {
    console.log('[Ivion SDK] @navvis/ivion npm package not installed');
    console.log('[Ivion SDK] To enable SDK mode, download the .tgz from NavVis Knowledge Base');
    console.log('[Ivion SDK] and add "@navvis/ivion": "file:navvis-ivion-X.X.X.tgz" to package.json');
    throw new Error(
      'NavVis SDK not available. Install @navvis/ivion npm package (.tgz from NavVis Knowledge Base) for SDK mode.'
    );
  }

  if (!getApi) {
    throw new Error('NavVis SDK package found but getApi export is missing. Check package version.');
  }

  // Initialize with timeout
  const config = Object.keys(sdkConfig).length > 0 ? sdkConfig : undefined;
  
  const apiPromise = getApi(baseUrl, config);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Ivion SDK initialization timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  const iv = await Promise.race([apiPromise, timeoutPromise]);
  console.log('[Ivion SDK] Initialized successfully via @navvis/ivion package');
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
