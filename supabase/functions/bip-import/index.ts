import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GITLAB_PROJECT = "bim-alliance%2Fbip-koder%2Fbipkoder-data";
const GITLAB_API = `https://gitlab.com/api/v4/projects/${GITLAB_PROJECT}`;

async function fetchGitLabTree(path: string): Promise<{ name: string; path: string }[]> {
  const allFiles: { name: string; path: string }[] = [];
  let page = 1;
  while (true) {
    const url = `${GITLAB_API}/repository/tree?path=${encodeURIComponent(path)}&per_page=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GitLab tree error ${res.status}: ${await res.text()}`);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;
    allFiles.push(...items.filter((i: any) => i.type === "blob" && i.name.endsWith(".json")));
    page++;
  }
  return allFiles;
}

async function fetchGitLabFile(filePath: string): Promise<any> {
  const url = `${GITLAB_API}/repository/files/${encodeURIComponent(filePath)}/raw?ref=master`;
  const res = await fetch(url);
  if (!res.ok) {
    const url2 = `${GITLAB_API}/repository/files/${encodeURIComponent(filePath)}/raw?ref=main`;
    const res2 = await fetch(url2);
    if (!res2.ok) throw new Error(`GitLab file error ${res2.status} for ${filePath}`);
    return res2.json();
  }
  return res.json();
}

// Fetch files in parallel batches to speed things up
async function fetchFilesBatched(files: { name: string; path: string }[], cat: string, batchSize = 10): Promise<any[]> {
  const rows: any[] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (file) => {
      const data = await fetchGitLabFile(file.path);
      return { data, fileName: file.name };
    }));
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { data, fileName } = result.value;
      const row: any = {
        ref_type: cat,
        raw_data: data,
        updated_at: new Date().toISOString(),
      };

      if (cat === "maincategory") {
        row.ref_id = data.mc_id;
        row.code = data.mc_code;
        row.title = data.mc_title || fileName;
        row.schema_id = data.mc_schema;
      } else if (cat === "subcategory") {
        row.ref_id = data.sc_id;
        row.code = data.sc_code;
        row.title = data.sc_title || fileName;
        row.parent_id = data.sc_maincategory;
        row.usercode_syntax = data.sc_usercode_syntax;
        row.bsab_e = data.sc_bsabE;
        row.aff = typeof data.aff === "object" ? JSON.stringify(data.aff) : data.aff;
        row.etim = typeof data.etim === "object" ? JSON.stringify(data.etim) : data.etim;
      } else if (cat === "property") {
        row.ref_id = data.pr_id;
        row.code = data.prop_class || String(data.pr_id);
        row.title = data.prop_title || fileName;
      } else if (cat === "schema") {
        row.ref_id = data.schema_id;
        row.code = data.schema_code || String(data.schema_id);
        row.title = data.schema_title || fileName;
      }

      rows.push(row);
    }
  }
  return rows;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data: roleData } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body to get single category
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body = import all (legacy) */ }

    const requestedCategory = body.category as string | undefined;
    const validCategories = ["maincategory", "subcategory", "property", "schema"];

    if (requestedCategory && !validCategories.includes(requestedCategory)) {
      return new Response(JSON.stringify({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const categories = requestedCategory ? [requestedCategory] : validCategories;
    const stats: Record<string, number> = {};

    for (const cat of categories) {
      const path = `input/data/${cat}`;
      console.log(`Fetching tree for ${path}...`);

      let files: { name: string; path: string }[];
      try {
        files = await fetchGitLabTree(path);
      } catch (e) {
        console.warn(`Skipping ${cat}: ${e}`);
        stats[cat] = 0;
        continue;
      }

      console.log(`Found ${files.length} files in ${cat}`);
      
      const rows = await fetchFilesBatched(files, cat, 15);

      if (rows.length > 0) {
        await serviceClient.from("bip_reference").delete().eq("ref_type", cat);

        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          const { error: insertError } = await serviceClient.from("bip_reference").insert(batch);
          if (insertError) {
            console.error(`Insert error for ${cat} batch ${i}:`, insertError);
          }
        }
      }

      stats[cat] = rows.length;
    }

    const total = Object.values(stats).reduce((a, b) => a + b, 0);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Imported ${total} BIP reference items`,
        stats,
        category: requestedCategory || "all",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("bip-import error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
