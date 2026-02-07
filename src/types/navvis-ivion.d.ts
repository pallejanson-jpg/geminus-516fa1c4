/**
 * Type declarations for the @navvis/ivion npm package.
 * 
 * This package is distributed as a private .tgz from NavVis Knowledge Base
 * and must be installed locally via:
 *   "@navvis/ivion": "file:navvis-ivion-X.X.X.tgz" in package.json
 * 
 * These declarations allow TypeScript to recognize the module even before
 * the package is installed.
 */
declare module '@navvis/ivion' {
  import type { IvionApi } from '@/lib/ivion-sdk';

  /**
   * Initialize the NavVis IVION Frontend API.
   * @param baseUrl - Base URL of the IVION instance
   * @param config - Optional configuration (loginToken, etc.)
   * @returns Promise resolving to the API interface
   */
  export function getApi(baseUrl: string, config?: Record<string, any>): Promise<IvionApi>;

  /** The full API interface type (aliased as ApiInterface in NavVis docs) */
  export type ApiInterface = IvionApi;
}
