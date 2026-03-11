import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── 3-legged token ──
async function getThreeLeggedToken(userId: string, sb: any): Promise<string | null> {
  const { data: t } = await sb.from("acc_oauth_tokens").select("access_token, refresh_token, expires_at").eq("user_id", userId).maybeSingle();
  if (!t) return null;
  if (new Date(t.expires_at) > new Date()) return t.access_token;
  const cid = Deno.env.get("APS_CLIENT_ID"), cs = Deno.env.get("APS_CLIENT_SECRET");
  if (!cid || !cs) return null;
  try {
    const r = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: cid, client_secret: cs, refresh_token: t.refresh_token }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    await sb.from("acc_oauth_tokens").update({ access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, expires_at: new Date(Date.now() + d.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("user_id", userId);
    return d.access_token;
  } catch { return null; }
}

async function getApsToken(): Promise<string> {
  const cid = Deno.env.get("APS_CLIENT_ID")!, cs = Deno.env.get("APS_CLIENT_SECRET")!;
  const r = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${cid}:${cs}`)}` },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "data:read data:write viewables:read" }),
  });
  if (!r.ok) throw new Error(`APS auth failed: ${r.status}`);
  return (await r.json()).access_token;
}

async function getBestToken(userId: string | null, sb: any) {
  if (userId) { const t = await getThreeLeggedToken(userId, sb); if (t) return { token: t, is3L: true }; }
  return { token: await getApsToken(), is3L: false };
}

function getRegion(urn64: string) {
  try { if (atob(urn64.replace(/-/g, "+").replace(/_/g, "/")).includes("wipemea")) return { md: "https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata", r: "EU" }; } catch {}
  return { md: "https://developer.api.autodesk.com/modelderivative/v2/designdata", r: "US" };
}

function buildGlb(verts: Float32Array, idx: Uint32Array): ArrayBuffer {
  let mnX=Infinity,mnY=Infinity,mnZ=Infinity,mxX=-Infinity,mxY=-Infinity,mxZ=-Infinity;
  for(let i=0;i<verts.length/3;i++){const x=verts[i*3],y=verts[i*3+1],z=verts[i*3+2];if(x<mnX)mnX=x;if(x>mxX)mxX=x;if(y<mnY)mnY=y;if(y>mxY)mxY=y;if(z<mnZ)mnZ=z;if(z>mxZ)mxZ=z;}
  const vbl=verts.byteLength,ibl=idx.byteLength,ip=(4-(ibl%4))%4,tbl=vbl+ibl+ip;
  const j=JSON.stringify({asset:{version:"2.0"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],materials:[{pbrMetallicRoughness:{baseColorFactor:[0.7,0.7,0.7,1],metallicFactor:0.1,roughnessFactor:0.8},doubleSided:true}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0,mode:4}]}],accessors:[{bufferView:0,componentType:5126,count:verts.length/3,type:"VEC3",min:[mnX,mnY,mnZ],max:[mxX,mxY,mxZ]},{bufferView:1,componentType:5125,count:idx.length,type:"SCALAR"}],bufferViews:[{buffer:0,byteOffset:0,byteLength:vbl,target:34962},{buffer:0,byteOffset:vbl,byteLength:ibl,target:34963}],buffers:[{byteLength:tbl}]});
  const jb=new TextEncoder().encode(j),jp=(4-(jb.length%4))%4,jcl=jb.length+jp,tl=12+8+jcl+8+tbl;
  const g=new ArrayBuffer(tl),v=new DataView(g),u=new Uint8Array(g);let o=0;
  v.setUint32(o,0x46546C67,true);o+=4;v.setUint32(o,2,true);o+=4;v.setUint32(o,tl,true);o+=4;
  v.setUint32(o,jcl,true);o+=4;v.setUint32(o,0x4E4F534A,true);o+=4;u.set(jb,o);o+=jb.length;for(let i=0;i<jp;i++)u[o++]=0x20;
  v.setUint32(o,tbl,true);o+=4;v.setUint32(o,0x004E4942,true);o+=4;
  u.set(new Uint8Array(verts.buffer,verts.byteOffset,vbl),o);o+=vbl;u.set(new Uint8Array(idx.buffer,idx.byteOffset,ibl),o);
  return g;
}

