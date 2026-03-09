import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Earth constants
const METERS_PER_DEGREE_LAT = 111320;
function metersPerDegreeLng(lat: number) {
  return METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}
function toRad(d: number) { return (d * Math.PI) / 180; }

interface Origin { lat: number; lng: number; rotation: number }

function localToGeo(x: number, z: number, origin: Origin): [number, number] {
  const r = toRad(origin.rotation);
  const rx = x * Math.cos(r) - z * Math.sin(r);
  const rz = x * Math.sin(r) + z * Math.cos(r);
  const lng = origin.lng + rx / metersPerDegreeLng(origin.lat);
  const lat = origin.lat + rz / METERS_PER_DEGREE_LAT;
  return [lng, lat]; // GeoJSON is [lng, lat]
}

/** Build a rectangular polygon from center + half-side in local coords, then transform to WGS84 */
function rectPolygon(cx: number, cz: number, halfSide: number, origin: Origin): number[][][] {
  const corners = [
    [cx - halfSide, cz - halfSide],
    [cx + halfSide, cz - halfSide],
    [cx + halfSide, cz + halfSide],
    [cx - halfSide, cz + halfSide],
    [cx - halfSide, cz - halfSide], // close ring
  ];
  return [corners.map(([x, z]) => localToGeo(x, z, origin))];
}

/** Simple ZIP creator — stores files uncompressed (method 0) for Deno compatibility */
function createZip(files: Record<string, string>): Uint8Array {
  const entries: { name: Uint8Array; data: Uint8Array; offset: number }[] = [];
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const dataBytes = encoder.encode(content);

    // Local file header (30 + name + data)
    const header = new ArrayBuffer(30);
    const hv = new DataView(header);
    hv.setUint32(0, 0x04034b50, true); // signature
    hv.setUint16(4, 20, true);         // version needed
    hv.setUint16(6, 0, true);          // flags
    hv.setUint16(8, 0, true);          // compression method (store)
    hv.setUint16(10, 0, true);         // mod time
    hv.setUint16(12, 0, true);         // mod date
    // CRC32 — skip for simplicity (set to 0, many readers accept it for stored files)
    hv.setUint32(14, 0, true);
    hv.setUint32(18, dataBytes.length, true); // compressed size
    hv.setUint32(22, dataBytes.length, true); // uncompressed size
    hv.setUint16(26, nameBytes.length, true); // name length
    hv.setUint16(28, 0, true);               // extra length

    const headerU8 = new Uint8Array(header);
    entries.push({ name: nameBytes, data: dataBytes, offset });
    parts.push(headerU8, nameBytes, dataBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  // Central directory
  const cdStart = offset;
  for (const entry of entries) {
    const cd = new ArrayBuffer(46);
    const cv = new DataView(cd);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, 0, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 32, true); // external attrs
    cv.setUint32(42, entry.offset, true);
    parts.push(new Uint8Array(cd), entry.name);
    offset += 46 + entry.name.length;
  }
  const cdSize = offset - cdStart;

  // End of central directory
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);
  parts.push(new Uint8Array(eocd));

  // Concatenate
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}

// IMDF category mapping from asset_type
function mapToImdfCategory(assetType: string | null, category: string | null): string {
  if (!assetType) return "unspecified";
  const t = assetType.toLowerCase();
  if (t.includes("office") || t.includes("kontor")) return "office";
  if (t.includes("restroom") || t.includes("toalett") || t.includes("wc")) return "restroom";
  if (t.includes("corridor") || t.includes("korridor")) return "walkway";
  if (t.includes("stair") || t.includes("trapp")) return "stairs";
  if (t.includes("elevator") || t.includes("hiss")) return "elevator";
  if (t.includes("kitchen") || t.includes("kök") || t.includes("pentry")) return "kitchen";
  if (t.includes("meeting") || t.includes("konferens") || t.includes("möte")) return "conferenceroom";
  if (t.includes("storage") || t.includes("förråd")) return "storage";
  if (t.includes("server")) return "serverroom";
  if (t.includes("parking")) return "parking";
  return "room";
}

