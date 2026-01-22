import { supabase } from "@/integrations/supabase/client";

export type AssetPlusFilter = any[];

/**
 * Fetch a flat list of objects from Asset+.
 *
 * Note: This is proxied via a backend function so we never ship secrets to the browser.
 */
export async function fetchAssetPlusData(filter: AssetPlusFilter): Promise<any[]> {
  const { data, error } = await supabase.functions.invoke("asset-plus-query", {
    body: { filter },
  });

  if (error) {
    throw new Error(error.message || "Asset+ fetch failed");
  }

  // Expected shape: { items: [...] }
  const items = (data as any)?.items;
  if (!Array.isArray(items)) return [];
  return items;
}

// Stubs for later migration (kept for parity with Firebase project).
export async function createAssetPlusObject(_payload: any): Promise<any> {
  throw new Error("createAssetPlusObject is not implemented yet");
}

export async function updateAssetPlus(_payload: any): Promise<any> {
  throw new Error("updateAssetPlus is not implemented yet");
}
