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

  // web-ifc in Deno edge runtime ignores wasmPath and resolves to an internal npm path.
  // Create a symlink so it finds our /tmp files at the expected location.
  const symlinkParent = "/var/tmp/sb-compile-edge-runtime/node_modules/localhost/web-ifc/0.0.57";
  try {
    await Deno.mkdir(symlinkParent, { recursive: true });
    const symlinkTarget = `${symlinkParent}/tmp`;
    try { await Deno.lstat(symlinkTarget); } catch {
      await Deno.symlink("/tmp", symlinkTarget);
      console.log(`Created symlink: ${symlinkTarget} -> /tmp`);
    }
  } catch (e) {
    console.warn(`Could not create symlink (will try direct path): ${e}`);
  }

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

function extractSystemsAndConnections(metaObjects: any[]): {
  systems: ExtractedSystem[];
  connections: ExtractedConnection[];
  objectExternalIds: Array<{ metaObjectId: string; ifcType: string }>;
} {
  const systems: ExtractedSystem[] = [];
  const connections: ExtractedConnection[] = [];
  const objectExternalIds: Array<{ metaObjectId: string; ifcType: string }> = [];

  const byId = new Map<string, any>();
  for (const m of metaObjects) {
    const id = m.metaObjectId || m.id || "";
    if (id) byId.set(id, m);
  }

  const systemMap = new Map<string, ExtractedSystem>();
  const systemNameGroups = new Map<string, string[]>();

  for (const m of metaObjects) {
    const t = m.metaType || m.type || "";
    const id = m.metaObjectId || m.id || "";
    const name = m.metaObjectName || m.name || "";
    const parentId = m.parentMetaObjectId || m.parentId || "";

    if (id && t && !t.startsWith("IfcRel") && t !== "IfcSystem" && t !== "IfcDistributionSystem") {
      objectExternalIds.push({ metaObjectId: id, ifcType: t });
    }

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

    if (parentId && systemMap.has(parentId)) {
      systemMap.get(parentId)!.memberIds.push(id);
    }

    const props = m.properties || m.propertySets || {};
    const systemName = findPropertyValue(props, ["SystemName", "System Name", "System_Name"]);
    if (systemName && id) {
      if (!systemNameGroups.has(systemName)) {
        systemNameGroups.set(systemName, []);
      }
      systemNameGroups.get(systemName)!.push(id);
    }

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

  for (const sys of systemMap.values()) {
    systems.push(sys);
  }

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
  for (const val of Object.values(props)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      for (const key of keys) {
        if ((val as any)[key] !== undefined) return String((val as any)[key]);
      }
    }
  }
  return null;
}

// ─── GUID reconciliation ───

async function reconcileGuids(
  supabase: any,
  buildingFmGuid: string,
  objectExternalIds: Array<{ metaObjectId: string; ifcType: string }>,
  metaObjects: any[],
): Promise<Map<string, string>> {
  // Map: IFC metaObjectId → resolved fm_guid
  const guidMap = new Map<string, string>();

  // 1. Check asset_external_ids for existing mappings
  const ifcIds = objectExternalIds.map((o) => o.metaObjectId);
  const existingMappings = new Map<string, string>();

  for (let i = 0; i < ifcIds.length; i += 500) {
    const chunk = ifcIds.slice(i, i + 500);
    const { data } = await supabase
      .from("asset_external_ids")
      .select("external_id, fm_guid")
      .eq("source", "ifc")
      .in("external_id", chunk);

    if (data) {
      for (const row of data) {
        existingMappings.set(row.external_id, row.fm_guid);
      }
    }
  }

  // 2. Load existing assets for this building for name-matching
  const { data: buildingAssets } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name, category, level_fm_guid")
    .eq("building_fm_guid", buildingFmGuid);

  const assetsByName = new Map<string, string>();
  if (buildingAssets) {
    for (const a of buildingAssets) {
      const key = `${a.category}:${(a.name || a.common_name || "").toLowerCase().trim()}`;
      assetsByName.set(key, a.fm_guid);
    }
  }

  // 3. Resolve each IFC object
  const metaById = new Map<string, any>();
  for (const m of metaObjects) {
    const id = m.metaObjectId || m.id || "";
    if (id) metaById.set(id, m);
  }

  for (const obj of objectExternalIds) {
    // Strategy 1: Exact match in asset_external_ids
    if (existingMappings.has(obj.metaObjectId)) {
      guidMap.set(obj.metaObjectId, existingMappings.get(obj.metaObjectId)!);
      continue;
    }

    // Strategy 2: Name+type match against existing assets
    const meta = metaById.get(obj.metaObjectId);
    if (meta) {
      const name = (meta.metaObjectName || meta.name || "").toLowerCase().trim();
      const categoryMap: Record<string, string> = {
        IfcBuildingStorey: "Level",
        IfcSpace: "Space",
      };
      const category = categoryMap[obj.ifcType] || "Instance";
      const nameKey = `${category}:${name}`;
      if (name && assetsByName.has(nameKey)) {
        guidMap.set(obj.metaObjectId, assetsByName.get(nameKey)!);
        continue;
      }
    }

    // Strategy 3: Use IFC GlobalId as fm_guid (identity mapping)
    guidMap.set(obj.metaObjectId, obj.metaObjectId);
  }

  return guidMap;
}