function makeFeature(id: string, geometry: any, properties: any) {
  return { type: "Feature", id, feature_type: properties.feature_type, geometry, properties };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { buildingFmGuid } = await req.json();
    if (!buildingFmGuid) {
      return new Response(JSON.stringify({ error: "buildingFmGuid required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // 1. Building settings (georef)
    const { data: bs } = await sb.from("building_settings").select("*").eq("fm_guid", buildingFmGuid).single();
    if (!bs || !bs.latitude || !bs.longitude) {
      return new Response(JSON.stringify({ error: "Building not found or missing coordinates" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const origin: Origin = { lat: Number(bs.latitude), lng: Number(bs.longitude), rotation: Number(bs.rotation || 0) };

    // 2. Building asset
    const { data: buildingAsset } = await sb.from("assets").select("*")
      .eq("building_fm_guid", buildingFmGuid).eq("category", "Building").limit(1).single();
    const buildingName = buildingAsset?.name || buildingAsset?.common_name || buildingFmGuid;

    // 3. Levels
    const { data: levels } = await sb.from("assets").select("*")
      .eq("building_fm_guid", buildingFmGuid).eq("category", "Level").order("name");

    // 4. Spaces (units)
    const { data: spaces } = await sb.from("assets").select("*")
      .eq("building_fm_guid", buildingFmGuid).eq("category", "Space");

    // 5. Anchors — inventoried assets with coordinates
    const { data: anchors } = await sb.from("assets").select("*")
      .eq("building_fm_guid", buildingFmGuid).eq("is_local", true)
      .not("coordinate_x", "is", null);

    // Build venue bounding box from all spaces/levels
    const allCoords: [number, number][] = [];
    const venueCenter = localToGeo(0, 0, origin);
    // Use a rough 50m box around origin as venue polygon
    const venuePolygon = rectPolygon(0, 0, 50, origin);

    // ---- VENUE ----
    const venueFeature = makeFeature(buildingFmGuid, {
      type: "Polygon", coordinates: venuePolygon,
    }, {
      feature_type: "venue",
      category: "businessandmerchandising",
      name: { sv: buildingName },
      address_id: buildingFmGuid,
      display_point: { type: "Point", coordinates: venueCenter },
    });
    const venueGeoJson = {
      type: "FeatureCollection",
      name: "venue",
      features: [venueFeature],
    };

    // ---- LEVELS ----
    const levelFeatures = (levels || []).map((lv, idx) => {
      // Extract ordinal from name — try to find a number
      const numMatch = lv.name?.match(/(\d+)/);
      const ordinal = numMatch ? parseInt(numMatch[1], 10) : idx;
      // Level polygon — same as venue for now
      return makeFeature(lv.fm_guid, {
        type: "Polygon", coordinates: venuePolygon,
      }, {
        feature_type: "level",
        category: "unspecified",
        ordinal,
        outdoor: false,
        name: { sv: lv.name || `Level ${idx}` },
        short_name: { sv: lv.common_name || lv.name || `L${idx}` },
        display_point: { type: "Point", coordinates: venueCenter },
      });
    });
    const levelGeoJson = { type: "FeatureCollection", name: "level", features: levelFeatures };

    // ---- UNITS (Spaces) ----
    const unitFeatures = (spaces || []).map((sp) => {
      const area = Number(sp.gross_area || 25);
      const halfSide = Math.sqrt(area) / 2;
      const cx = Number(sp.coordinate_x || 0);
      const cz = Number(sp.coordinate_z || 0);
      const polygon = rectPolygon(cx, cz, halfSide, origin);
      const center = localToGeo(cx, cz, origin);

      return makeFeature(sp.fm_guid, {
        type: "Polygon", coordinates: polygon,
      }, {
        feature_type: "unit",
        category: mapToImdfCategory(sp.asset_type, sp.category),
        name: { sv: sp.common_name || sp.name || sp.fm_guid },
        level_id: sp.level_fm_guid || null,
        display_point: { type: "Point", coordinates: center },
      });
    });
    const unitGeoJson = { type: "FeatureCollection", name: "unit", features: unitFeatures };

    // ---- ANCHORS ----
    const anchorFeatures = (anchors || []).map((a) => {
      const pt = localToGeo(Number(a.coordinate_x), Number(a.coordinate_z), origin);
      return makeFeature(a.fm_guid, {
        type: "Point", coordinates: pt,
      }, {
        feature_type: "anchor",
        unit_id: a.in_room_fm_guid || null,
        name: { sv: a.common_name || a.name || a.fm_guid },
      });
    });
    const anchorGeoJson = { type: "FeatureCollection", name: "anchor", features: anchorFeatures };

    // ---- OPENING (empty for Phase 1) ----
    const openingGeoJson = { type: "FeatureCollection", name: "opening", features: [] };

    // ---- MANIFEST ----
    const manifest = {
      version: "1.0.0",
      created: new Date().toISOString(),
      language: "sv",
      generated_by: "Geminus IMDF Export",
    };

    // Build ZIP
    const files: Record<string, string> = {
      "manifest.json": JSON.stringify(manifest, null, 2),
      "venue.geojson": JSON.stringify(venueGeoJson, null, 2),
      "level.geojson": JSON.stringify(levelGeoJson, null, 2),
      "unit.geojson": JSON.stringify(unitGeoJson, null, 2),
      "opening.geojson": JSON.stringify(openingGeoJson, null, 2),
      "anchor.geojson": JSON.stringify(anchorGeoJson, null, 2),
    };
    const zipBytes = createZip(files);

    return new Response(zipBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="imdf-${buildingFmGuid}.zip"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
