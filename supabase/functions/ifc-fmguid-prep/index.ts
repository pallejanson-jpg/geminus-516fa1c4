/**
 * ifc-fmguid-prep
 *
 * Scans an IFC file stored in the ifc-uploads bucket, detects whether
 * elements already have an FMGuid property, and assigns FMGUIDs to those
 * that don't — reusing previous mappings (ifc_fmguid_map) where available.
 *
 * Returns stats so the UI can show the user what happened before queuing
 * the conversion job.
 *
 * Request body:
 *   { storage_path: string, building_fm_guid: string }
 *
 * Response:
 *   {
 *     total_elements: number,
 *     had_fmguid: number,       -- already had FMGuid property in IFC
 *     reused_from_map: number,  -- matched by IFC GlobalId from previous upload
 *     newly_generated: number,  -- brand-new UUIDs
 *     mappings: { ifc_global_id, fm_guid, element_name, ifc_type }[]
 *   }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// IFC product types we assign FMGUIDs to (skip relationships, geometry, etc.)
const IFC_PRODUCT_TYPES = new Set([
  "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE", "IFCZONE",
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL",
  "IFCDOOR", "IFCWINDOW",
  "IFCSLAB", "IFCROOF", "IFCSTAIR", "IFCSTAIRFLIGHT",
  "IFCRAMP", "IFCRAMPFLIGHT", "IFCCOLUMN", "IFCBEAM", "IFCMEMBER",
  "IFCPLATE", "IFCCOVERING", "IFCRAILING",
  "IFCFURNISHINGELEMENT", "IFCFURNITURE",
  "IFCFLOWTERMINAL", "IFCFLOWSEGMENT", "IFCFLOWFITTING",
  "IFCFLOWCONTROLLER", "IFCFLOWMOVINGDEVICE",
  "IFCFLOWSTORAGEDEVICE", "IFCFLOWTREATMENTDEVICE",
  "IFCENERGYCONVERSIONDEVICE",
  "IFCPIPESEGMENT", "IFCPIPEFITTING",
  "IFCDUCTSEGMENT", "IFCDUCTFITTING",
  "IFCCABLECARRIERSEGMENT", "IFCCABLESEGMENT",
  "IFCBUILDINGELEMENTPROXY",
  "IFCALARM", "IFCSENSOR", "IFCACTUATOR",
  "IFCDISTRIBUTIONELEMENT", "IFCELECTRICALELEMENT",
  "IFCMEDICALDEVICE", "IFCPROTECTIVEDEVICE",
  "IFCSWITCHINGDEVICE", "IFCTRANSFORMER",
  "IFCLIGHTFIXTURE", "IFCOUTLET",
]);

// Decode IFC base64url GlobalId (22 chars) to a readable string
// We keep it as-is; it's the canonical IFC element identity
function extractFirstAttr(attrs: string): string {
  // First attribute of IFC entities is typically the GlobalId, quoted
  const m = attrs.match(/^'([^']+)'/);
  return m ? m[1] : "";
}

function extractNameAttr(attrs: string): string {
  // Name is typically the 3rd attr: GlobalId, OwnerHistory ref, Name
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of attrs) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  // Name is index 2 (0=GlobalId, 1=OwnerHistory, 2=Name)
  if (parts.length >= 3) {
    const raw = parts[2].trim();
    const m = raw.match(/^'([^']*)'$/);
    return m ? m[1] : (raw === "$" ? "" : raw);
  }
  return "";
}

function generateUUID(): string {
  // Crypto UUID v4
  return crypto.randomUUID();
}

interface ParsedElement {
  lineId: string;
  ifcType: string;
  globalId: string;
  name: string;
}

interface PropertyRef {
  psetLineId: string;
  propName: string;
  propValue: string;
}

/**
 * Parse IFC STEP text:
 * 1. Extract all product entities (line → type, GlobalId, Name)
 * 2. Extract IFCPROPERTYSINGLEVALUE entries for FMGuid detection
 * 3. Extract IFCPROPERTYSET refs to find which properties belong to which element
 */
