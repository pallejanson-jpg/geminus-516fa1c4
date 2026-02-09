/**
 * Type declarations for the NavVis IVION Frontend API.
 * 
 * The SDK is loaded as a local UMD bundle from /lib/ivion/api.js
 * which exports to window.IvApi (self.IvApi in UMD terms).
 * 
 * The primary TypeScript types are defined in src/lib/ivion-sdk.ts.
 * Full SDK type definitions are available in public/lib/ivion/api.d.ts.
 */

/** Augment the global Window to include IvApi from the UMD bundle */
interface Window {
  IvApi?: {
    getApi(baseUrl: string, config?: Record<string, any>): Promise<any>;
    CustomLayer?: any;
    BlendingMode?: any;
  };
  /** Legacy globals set by older NavVis loaders */
  IV?: {
    getApi?(baseUrl: string, config?: Record<string, any>): Promise<any>;
    loaded?(cb: () => void): void;
    ApiService?: any;
    FeaturesService?: any;
  };
  Ivion?: new (config: any) => any;
}