function objToGlb(txt: string): ArrayBuffer {
  const vs:number[]=[], ix:number[]=[];
  for(const l of txt.split("\n")){const t=l.trim();if(t.startsWith("v ")){const p=t.split(/\s+/);vs.push(+p[1]||0,+p[2]||0,+p[3]||0);}else if(t.startsWith("f ")){const p=t.split(/\s+/).slice(1).map(x=>parseInt(x.split("/")[0])-1);for(let i=1;i<p.length-1;i++)ix.push(p[0],p[i],p[i+1]);}}
  if(!vs.length) return buildGlb(new Float32Array([0,0,0,1,0,0,0,1,0]),new Uint32Array([0,1,2]));
  console.log(`[geom] OBJ: ${vs.length/3} verts, ${ix.length/3} tris`);
  return buildGlb(new Float32Array(vs),new Uint32Array(ix));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { action, buildingFmGuid, versionUrn, modelKey, accProjectId, userId } = body;
    if (!buildingFmGuid) return new Response(JSON.stringify({ error: "buildingFmGuid required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // ── STATUS ──
    if (action === "status") {
      const { data: files } = await sb.storage.from("xkt-models").list(buildingFmGuid, { limit: 100 });
      return new Response(JSON.stringify({ hasManifest: !!files?.some((f: any) => f.name === "_geometry_manifest.json") }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── MANIFEST ──
    if (action === "manifest") {
      const { data: u } = await sb.storage.from("xkt-models").createSignedUrl(`${buildingFmGuid}/_geometry_manifest.json`, 3600);
      if (!u?.signedUrl) return new Response(JSON.stringify({ error: "No manifest" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const mr = await fetch(u.signedUrl);
      return new Response(JSON.stringify(await mr.json()), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── EXTRACT ──
    if (action === "extract") {
      if (!versionUrn) return new Response(JSON.stringify({ error: "versionUrn required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      // Idempotency
      const { data: ef } = await sb.storage.from("xkt-models").list(buildingFmGuid, { limit: 100 });
      if (ef?.some((f: any) => f.name === "_geometry_manifest.json") && !body.force) {
        return new Response(JSON.stringify({ success: true, skipped: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const urn64 = btoa(versionUrn).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const { md, r: region } = getRegion(urn64);
      const mKey = modelKey || buildingFmGuid;
      console.log(`[geom] Starting for ${buildingFmGuid}, region=${region}`);

      const { token, is3L } = await getBestToken(userId || null, sb);
      console.log(`[geom] Token: ${is3L ? "3-legged" : "2-legged"}`);

      // Check bubble
      const bubRes = await fetch(`${md}/${urn64}/manifest`, { headers: { Authorization: `Bearer ${token}` } });
      if (!bubRes.ok) return new Response(JSON.stringify({ error: `Bubble fetch failed: ${bubRes.status}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const bubble = await bubRes.json();

      if (bubble.status !== "success") {
        return new Response(JSON.stringify({ error: "Translation not ready", status: bubble.status }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Collect all derivative URNs
      const derivs: any[] = [];
      function collect(n: any) { if (n.urn) derivs.push(n); if (n.children) n.children.forEach(collect); if (n.derivatives) n.derivatives.forEach(collect); }
      collect(bubble);
      console.log(`[geom] ${derivs.length} derivatives found`);

      let geomData: ArrayBuffer | null = null;

      // Try glTF/GLB
      const gltf = derivs.find(d => d.mime === "model/gltf-binary" || d.name?.endsWith(".glb"));
      if (gltf) {
        console.log("[geom] Downloading glTF...");
        const dr = await fetch(`${md}/${urn64}/manifest/${encodeURIComponent(gltf.urn)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (dr.ok) geomData = await dr.arrayBuffer();
      }

      // Try existing OBJ
      if (!geomData) {
        const objOut = bubble.derivatives?.find((d: any) => d.outputType === "obj" && d.status === "success");
        if (objOut) {
          const objFiles: any[] = [];
          function findObj(n: any) { if (n.urn) objFiles.push(n); if (n.children) n.children.forEach(findObj); }
          findObj(objOut);
          const of = objFiles.find((f: any) => !f.urn?.endsWith(".mtl"));
          if (of) {
            console.log("[geom] Downloading existing OBJ...");
            const dr = await fetch(`${md}/${urn64}/manifest/${encodeURIComponent(of.urn)}`, { headers: { Authorization: `Bearer ${token}` } });
            if (dr.ok) { const ab = await dr.arrayBuffer(); if (ab.byteLength > 100) geomData = objToGlb(new TextDecoder().decode(ab)); }
          }
        }
      }

      // Request new OBJ translation (try with 2-legged if 3-legged fails)
      if (!geomData) {
        console.log("[geom] Requesting OBJ translation...");
        const jobUrl = md.replace("/designdata", "/designdata/job");
        const jobBody = JSON.stringify({ input: { urn: urn64 }, output: { formats: [{ type: "obj", advanced: { exportFileStructure: "single", unit: "mm" } }] } });
        
        let jobOk = false;
        let dlToken = token;
        
        let jr = await fetch(jobUrl, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-ads-force": "true" }, body: jobBody });
        if (jr.ok) { jobOk = true; } else {
          const err = await jr.text();
          console.warn(`[geom] OBJ request failed (${jr.status}): ${err.substring(0, 200)}`);
          // Retry with 2-legged
          if (is3L) {
            console.log("[geom] Retrying with 2-legged token...");
            try {
              dlToken = await getApsToken();
              jr = await fetch(jobUrl, { method: "POST", headers: { Authorization: `Bearer ${dlToken}`, "Content-Type": "application/json", "x-ads-force": "true" }, body: jobBody });
              if (jr.ok) jobOk = true; else { const e2 = await jr.text(); console.warn(`[geom] 2-legged also failed (${jr.status}): ${e2.substring(0, 200)}`); }
            } catch (e) { console.error("[geom] 2-legged fallback error:", e); }
          }
        }

        if (jobOk) {
          // Poll for OBJ
          for (let i = 0; i < 12; i++) {
            const wait = Math.min(10000 + i * 5000, 30000);
            console.log(`[geom] Polling OBJ (${i + 1}/12, ${wait / 1000}s)...`);
            await new Promise(r => setTimeout(r, wait));
            const pb = await (await fetch(`${md}/${urn64}/manifest`, { headers: { Authorization: `Bearer ${dlToken}` } })).json();
            const oo = pb.derivatives?.find((d: any) => d.outputType === "obj");
            if (oo?.status === "success") {
              const of2: any[] = [];
              function fo(n: any) { if (n.urn) of2.push(n); if (n.children) n.children.forEach(fo); }
              fo(oo);
              const ff = of2.find((f: any) => !f.urn?.endsWith(".mtl"));
              if (ff) {
                const dr = await fetch(`${md}/${urn64}/manifest/${encodeURIComponent(ff.urn)}`, { headers: { Authorization: `Bearer ${dlToken}` } });
                if (dr.ok) { const ab = await dr.arrayBuffer(); if (ab.byteLength > 100) { const fb = new Uint8Array(ab.slice(0, 4)); geomData = (fb[0]===0x67&&fb[1]===0x6C&&fb[2]===0x54&&fb[3]===0x46) ? ab : objToGlb(new TextDecoder().decode(ab)); } }
              }
              break;
            } else if (oo?.status === "failed") { console.error("[geom] OBJ failed:", oo.messages); break; }
          }
        }
      }

      // Store result
      let fallbackPath: string | null = null;
      let glbBytes = 0;
      if (geomData && geomData.byteLength >= 100) {
        fallbackPath = `${buildingFmGuid}/${mKey}_full.glb`;
        const { error: ue } = await sb.storage.from("xkt-models").upload(fallbackPath, new Blob([geomData], { type: "model/gltf-binary" }), { upsert: true, contentType: "model/gltf-binary" });
        if (ue) { console.error("[geom] Upload failed:", ue); fallbackPath = null; } else { glbBytes = geomData.byteLength; console.log(`[geom] GLB stored: ${(glbBytes / 1024 / 1024).toFixed(1)} MB`); }
      } else {
        console.warn("[geom] No geometry obtained");
      }

      // Create manifest (no level data — that requires separate properties fetch)
      const manifest = {
        modelId: mKey,
        source: { accProjectId: accProjectId || "", accFileUrn: versionUrn, apsRegion: region },
        version: new Date().toISOString(),
        format: "glb",
        coordinateSystem: { up: "Z", units: "mm" },
        materialPolicy: { textures: false },
        chunks: [] as any[],
        fallback: fallbackPath ? { url: fallbackPath } : null,
      };

      await sb.storage.from("xkt-models").upload(`${buildingFmGuid}/_geometry_manifest.json`, new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }), { upsert: true, contentType: "application/json" });

      console.log(`[geom] ✅ Done: fallback=${!!fallbackPath} (${(glbBytes / 1024 / 1024).toFixed(1)} MB)`);
      return new Response(JSON.stringify({ success: true, manifest, stats: { hasFallback: !!fallbackPath, fallbackSizeMB: +(glbBytes / 1024 / 1024).toFixed(1), tokenType: is3L ? "3-legged" : "2-legged" } }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[geom] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