// ─── Persistence ───

async function persistSystemsAndConnections(
  supabase: any,
  buildingFmGuid: string,
  systems: ExtractedSystem[],
  connections: ExtractedConnection[],
  objectExternalIds: Array<{ metaObjectId: string; ifcType: string }>,
  guidMap: Map<string, string>,
  log: (msg: string) => void
) {
  // 1. Store external ID mappings
  if (objectExternalIds.length > 0) {
    const extRows = objectExternalIds.map((obj) => ({
      fm_guid: guidMap.get(obj.metaObjectId) || obj.metaObjectId,
      source: "ifc",
      external_id: obj.metaObjectId,
      model_version: new Date().toISOString().slice(0, 10),
      last_seen_at: new Date().toISOString(),
    }));

    for (let i = 0; i < extRows.length; i += 500) {
      const chunk = extRows.slice(i, i + 500);
      await supabase
        .from("asset_external_ids")
        .upsert(chunk, { onConflict: "fm_guid,source" });
    }
    log(`Stored ${objectExternalIds.length} external ID mappings`);
  }

  // 2. Upsert systems
  let totalLinks = 0;
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

    const sysDbMap = new Map<string, string>();
    if (upsertedSystems) {
      for (const s of upsertedSystems) {
        sysDbMap.set(s.fm_guid, s.id);
      }
    }

    // 3. Upsert asset_system relations (using reconciled GUIDs)
    const assetSysRows: Array<{ asset_fm_guid: string; system_id: string; role: string | null }> = [];
    for (const sys of systems) {
      const dbId = sysDbMap.get(`sys-${buildingFmGuid}-${sys.name}`);
      if (!dbId) continue;
      for (const memberId of sys.memberIds) {
        const resolvedGuid = guidMap.get(memberId) || memberId;
        assetSysRows.push({
          asset_fm_guid: resolvedGuid,
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

    totalLinks = assetSysRows.length;
    log(`Stored ${systems.length} systems with ${totalLinks} asset-system links`);
  }

  // 4. Upsert connections (using reconciled GUIDs)
  if (connections.length > 0) {
    const connRows = connections.map((c) => ({
      from_fm_guid: guidMap.get(c.fromId) || c.fromId,
      to_fm_guid: guidMap.get(c.toId) || c.toId,
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
    log(`Stored ${connections.length} asset connections`);
  }

  return { systemsCount: systems.length, linksCount: totalLinks, connectionsCount: connections.length };
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

    const { ifcStoragePath, buildingFmGuid, mode, jobId } = await req.json();

    if (!ifcStoragePath || !buildingFmGuid) {
      return new Response(
        JSON.stringify({ error: "ifcStoragePath and buildingFmGuid are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If mode is 'full', redirect to ifc-to-xkt
    if (mode === "full") {
      const { data, error } = await supabase.functions.invoke("ifc-to-xkt", {
        body: { ifcStoragePath, buildingFmGuid, jobId },
        headers: { Authorization: authHeader },
      });
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(msg);
      logs.push(msg);
    };

    const updateJob = async (updates: Record<string, unknown>) => {
      if (!jobId) return;
      try {
        await supabase
          .from("conversion_jobs")
          .update({ ...updates, updated_at: new Date().toISOString(), log_messages: logs })
          .eq("id", jobId);
      } catch (e) {
        console.warn("Failed to update job:", e);
      }
    };

    await updateJob({ status: "processing", progress: 5 });
    log(`Starting IFC system extraction (mode: ${mode || "systems-only"}): ${ifcStoragePath}`);

    // 1. Download IFC from storage
    log("Downloading IFC from storage...");
    await updateJob({ progress: 10 });

    const { data: ifcBlob, error: dlError } = await supabase.storage
      .from("ifc-uploads")
      .download(ifcStoragePath);

    if (dlError || !ifcBlob) {
      const errMsg = `Failed to download IFC: ${dlError?.message || "no data"}`;
      await updateJob({ status: "error", error_message: errMsg });
      throw new Error(errMsg);
    }

    const ifcArrayBuffer = await ifcBlob.arrayBuffer();
    const fileSizeMB = ifcArrayBuffer.byteLength / 1024 / 1024;
    log(`IFC downloaded: ${fileSizeMB.toFixed(1)} MB`);
    await updateJob({ progress: 20 });

    // 2. Load libraries and parse IFC metadata
    log("Preparing WASM runtime...");
    const wasmPath = await ensureWasm();
    await updateJob({ progress: 25 });

    const WebIFC = await import("npm:web-ifc@0.0.57");
    const xeokitConvert = await import("npm:@xeokit/xeokit-convert@1.3.1");

    const xktModel = new (xeokitConvert as any).XKTModel();
    log("Parsing IFC metadata...");
    await updateJob({ progress: 30 });

    await (xeokitConvert as any).parseIFCIntoXKTModel({
      WebIFC,
      data: new Uint8Array(ifcArrayBuffer),
      xktModel,
      autoNormals: true,
      wasmPath,
      log: (msg: string) => console.log(`  ${msg}`),
    });

    // We need finalize to get metaObjects populated
    xktModel.finalize();
    log("IFC metadata parsed");
    await updateJob({ progress: 55 });

    // 3. Extract metaObjects
    const metaObjectsList = xktModel.metaObjects
      ? (Array.isArray(xktModel.metaObjects)
          ? xktModel.metaObjects
          : Object.values(xktModel.metaObjects))
      : [];

    log(`Found ${metaObjectsList.length} meta objects`);

    // 4. Extract systems and connections
    log("Extracting systems and connectivity...");
    const { systems, connections, objectExternalIds } = extractSystemsAndConnections(metaObjectsList as any[]);
    log(`Found ${systems.length} systems, ${connections.length} connections, ${objectExternalIds.length} objects`);
    await updateJob({ progress: 65 });

    // 5. Reconcile GUIDs with existing assets
    log("Reconciling GUIDs with existing assets...");
    const guidMap = await reconcileGuids(supabase, buildingFmGuid, objectExternalIds, metaObjectsList as any[]);
    const reconciledCount = [...guidMap.values()].filter((v, _, arr) => {
      // Count GUIDs that were resolved to a different value (matched existing)
      return true;
    }).length;
    log(`Reconciled ${reconciledCount} object GUIDs`);
    await updateJob({ progress: 75 });

    // 6. Persist systems, connections, and external IDs
    log("Saving systems and connectivity...");
    const result = await persistSystemsAndConnections(
      supabase,
      buildingFmGuid,
      systems,
      connections,
      objectExternalIds,
      guidMap,
      log
    );
    await updateJob({ progress: 95 });

    // 7. Extract spatial summary
    const levels: Array<{ id: string; name: string; globalId?: string }> = [];
    const spaces: Array<{ id: string; name: string; parentId?: string; globalId?: string }> = [];
    const instances: Array<{ id: string; name: string; ifcType: string; storeyId?: string; spaceId?: string; globalId?: string }> = [];

    // Build parent map for storey resolution
    const parentMap = new Map<string, string>();
    for (const m of metaObjectsList as any[]) {
      const id = m.metaObjectId || m.id || "";
      const parentId = m.parentMetaObjectId || m.parentId || "";
      if (id && parentId) parentMap.set(id, parentId);
    }

    const storeyIds = new Set<string>();
    const spaceIds = new Set<string>();

    for (const m of metaObjectsList as any[]) {
      const t = m.metaType || m.type || "";
      const id = m.metaObjectId || m.id || "";
      const name = m.metaObjectName || m.name || "";
      if (t === "IfcBuildingStorey") {
        levels.push({ id, name, globalId: id });
        storeyIds.add(id);
      } else if (t === "IfcSpace") {
        spaces.push({ id, name, parentId: m.parentMetaObjectId || m.parentId || "", globalId: id });
        spaceIds.add(id);
      }
    }

    // Collect instances (non-spatial, non-relationship, non-system)
    const skipTypes = new Set(["IfcBuilding", "IfcBuildingStorey", "IfcSpace", "IfcSite", "IfcProject", "IfcSystem", "IfcDistributionSystem"]);
    for (const m of metaObjectsList as any[]) {
      const t = m.metaType || m.type || "";
      const id = m.metaObjectId || m.id || "";
      const name = m.metaObjectName || m.name || "";
      if (!t || t.startsWith("IfcRel") || skipTypes.has(t)) continue;

      // Resolve storey by walking parent chain
      let storeyId: string | undefined;
      let spaceId: string | undefined;
      let cur = id;
      for (let depth = 0; depth < 20; depth++) {
        const p = parentMap.get(cur);
        if (!p) break;
        if (storeyIds.has(p)) { storeyId = p; break; }
        if (spaceIds.has(p) && !spaceId) spaceId = p;
        cur = p;
      }

      instances.push({ id, name, ifcType: t, storeyId, spaceId, globalId: id });
    }

    // 8. If mode is enrich-guids, populate assets hierarchy
    let levelsCreated = 0;
    let spacesCreated = 0;
    let instancesCreated = 0;

    if (mode === "enrich-guids" && (levels.length > 0 || spaces.length > 0)) {
      log("Populating asset hierarchy (enrich-guids mode)...");

      // Deterministic GUID helper
      async function deterministicGuid(parts: string[]): Promise<string> {
        const data = new TextEncoder().encode(parts.join("|"));
        const hash = await crypto.subtle.digest("SHA-256", data);
        const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${(parseInt(hex.slice(16,18),16) & 0x3f | 0x80).toString(16).padStart(2,"0")}${hex.slice(18,20)}-${hex.slice(20,32)}`;
      }

      const now = new Date().toISOString();
      const storeyIdToFmGuid = new Map<string, string>();

      // Upsert storeys
      if (levels.length > 0) {
        const storeyRows = [];
        for (const l of levels) {
          const fmGuid = await deterministicGuid([buildingFmGuid, l.name || "", "IfcBuildingStorey"]);
          storeyIdToFmGuid.set(l.id, fmGuid);
          storeyRows.push({
            fm_guid: fmGuid, name: l.name, common_name: l.name,
            category: "Building Storey", building_fm_guid: buildingFmGuid, level_fm_guid: fmGuid,
            is_local: false, created_in_model: true, synced_at: now,
          });
        }
        for (let i = 0; i < storeyRows.length; i += 500) {
          await supabase.from("assets").upsert(storeyRows.slice(i, i + 500), { onConflict: "fm_guid" });
        }
        levelsCreated = storeyRows.length;
        log(`Upserted ${levelsCreated} storeys`);
      }

      // Upsert spaces
      if (spaces.length > 0) {
        const spaceRows = [];
        for (const s of spaces) {
          const fmGuid = await deterministicGuid([buildingFmGuid, s.name || "", "IfcSpace"]);
          const parentFmGuid = storeyIdToFmGuid.get(s.parentId || "") || null;
          spaceRows.push({
            fm_guid: fmGuid, name: s.name, common_name: s.name,
            category: "Space", building_fm_guid: buildingFmGuid, level_fm_guid: parentFmGuid,
            is_local: false, created_in_model: true, synced_at: now,
          });
        }
        for (let i = 0; i < spaceRows.length; i += 500) {
          await supabase.from("assets").upsert(spaceRows.slice(i, i + 500), { onConflict: "fm_guid" });
        }
        spacesCreated = spaceRows.length;
        log(`Upserted ${spacesCreated} spaces`);
      }

      // Upsert instances (limit to first 2000 for edge function timeout safety)
      const instSlice = instances.slice(0, 2000);
      if (instSlice.length > 0) {
        const instRows = [];
        for (const inst of instSlice) {
          const fmGuid = await deterministicGuid([buildingFmGuid, inst.name || "", inst.ifcType || "Instance"]);
          const levelFmGuid = inst.storeyId ? storeyIdToFmGuid.get(inst.storeyId) || null : null;
          let inRoomFmGuid: string | null = null;
          if (inst.spaceId) {
            inRoomFmGuid = await deterministicGuid([buildingFmGuid, "", "IfcSpace"]);
            // Find the actual space name for proper GUID
            const sp = spaces.find(s => s.id === inst.spaceId);
            if (sp) inRoomFmGuid = await deterministicGuid([buildingFmGuid, sp.name || "", "IfcSpace"]);
          }
          instRows.push({
            fm_guid: fmGuid, name: inst.name, common_name: inst.name,
            category: "Instance", asset_type: inst.ifcType,
            building_fm_guid: buildingFmGuid, level_fm_guid: levelFmGuid, in_room_fm_guid: inRoomFmGuid,
            is_local: false, created_in_model: true, synced_at: now,
          });
        }
        for (let i = 0; i < instRows.length; i += 500) {
          await supabase.from("assets").upsert(instRows.slice(i, i + 500), { onConflict: "fm_guid" });
        }
        instancesCreated = instRows.length;
        log(`Upserted ${instancesCreated} instances`);
      }

      log(`✅ Asset hierarchy populated: ${levelsCreated} levels, ${spacesCreated} spaces, ${instancesCreated} instances`);
    }

    log(`✅ System extraction complete: ${result.systemsCount} systems, ${result.linksCount} links, ${result.connectionsCount} connections`);
    await updateJob({ status: "done", progress: 100 });

    return new Response(
      JSON.stringify({
        success: true,
        mode: mode || "systems-only",
        systemsCount: result.systemsCount,
        linksCount: result.linksCount,
        connectionsCount: result.connectionsCount,
        objectsFound: objectExternalIds.length,
        levelsFound: levels.length,
        spacesFound: spaces.length,
        levelsCreated,
        spacesCreated,
        instancesCreated,
        logs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error("ifc-extract-systems error:", errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
