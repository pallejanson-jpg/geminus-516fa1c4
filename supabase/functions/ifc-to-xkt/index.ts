import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Download WASM files and symlink so web-ifc can find them */
async function ensureWasm(): Promise<string> {
  const dir = "/tmp/web-ifc-wasm";
  try { await Deno.mkdir(dir, { recursive: true }); } catch (_) { /* exists */ }

  const files = ["web-ifc.wasm", "web-ifc-node.wasm"];
  const baseUrl = "https://unpkg.com/web-ifc@0.0.57";

  for (const file of files) {
    const dest = `${dir}/${file}`;
    try {
      await Deno.stat(dest);
    } catch {
      console.log(`Downloading ${file}...`);
      const resp = await fetch(`${baseUrl}/${file}`);
      if (resp.ok) {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        await Deno.writeFile(dest, bytes);
        console.log(`Saved ${file} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        console.warn(`Could not download ${file}: ${resp.status}`);
      }
    }
  }

  // web-ifc in Deno edge runtime resolves WASM to an internal npm path we can't write to.
  // Intercept file reads to redirect from the expected path to our /tmp copy.
  const expectedPrefix = "/var/tmp/sb-compile-edge-runtime/node_modules/localhost/web-ifc/0.0.57/tmp/web-ifc-wasm/";
  const originalReadFileSync = Deno.readFileSync;
  // @ts-ignore - monkey-patching for WASM resolution
  Deno.readFileSync = (path: string | URL) => {
    const p = typeof path === "string" ? path : path.toString();
    if (p.startsWith(expectedPrefix)) {
      const fileName = p.substring(expectedPrefix.length);
      const redirected = `${dir}/${fileName}`;
      console.log(`WASM redirect: ${p} -> ${redirected}`);
      return originalReadFileSync(redirected);
    }
    return originalReadFileSync(path);
  };

  console.log(`WASM ready at ${dir}/`);
  return dir + "/";
}

// ─── System & connectivity extraction helpers ───

interface ExtractedSystem {
  id: string;
  name: string;
  type: string;
  discipline: string;
  memberIds: string[];
}

interface ExtractedConnection {
  fromId: string;
  toId: string;
  type: string;
  direction: string;
}

/**
 * Extract systems and connectivity from parsed IFC metaObjects.
 * Strategy:
 *   1. Look for IfcSystem / IfcDistributionSystem objects → explicit systems
 *   2. Look for IfcRelAssignsToGroup → link members to systems
 *   3. Fallback: group by SystemName property on objects
 *   4. Extract IfcRelConnects* for topology
 */
function extractSystemsAndConnections(metaObjects: any[]): {
  systems: ExtractedSystem[];
  connections: ExtractedConnection[];
  objectExternalIds: Array<{ metaObjectId: string; ifcType: string }>;
} {
  const systems: ExtractedSystem[] = [];
  const connections: ExtractedConnection[] = [];
  const objectExternalIds: Array<{ metaObjectId: string; ifcType: string }> = [];

  // Index all meta objects by id for fast lookup
  const byId = new Map<string, any>();
  for (const m of metaObjects) {
    const id = m.metaObjectId || m.id || "";
    if (id) byId.set(id, m);
  }

  // Track which objects are system containers
  const systemMap = new Map<string, ExtractedSystem>();
  // Track objects grouped by SystemName property (fallback)
  const systemNameGroups = new Map<string, string[]>();

  for (const m of metaObjects) {
    const t = m.metaType || m.type || "";
    const id = m.metaObjectId || m.id || "";
    const name = m.metaObjectName || m.name || "";
    const parentId = m.parentMetaObjectId || m.parentId || "";

    // Collect all object external IDs for reconciliation
    if (id && t && !t.startsWith("IfcRel") && t !== "IfcSystem" && t !== "IfcDistributionSystem") {
      objectExternalIds.push({ metaObjectId: id, ifcType: t });
    }

    // 1. Identify system objects
    if (t === "IfcSystem" || t === "IfcDistributionSystem") {
      const discipline = inferDiscipline(name, t);
      const sys: ExtractedSystem = {
        id,
        name: name || id,
        type: t,
        discipline,
        memberIds: [],
      };
      systemMap.set(id, sys);
      continue;
    }

    // 2. If parent is a system, link as member
    if (parentId && systemMap.has(parentId)) {
      systemMap.get(parentId)!.memberIds.push(id);
    }

    // 3. Check for SystemName property (fallback grouping)
    const props = m.properties || m.propertySets || {};
    const systemName = findPropertyValue(props, ["SystemName", "System Name", "System_Name"]);
    if (systemName && id) {
      if (!systemNameGroups.has(systemName)) {
        systemNameGroups.set(systemName, []);
      }
      systemNameGroups.get(systemName)!.push(id);
    }

    // 4. Extract connectivity (IfcRelConnects*)
    if (t.startsWith("IfcRelConnects") || t === "IfcRelFlowControlElements") {
      const relatingId = m.relatingElement || m.relatingPort || "";
      const relatedId = m.relatedElement || m.relatedPort || "";
      if (relatingId && relatedId) {
        connections.push({
          fromId: relatingId,
          toId: relatedId,
          type: inferConnectionType(t),
          direction: "forward",
        });
      }
    }
  }

  // Collect explicit systems
  for (const sys of systemMap.values()) {
    systems.push(sys);
  }

  // Fallback: create systems from SystemName groups that aren't already covered
  const coveredIds = new Set<string>();
  for (const sys of systems) {
    for (const mid of sys.memberIds) coveredIds.add(mid);
  }

  for (const [sysName, memberIds] of systemNameGroups) {
    const uncovered = memberIds.filter((id) => !coveredIds.has(id));
    if (uncovered.length > 0) {
      systems.push({
        id: `prop-${sysName}`,
        name: sysName,
        type: "PropertyGrouped",
        discipline: inferDiscipline(sysName, ""),
        memberIds: uncovered,
      });
    }
  }

  return { systems, connections, objectExternalIds };
}

function inferDiscipline(name: string, type: string): string {
  const lower = (name + " " + type).toLowerCase();
  if (lower.includes("vent") || lower.includes("air") || lower.includes("lb") || lower.includes("duct")) return "Ventilation";
  if (lower.includes("heat") || lower.includes("radi") || lower.includes("vs")) return "Heating";
  if (lower.includes("cool") || lower.includes("kyl")) return "Cooling";
  if (lower.includes("elec") || lower.includes("el-") || lower.includes("circuit")) return "Electrical";
  if (lower.includes("plumb") || lower.includes("pipe") || lower.includes("va")) return "Plumbing";
  if (lower.includes("fire") || lower.includes("brand") || lower.includes("sprink")) return "FireProtection";
  return "Other";
}

function inferConnectionType(relType: string): string {
  if (relType.includes("Flow")) return "flow";
  if (relType.includes("Port")) return "port";
  return "structural";
}

function findPropertyValue(props: any, keys: string[]): string | null {
  if (!props || typeof props !== "object") return null;
  for (const key of keys) {
    if (props[key] !== undefined && props[key] !== null) return String(props[key]);
  }
  // Search nested property sets
  for (const val of Object.values(props)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const key of keys) {
        if ((val as any)[key] !== undefined) return String((val as any)[key]);
      }
    }
  }
  return null;
}

// ─── Persistence helpers ───

async function persistSystemsAndConnections(
  supabase: any,
  buildingFmGuid: string,
  systems: ExtractedSystem[],
  connections: ExtractedConnection[],
  objectExternalIds: Array<{ metaObjectId: string; ifcType: string }>,
  appendLog: (msg: string, progress?: number) => Promise<void>
) {
  // 1. Upsert asset_external_ids for all parsed objects
  if (objectExternalIds.length > 0) {
    const extRows = objectExternalIds.map((obj) => ({
      fm_guid: obj.metaObjectId,
      source: "ifc",
      external_id: obj.metaObjectId,
      model_version: new Date().toISOString().slice(0, 10),
      last_seen_at: new Date().toISOString(),
    }));

    // Batch in chunks of 500
    for (let i = 0; i < extRows.length; i += 500) {
      const chunk = extRows.slice(i, i + 500);
      await supabase
        .from("asset_external_ids")
        .upsert(chunk, { onConflict: "fm_guid,source" });
    }
    await appendLog(`Stored ${objectExternalIds.length} external ID mappings`);
  }

  // 2. Upsert systems
  if (systems.length > 0) {
    const sysRows = systems.map((s) => ({
      fm_guid: `sys-${buildingFmGuid}-${s.name}`,
      name: s.name,
      system_type: s.type,
      discipline: s.discipline,
      source: s.type === "PropertyGrouped" ? "ifc-property" : "ifc",
      building_fm_guid: buildingFmGuid,
      is_active: true,
    }));

    const { data: upsertedSystems } = await supabase
      .from("systems")
      .upsert(sysRows, { onConflict: "fm_guid" })
      .select("id, fm_guid");

    // Build fm_guid → system DB id mapping
    const sysDbMap = new Map<string, string>();
    if (upsertedSystems) {
      for (const s of upsertedSystems) {
        sysDbMap.set(s.fm_guid, s.id);
      }
    }

    // 3. Upsert asset_system relations
    const assetSysRows: Array<{ asset_fm_guid: string; system_id: string; role: string | null }> = [];
    for (const sys of systems) {
      const dbId = sysDbMap.get(`sys-${buildingFmGuid}-${sys.name}`);
      if (!dbId) continue;
      for (const memberId of sys.memberIds) {
        assetSysRows.push({
          asset_fm_guid: memberId,
          system_id: dbId,
          role: null,
        });
      }
    }

    if (assetSysRows.length > 0) {
      for (let i = 0; i < assetSysRows.length; i += 500) {
        const chunk = assetSysRows.slice(i, i + 500);
        await supabase
          .from("asset_system")
          .upsert(chunk, { onConflict: "asset_fm_guid,system_id" });
      }
    }

    await appendLog(`Stored ${systems.length} systems with ${assetSysRows.length} asset-system links`);
  }

  // 4. Upsert asset_connections
  if (connections.length > 0) {
    const connRows = connections.map((c) => ({
      from_fm_guid: c.fromId,
      to_fm_guid: c.toId,
      connection_type: c.type,
      direction: c.direction,
      source: "ifc",
    }));

    for (let i = 0; i < connRows.length; i += 500) {
      const chunk = connRows.slice(i, i + 500);
      await supabase
        .from("asset_connections")
        .upsert(chunk, { onConflict: "from_fm_guid,to_fm_guid,connection_type" });
    }
    await appendLog(`Stored ${connections.length} asset connections`);
  }
}

// ─── Populate assets from IFC metaObjects ───

async function deterministicGuid(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join("|"));
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${(parseInt(hex.slice(16,18),16) & 0x3f | 0x80).toString(16).padStart(2,"0")}${hex.slice(18,20)}-${hex.slice(20,32)}`;
}

const SPATIAL_TYPES = new Set(["IfcBuildingStorey", "IfcSpace"]);
const SKIP_TYPES = new Set([
  "IfcProject", "IfcSite", "IfcBuilding", "IfcSystem", "IfcDistributionSystem",
  "IfcRelAggregates", "IfcRelContainedInSpatialStructure", "IfcRelAssignsToGroup",
  "IfcRelConnectsElements", "IfcRelConnectsPortToElement", "IfcRelConnectsPorts",
  "IfcRelFlowControlElements", "IfcRelDefinesByProperties", "IfcRelDefinesByType",
  "IfcRelAssociatesMaterial", "IfcRelVoidsElement", "IfcRelFillsElement",
  "IfcRelSpaceBoundary", "IfcRelNests", "IfcRelSequence",
]);

async function populateAssetsFromMetaObjects(
  supabase: any,
  buildingFmGuid: string,
  metaObjects: any[],
  appendLog: (msg: string, progress?: number) => Promise<void>
) {
  const now = new Date().toISOString();
  const importedFmGuids = new Set<string>();
  const storeyIdToFmGuid = new Map<string, string>();
  const spaceIdToFmGuid = new Map<string, string>();

  // Index parents for storey resolution
  const parentMap = new Map<string, string>();
  for (const m of metaObjects) {
    const id = m.metaObjectId || m.id || "";
    const parentId = m.parentMetaObjectId || m.parentId || "";
    if (id && parentId) parentMap.set(id, parentId);
  }

  // Resolve which storey an object belongs to by walking up the parent chain
  function resolveStorey(id: string): string | null {
    let current = id;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      if (storeyIdToFmGuid.has(current)) return current;
      current = parentMap.get(current) || "";
    }
    return null;
  }

  // Helper: extract property sets into a flat attributes object
  function extractProperties(m: any): Record<string, any> | null {
    const props = m.propertySets || m.properties || {};
    if (!props || typeof props !== "object") return null;
    const result: Record<string, any> = {};
    const bimProperties: Array<{ name: string; value: any; dataType: string }> = [];

    // Handle nested property sets: { "Pset_SpaceCommon": { "Area": 25.3, ... } }
    for (const [setName, setVal] of Object.entries(props)) {
      if (setVal && typeof setVal === "object" && !Array.isArray(setVal)) {
        for (const [propName, propValue] of Object.entries(setVal as Record<string, any>)) {
          if (propValue === undefined || propValue === null || propValue === "") continue;
          const numVal = typeof propValue === "number" ? propValue : parseFloat(String(propValue));
          bimProperties.push({
            name: `${setName}/${propName}`,
            value: propValue,
            dataType: typeof propValue === "number" || (!isNaN(numVal) && String(propValue).trim() !== "") ? "Double" : "String",
          });
        }
      } else if (setVal !== undefined && setVal !== null && setVal !== "") {
        // Flat property: { "SystemName": "VS1" }
        const numVal = typeof setVal === "number" ? setVal : parseFloat(String(setVal));
        bimProperties.push({
          name: setName,
          value: setVal,
          dataType: typeof setVal === "number" || (!isNaN(numVal) && String(setVal).trim() !== "") ? "Double" : "String",
        });
      }
    }

    if (bimProperties.length === 0) return null;
    result.bim_properties = bimProperties;
    return result;
  }

  // Helper: extract gross_area from properties
  function extractGrossArea(m: any): number | null {
    const props = m.propertySets || m.properties || {};
    if (!props || typeof props !== "object") return null;
    // Search for area in nested or flat props
    for (const [, setVal] of Object.entries(props)) {
      if (setVal && typeof setVal === "object" && !Array.isArray(setVal)) {
        for (const [propName, propValue] of Object.entries(setVal as Record<string, any>)) {
          if (/^(area|gross\s*area|net\s*area)$/i.test(propName)) {
            const num = typeof propValue === "number" ? propValue : parseFloat(String(propValue));
            if (!isNaN(num)) return Math.round(num * 100) / 100;
          }
        }
      }
    }
    return null;
  }

  // Pass 1: Collect storeys
  const storeyRows: any[] = [];
  for (const m of metaObjects) {
    const t = m.metaType || m.type || "";
    if (t !== "IfcBuildingStorey") continue;
    const id = m.metaObjectId || m.id || "";
    const name = m.metaObjectName || m.name || t;
    const fmGuid = id || await deterministicGuid([buildingFmGuid, name, "IfcBuildingStorey"]);
    storeyIdToFmGuid.set(id, fmGuid);
    importedFmGuids.add(fmGuid);
    const attrs = extractProperties(m);
    storeyRows.push({
      fm_guid: fmGuid, name, common_name: name,
      category: "Building Storey", building_fm_guid: buildingFmGuid, level_fm_guid: fmGuid,
      is_local: false, created_in_model: true, synced_at: now,
      ...(attrs ? { attributes: { source: "ifc", ...attrs } } : {}),
    });
  }

  // Pass 2: Collect spaces
  const spaceRows: any[] = [];
  for (const m of metaObjects) {
    const t = m.metaType || m.type || "";
    if (t !== "IfcSpace") continue;
    const id = m.metaObjectId || m.id || "";
    const name = m.metaObjectName || m.name || t;
    const fmGuid = id || await deterministicGuid([buildingFmGuid, name, "IfcSpace"]);
    spaceIdToFmGuid.set(id, fmGuid);
    importedFmGuids.add(fmGuid);
    const parentId = m.parentMetaObjectId || m.parentId || "";
    const levelFmGuid = storeyIdToFmGuid.get(parentId) || null;
    const attrs = extractProperties(m);
    const grossArea = extractGrossArea(m);
    spaceRows.push({
      fm_guid: fmGuid, name, common_name: name,
      category: "Space", building_fm_guid: buildingFmGuid, level_fm_guid: levelFmGuid,
      is_local: false, created_in_model: true, synced_at: now,
      ...(grossArea != null ? { gross_area: grossArea } : {}),
      ...(attrs ? { attributes: { source: "ifc", ...attrs } } : {}),
    });
  }

  // Pass 3: Collect instances (non-spatial, non-relationship objects)
  const instanceRows: any[] = [];
  for (const m of metaObjects) {
    const t = m.metaType || m.type || "";
    if (!t || SPATIAL_TYPES.has(t) || SKIP_TYPES.has(t) || t.startsWith("IfcRel")) continue;
    const id = m.metaObjectId || m.id || "";
    const name = m.metaObjectName || m.name || "";
    if (!id && !name) continue;
    const fmGuid = id || await deterministicGuid([buildingFmGuid, name, t]);
    importedFmGuids.add(fmGuid);
    const storeyMetaId = resolveStorey(id);
    const levelFmGuid = storeyMetaId ? storeyIdToFmGuid.get(storeyMetaId) || null : null;
    const parentId = m.parentMetaObjectId || m.parentId || "";
    const inRoomFmGuid = spaceIdToFmGuid.get(parentId) || null;
    const attrs = extractProperties(m);
    instanceRows.push({
      fm_guid: fmGuid, name: name || t, common_name: name || t,
      category: "Instance", asset_type: t,
      building_fm_guid: buildingFmGuid, level_fm_guid: levelFmGuid, in_room_fm_guid: inRoomFmGuid,
      is_local: false, created_in_model: true, synced_at: now,
      ...(attrs ? { attributes: { source: "ifc", ...attrs } } : {}),
    });
  }

  // Upsert all
  for (let i = 0; i < storeyRows.length; i += 500) {
    await supabase.from("assets").upsert(storeyRows.slice(i, i + 500), { onConflict: "fm_guid" });
  }
  for (let i = 0; i < spaceRows.length; i += 500) {
    await supabase.from("assets").upsert(spaceRows.slice(i, i + 500), { onConflict: "fm_guid" });
  }
  for (let i = 0; i < instanceRows.length; i += 500) {
    await supabase.from("assets").upsert(instanceRows.slice(i, i + 500), { onConflict: "fm_guid" });
  }

  await appendLog(`Assets populated: ${storeyRows.length} storeys, ${spaceRows.length} spaces, ${instanceRows.length} instances`, 92);

  // Populate geometry_entity_map for IFC-sourced objects
  try {
    const gemRows: any[] = [];
    const gemNow = new Date().toISOString();

    for (const row of storeyRows) {
      gemRows.push({
        building_fm_guid: buildingFmGuid,
        asset_fm_guid: row.fm_guid,
        source_system: 'ifc',
        external_entity_id: row.fm_guid,
        entity_type: 'storey',
        storey_fm_guid: row.fm_guid,
        source_storey_name: row.common_name,
        last_seen_at: gemNow,
      });
    }
    for (const row of spaceRows) {
      gemRows.push({
        building_fm_guid: buildingFmGuid,
        asset_fm_guid: row.fm_guid,
        source_system: 'ifc',
        external_entity_id: row.fm_guid,
        entity_type: 'space',
        storey_fm_guid: row.level_fm_guid,
        last_seen_at: gemNow,
      });
    }
    for (const row of instanceRows) {
      gemRows.push({
        building_fm_guid: buildingFmGuid,
        asset_fm_guid: row.fm_guid,
        source_system: 'ifc',
        external_entity_id: row.fm_guid,
        entity_type: 'instance',
        storey_fm_guid: row.level_fm_guid,
        last_seen_at: gemNow,
      });
    }

    for (let i = 0; i < gemRows.length; i += 500) {
      await supabase.from("geometry_entity_map").upsert(gemRows.slice(i, i + 500)).then(() => {}, () => {});
    }
    await appendLog(`Geometry mappings: ${gemRows.length} rows`, 93);
  } catch (e) {
    console.debug("geometry_entity_map population failed (non-fatal):", e);
  }

  // Diff: soft-delete assets in DB that are no longer in the IFC
  const { data: existingAssets } = await supabase
    .from("assets")
    .select("fm_guid")
    .eq("building_fm_guid", buildingFmGuid)
    .eq("created_in_model", true)
    .in("category", ["Building Storey", "Space", "Instance"]);

  if (existingAssets && existingAssets.length > 0) {
    const removedGuids = existingAssets
      .map((a: any) => a.fm_guid)
      .filter((guid: string) => !importedFmGuids.has(guid));

    if (removedGuids.length > 0) {
      for (let i = 0; i < removedGuids.length; i += 500) {
        const chunk = removedGuids.slice(i, i + 500);
        await supabase
          .from("assets")
          .update({ modification_status: "removed", updated_at: now })
          .in("fm_guid", chunk)
          .eq("building_fm_guid", buildingFmGuid);
      }
      await appendLog(`Marked ${removedGuids.length} removed assets`, 94);
    }
  }
}

// ─── Main handler ───

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { ifcStoragePath, buildingFmGuid, modelName, jobId } = await req.json();

    if (!ifcStoragePath || !buildingFmGuid) {
      return new Response(
        JSON.stringify({ error: "ifcStoragePath and buildingFmGuid are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const updateJob = async (updates: Record<string, unknown>) => {
      if (!jobId) return;
      try {
        await supabase
          .from("conversion_jobs")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", jobId);
      } catch (e) {
        console.warn("Failed to update job progress:", e);
      }
    };

    const appendLog = async (msg: string, progress?: number) => {
      console.log(msg);
      if (!jobId) return;
      try {
        const { data } = await supabase
          .from("conversion_jobs")
          .select("log_messages")
          .eq("id", jobId)
          .single();
        const logs = (data?.log_messages as string[]) || [];
        logs.push(msg);
        const upd: Record<string, unknown> = {
          log_messages: logs,
          updated_at: new Date().toISOString(),
        };
        if (progress !== undefined) upd.progress = progress;
        await supabase.from("conversion_jobs").update(upd).eq("id", jobId);
      } catch (_) {
        // best-effort
      }
    };

    await updateJob({ status: "processing", progress: 5 });
    await appendLog(`Starting IFC-to-XKT conversion: ${ifcStoragePath}`, 5);

    // 1. Download IFC from storage and write to /tmp to reduce memory pressure
    await appendLog("Downloading IFC from storage...", 10);
    const { data: ifcBlob, error: dlError } = await supabase.storage
      .from("ifc-uploads")
      .download(ifcStoragePath);

    if (dlError || !ifcBlob) {
      const errMsg = `Failed to download IFC: ${dlError?.message || "no data"}`;
      await updateJob({ status: "error", error_message: errMsg });
      throw new Error(errMsg);
    }

    // Write to /tmp to free the blob from memory
    const ifcTmpPath = `/tmp/input_${Date.now()}.ifc`;
    let ifcBytes: Uint8Array | null = new Uint8Array(await ifcBlob.arrayBuffer());
    const fileSizeMB = ifcBytes.byteLength / 1024 / 1024;
    await Deno.writeFile(ifcTmpPath, ifcBytes);
    // Release download buffer immediately to free memory before WASM+parse
    ifcBytes = null;
    await appendLog(`IFC downloaded: ${fileSizeMB.toFixed(1)} MB (saved to disk)`, 20);

    // 2. Download WASM and load libraries
    await appendLog("Preparing WASM runtime...", 25);
    const wasmPath = await ensureWasm();
    await appendLog(`WASM ready at ${wasmPath}`, 28);

    const WebIFC = await import("npm:web-ifc@0.0.57");
    const xeokitConvert = await import("npm:@xeokit/xeokit-convert@1.3.1");

    const xktModel = new (xeokitConvert as any).XKTModel();
    await appendLog("Parsing IFC from disk...", 30);

    // Read IFC from disk instead of keeping blob in memory
    let ifcData: Uint8Array | null = await Deno.readFile(ifcTmpPath);
    // Remove temp file immediately to free disk
    try { await Deno.remove(ifcTmpPath); } catch (_) { /* best-effort */ }

    await (xeokitConvert as any).parseIFCIntoXKTModel({
      WebIFC,
      data: ifcData,
      xktModel,
      autoNormals: false,
      wasmPath,
      log: (msg: string) => console.log(`  ${msg}`),
    });

    // Release IFC data from memory immediately after parsing
    ifcData = null;

    await appendLog("Finalizing XKT model...", 60);
    xktModel.finalize();

    // 3. Extract spatial hierarchy
    const levels: Array<{ id: string; name: string; type: string }> = [];
    const spaces: Array<{ id: string; name: string; type: string; parentId: string }> = [];

    const metaObjectsList = xktModel.metaObjects
      ? (Array.isArray(xktModel.metaObjects)
          ? xktModel.metaObjects
          : Object.values(xktModel.metaObjects))
      : [];

    for (const m of metaObjectsList as any[]) {
      const t = m.metaType || m.type || "";
      if (t === "IfcBuildingStorey") {
        levels.push({
          id: m.metaObjectId || m.id || "",
          name: m.metaObjectName || m.name || t,
          type: t,
        });
      } else if (t === "IfcSpace") {
        spaces.push({
          id: m.metaObjectId || m.id || "",
          name: m.metaObjectName || m.name || t,
          type: t,
          parentId: m.parentMetaObjectId || m.parentId || "",
        });
      }
    }

    await appendLog(`Hierarchy: ${levels.length} levels, ${spaces.length} spaces`, 65);

    // 4. Extract systems, connections, and external IDs
    await appendLog("Extracting systems and connectivity...", 66);
    const { systems, connections, objectExternalIds } = extractSystemsAndConnections(metaObjectsList as any[]);
    await appendLog(`Found ${systems.length} systems, ${connections.length} connections, ${objectExternalIds.length} objects`, 68);

    // 5. Write XKT to ArrayBuffer (zip: true for ~30% smaller files)
    const stats: Record<string, any> = { texturesSize: 0 };
    const xktArrayBuffer = (xeokitConvert as any).writeXKTModelToArrayBuffer(
      xktModel,
      null,
      stats,
      { zip: true }
    );
    const xktSizeMB = xktArrayBuffer.byteLength / 1024 / 1024;
    await appendLog(`XKT generated: ${xktSizeMB.toFixed(2)} MB (compressed)`, 70);

    // 6. Upload XKT to storage
    await appendLog("Uploading XKT to storage...", 75);
    const modelId = `ifc-${Date.now()}`;
    const storageFileName = `${modelId}.xkt`;
    const storagePath = `${buildingFmGuid}/${storageFileName}`;

    const { error: uploadError } = await supabase.storage
      .from("xkt-models")
      .upload(storagePath, xktArrayBuffer, {
        contentType: "application/octet-stream",
        upsert: true,
      });

    if (uploadError) {
      const errMsg = `XKT upload failed: ${uploadError.message}`;
      await updateJob({ status: "error", error_message: errMsg });
      throw new Error(errMsg);
    }

    await appendLog("Saving model metadata...", 80);

    // 7. Save metadata to xkt_models table
    const safeName = (modelName || ifcStoragePath).replace(/\.ifc$/i, "");
    const { error: dbError } = await supabase.from("xkt_models").upsert(
      {
        building_fm_guid: buildingFmGuid,
        model_id: modelId,
        model_name: safeName,
        file_name: storageFileName,
        file_size: xktArrayBuffer.byteLength,
        storage_path: storagePath,
        format: "xkt",
        synced_at: new Date().toISOString(),
        source_updated_at: new Date().toISOString(),
      },
      { onConflict: "building_fm_guid,model_id" }
    );

    if (dbError) {
      const errMsg = `Database error: ${dbError.message}`;
      await updateJob({ status: "error", error_message: errMsg });
      throw new Error(errMsg);
    }

    // 8+9. Persist systems AND populate assets in parallel (independent DB operations)
    await appendLog("Saving systems, connectivity, and building hierarchy in parallel...", 85);
    await Promise.all([
      persistSystemsAndConnections(
        supabase,
        buildingFmGuid,
        systems,
        connections,
        objectExternalIds,
        appendLog
      ),
      populateAssetsFromMetaObjects(supabase, buildingFmGuid, metaObjectsList as any[], appendLog),
    ]);

    await updateJob({
      status: "done",
      progress: 100,
      result_model_id: modelId,
    });
    await appendLog(`✅ Conversion complete: ${storagePath}`, 100);

    return new Response(
      JSON.stringify({
        success: true,
        modelId,
        storagePath,
        xktSizeMB: parseFloat(xktSizeMB.toFixed(2)),
        levels,
        spaces,
        systemsCount: systems.length,
        connectionsCount: connections.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("IFC-to-XKT error:", errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