function parseIfcText(ifcText: string): {
  elements: ParsedElement[];
  fmguidByGlobalId: Map<string, string>;
} {
  const elements: ParsedElement[] = [];
  const fmguidByGlobalId = new Map<string, string>();

  // Map: property line id → { name, value }
  const propMap = new Map<string, { name: string; value: string }>();
  // Map: pset line id → list of property line ids
  const psetProps = new Map<string, string[]>();
  // Map: element line id → list of pset line ids (via IFCRELDEFINESBYPROPERTIES)
  const elementPsets = new Map<string, string[]>();

  // Parse line by line (IFC STEP: each entity on its own line ending with ;)
  // Concatenate continuation lines first
  const lines = ifcText.split(/\r?\n/);
  let buffer = "";
  const entities: { lineId: string; rest: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("/*") || trimmed.startsWith("//")) continue;
    buffer += " " + trimmed;
    if (trimmed.endsWith(";")) {
      const entityLine = buffer.trim();
      buffer = "";
      // Match: #NNN=IFCTYPE(attrs...);
      const m = entityLine.match(/^#(\d+)\s*=\s*([A-Z][A-Z0-9]*)\s*\(([^]*)\)\s*;$/);
      if (m) {
        entities.push({ lineId: m[1], rest: `${m[2]}|${m[3]}` });
      }
    }
  }

  for (const { lineId, rest } of entities) {
    const pipeIdx = rest.indexOf("|");
    const ifcType = rest.substring(0, pipeIdx).toUpperCase();
    const attrs = rest.substring(pipeIdx + 1);

    if (IFC_PRODUCT_TYPES.has(ifcType)) {
      const globalId = extractFirstAttr(attrs);
      const name = extractNameAttr(attrs);
      if (globalId) {
        elements.push({ lineId, ifcType, globalId, name });
      }
    } else if (ifcType === "IFCPROPERTYSINGLEVALUE") {
      // IFCPROPERTYSINGLEVALUE(Name, Description, NominalValue, Unit)
      const parts = attrs.split(",").map((s) => s.trim());
      if (parts.length >= 3) {
        const rawName = parts[0].replace(/^'|'$/g, "");
        let rawValue = parts[2];
        // NominalValue is a type-value pair: IFCLABEL('xxx') or IFCTEXT('xxx')
        const vm = rawValue.match(/IFC[A-Z]+\('([^']*)'\)/i);
        if (vm) rawValue = vm[1];
        else rawValue = rawValue.replace(/^'|'$/g, "");
        propMap.set(lineId, { name: rawName, value: rawValue });
      }
    } else if (ifcType === "IFCPROPERTYSET") {
      // IFCPROPERTYSET(GlobalId, OwnerHistory, Name, Description, (prop refs))
      const refMatch = attrs.match(/\(([^)]*)\)\s*$/);
      if (refMatch) {
        const refs = refMatch[1]
          .split(",")
          .map((r) => r.trim().replace(/^#/, ""))
          .filter(Boolean);
        psetProps.set(lineId, refs);
      }
    } else if (ifcType === "IFCRELDEFINESBYPROPERTIES") {
      // IFCRELDEFINESBYPROPERTIES(GlobalId, OwnerHistory, Name, Description, (related objs), pset ref)
      // Extract related objects (#xxx,...) and pset (#yyy)
      const parts = attrs.split(",").map((s) => s.trim());
      if (parts.length >= 6) {
        const relObjs = parts[4];
        const psetRef = parts[5].replace(/^#/, "");
        const objRefs = [...relObjs.matchAll(/#(\d+)/g)].map((m) => m[1]);
        for (const objRef of objRefs) {
          if (!elementPsets.has(objRef)) elementPsets.set(objRef, []);
          elementPsets.get(objRef)!.push(psetRef);
        }
      }
    }
  }

  // Now resolve FMGuid for each element
  for (const el of elements) {
    const psetIds = elementPsets.get(el.lineId) || [];
    for (const psetId of psetIds) {
      const propIds = psetProps.get(psetId) || [];
      for (const propId of propIds) {
        const prop = propMap.get(propId);
        if (prop && prop.name.toLowerCase() === "fmguid" && prop.value) {
          fmguidByGlobalId.set(el.globalId, prop.value);
          break;
        }
      }
      if (fmguidByGlobalId.has(el.globalId)) break;
    }
  }

  return { elements, fmguidByGlobalId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth: require JWT
  const authHeader = req.headers.get("authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const svc = createClient(supabaseUrl, serviceKey);

  try {
    const { storage_path, building_fm_guid } = await req.json() as {
      storage_path: string;
      building_fm_guid: string;
    };

    if (!storage_path || !building_fm_guid) {
      return new Response(
        JSON.stringify({ error: "storage_path and building_fm_guid required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Download IFC from storage
    const { data: fileData, error: dlErr } = await svc.storage
      .from("ifc-uploads")
      .download(storage_path);
    if (dlErr || !fileData) {
      throw new Error(`Could not download IFC: ${dlErr?.message}`);
    }

    const ifcText = await fileData.text();
    console.log(`Parsing IFC (${(ifcText.length / 1024).toFixed(0)} KB)...`);

    const { elements, fmguidByGlobalId } = parseIfcText(ifcText);
    console.log(`Found ${elements.length} product elements, ${fmguidByGlobalId.size} already have FMGuid`);

    // Load existing ifc_fmguid_map for this building (for re-upload continuity)
    const globalIdsWithoutFmguid = elements
      .filter((el) => !fmguidByGlobalId.has(el.globalId))
      .map((el) => el.globalId);

    const existingMap = new Map<string, string>();
    if (globalIdsWithoutFmguid.length > 0) {
      // Fetch in batches of 500
      for (let i = 0; i < globalIdsWithoutFmguid.length; i += 500) {
        const batch = globalIdsWithoutFmguid.slice(i, i + 500);
        const { data: rows } = await svc
          .from("ifc_fmguid_map")
          .select("ifc_global_id, fm_guid")
          .eq("building_fm_guid", building_fm_guid)
          .in("ifc_global_id", batch);
        for (const row of rows || []) {
          existingMap.set(row.ifc_global_id, row.fm_guid);
        }
      }
    }

    // Build final mapping
    const mappings: { ifc_global_id: string; fm_guid: string; element_name: string; ifc_type: string }[] = [];
    let hadFmguid = 0;
    let reusedFromMap = 0;
    let newlyGenerated = 0;

    for (const el of elements) {
      if (fmguidByGlobalId.has(el.globalId)) {
        // Already in IFC property set
        hadFmguid++;
        mappings.push({
          ifc_global_id: el.globalId,
          fm_guid: fmguidByGlobalId.get(el.globalId)!,
          element_name: el.name,
          ifc_type: el.ifcType,
        });
      } else if (existingMap.has(el.globalId)) {
        // Matched from previous upload
        reusedFromMap++;
        mappings.push({
          ifc_global_id: el.globalId,
          fm_guid: existingMap.get(el.globalId)!,
          element_name: el.name,
          ifc_type: el.ifcType,
        });
      } else {
        // Generate new FMGUID
        newlyGenerated++;
        const newFmGuid = generateUUID();
        mappings.push({
          ifc_global_id: el.globalId,
          fm_guid: newFmGuid,
          element_name: el.name,
          ifc_type: el.ifcType,
        });
      }
    }

    // Upsert all mappings into ifc_fmguid_map (for future re-uploads)
    // Only upsert elements that didn't already have FMGuid in IFC properties,
    // since those are "our" assignments. Elements with existing IFC FMGuid
    // are also stored so we can look them up next time.
    if (mappings.length > 0) {
      const rows = mappings.map((m) => ({
        building_fm_guid,
        ifc_global_id: m.ifc_global_id,
        fm_guid: m.fm_guid,
        element_name: m.element_name || null,
        ifc_type: m.ifc_type || null,
        updated_at: new Date().toISOString(),
      }));

      // Upsert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error: upsertErr } = await svc
          .from("ifc_fmguid_map")
          .upsert(batch, { onConflict: "building_fm_guid,ifc_global_id" });
        if (upsertErr) {
          console.error("Upsert error:", upsertErr.message);
        }
      }
    }

    return new Response(
      JSON.stringify({
        total_elements: elements.length,
        had_fmguid: hadFmguid,
        reused_from_map: reusedFromMap,
        newly_generated: newlyGenerated,
        mappings,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ifc-fmguid-prep error:", err);
    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
