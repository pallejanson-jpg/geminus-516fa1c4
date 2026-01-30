import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

// Validate that query is read-only (SELECT only)
function validateReadOnlyQuery(sql: string): boolean {
  const normalized = sql.toLowerCase().trim();
  if (!normalized.startsWith('select')) return false;
  const forbidden = ['drop', 'delete', 'update', 'insert', 'alter', 'create', 'truncate', 'grant', 'revoke'];
  for (const word of forbidden) {
    // Check for word boundaries to avoid false positives
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(normalized)) return false;
  }
  return true;
}

// Extract SQL query from AI response
function extractSqlQuery(content: string): string | null {
  const sqlMatch = content.match(/```sql\s*([\s\S]*?)\s*```/i);
  if (sqlMatch) {
    const sql = sqlMatch[1].trim();
    if (validateReadOnlyQuery(sql)) {
      return sql;
    }
  }
  return null;
}

// Execute raw SQL query (read-only)
async function executeQuery(supabase: any, sql: string): Promise<any> {
  // Use the Supabase client to execute raw SQL via rpc or direct query
  // For safety, we'll use the assets table with filters parsed from the SQL
  // This is a simplified approach - for complex queries, consider using pg directly
  
  try {
    // For simple COUNT queries
    if (sql.toLowerCase().includes('count(*)')) {
      const tableName = sql.match(/from\s+(\w+)/i)?.[1] || 'assets';
      const whereMatch = sql.match(/where\s+(.+?)(?:\s+(?:order|group|limit|$))/i);
      
      let query = supabase.from(tableName).select('*', { count: 'exact', head: true });
      
      // Parse simple WHERE conditions
      if (whereMatch) {
        const conditions = whereMatch[1];
        // Handle category = 'X'
        const categoryMatch = conditions.match(/category\s*=\s*'([^']+)'/i);
        if (categoryMatch) {
          query = query.eq('category', categoryMatch[1]);
        }
        // Handle building_fm_guid = 'X'
        const buildingMatch = conditions.match(/building_fm_guid\s*=\s*'([^']+)'/i);
        if (buildingMatch) {
          query = query.eq('building_fm_guid', buildingMatch[1]);
        }
        // Handle level_fm_guid = 'X'
        const levelMatch = conditions.match(/level_fm_guid\s*=\s*'([^']+)'/i);
        if (levelMatch) {
          query = query.eq('level_fm_guid', levelMatch[1]);
        }
      }
      
      const { count, error } = await query;
      if (error) throw error;
      return { count };
    }
    
    // For SELECT queries with specific columns
    const selectMatch = sql.match(/select\s+(.+?)\s+from/i);
    const tableName = sql.match(/from\s+(\w+)/i)?.[1] || 'assets';
    const limitMatch = sql.match(/limit\s+(\d+)/i);
    const orderMatch = sql.match(/order\s+by\s+(\w+)(?:\s+(asc|desc))?/i);
    const whereMatch = sql.match(/where\s+(.+?)(?:\s+(?:order|group|limit|$))/i);
    
    let query = supabase.from(tableName).select('*');
    
    // Apply WHERE conditions
    if (whereMatch) {
      const conditions = whereMatch[1];
      const categoryMatch = conditions.match(/category\s*=\s*'([^']+)'/i);
      if (categoryMatch) {
        query = query.eq('category', categoryMatch[1]);
      }
      const buildingMatch = conditions.match(/building_fm_guid\s*=\s*'([^']+)'/i);
      if (buildingMatch) {
        query = query.eq('building_fm_guid', buildingMatch[1]);
      }
      const levelMatch = conditions.match(/level_fm_guid\s*=\s*'([^']+)'/i);
      if (levelMatch) {
        query = query.eq('level_fm_guid', levelMatch[1]);
      }
      const inRoomMatch = conditions.match(/in_room_fm_guid\s*=\s*'([^']+)'/i);
      if (inRoomMatch) {
        query = query.eq('in_room_fm_guid', inRoomMatch[1]);
      }
    }
    
    // Apply ORDER BY
    if (orderMatch) {
      const column = orderMatch[1];
      const ascending = orderMatch[2]?.toLowerCase() !== 'desc';
      query = query.order(column, { ascending });
    }
    
    // Apply LIMIT
    if (limitMatch) {
      query = query.limit(parseInt(limitMatch[1]));
    } else {
      query = query.limit(100); // Default limit for safety
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Query execution error:', error);
    throw error;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify authentication
  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const { messages, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Initialize Supabase client to query asset data
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if we have a current building context
    const currentBuildingFmGuid = context?.currentBuilding?.fmGuid;
    const currentBuildingName = context?.currentBuilding?.name;

    // Get comprehensive asset statistics for context
    const [
      globalCategoryCounts,
      totalAssets,
      buildingsList,
      buildingSpecificCounts,
    ] = await Promise.all([
      // Global category counts
      supabase.from("assets").select("category").then(({ data }) => {
        const counts: Record<string, number> = {};
        data?.forEach((item) => {
          counts[item.category] = (counts[item.category] || 0) + 1;
        });
        return counts;
      }),
      // Total count
      supabase.from("assets").select("*", { count: "exact", head: true }).then(({ count }) => count || 0),
      // Buildings list for context
      supabase.from("assets").select("fm_guid, common_name, name").eq("category", "Building").limit(50),
      // Building-specific counts (if in a building context)
      currentBuildingFmGuid
        ? supabase.from("assets").select("category").eq("building_fm_guid", currentBuildingFmGuid).then(({ data }) => {
            const counts: Record<string, number> = {};
            data?.forEach((item) => {
              counts[item.category] = (counts[item.category] || 0) + 1;
            });
            return counts;
          })
        : Promise.resolve(null),
    ]);

    // Build current context section
    let currentContextSection = "";
    if (context) {
      currentContextSection = `
NUVARANDE KONTEXT (var användaren befinner sig):
- Aktiv vy: ${context.activeApp || 'Okänd'}`;
      
      if (context.currentBuilding) {
        currentContextSection += `
- Aktiv byggnad: ${context.currentBuilding.name} (fmGuid: ${context.currentBuilding.fmGuid})`;
      }
      if (context.currentStorey) {
        currentContextSection += `
- Aktivt våningsplan: ${context.currentStorey.name} (fmGuid: ${context.currentStorey.fmGuid})`;
      }
      if (context.currentSpace) {
        currentContextSection += `
- Aktivt rum: ${context.currentSpace.name} (fmGuid: ${context.currentSpace.fmGuid})`;
      }
      if (context.viewerState) {
        currentContextSection += `
- 3D Viewer: ${context.viewerState.viewMode} läge, ${context.viewerState.visibleFloorFmGuids?.length || 0} våningsplan synliga`;
      }
    }

    // Build buildings list for reference
    const buildingsInfo = buildingsList.data?.map(b => 
      `  - ${b.common_name || b.name || 'Okänd'}: ${b.fm_guid}`
    ).join('\n') || '  (Inga byggnader synkade)';

    // Build data statistics section - prioritize building-specific if available
    let dataStatsSection = "";
    if (currentBuildingFmGuid && buildingSpecificCounts) {
      // Show building-specific stats prominently
      dataStatsSection = `
STATISTIK FÖR AKTUELL BYGGNAD (${currentBuildingName}):
  - Våningsplan (Building Storey): ${buildingSpecificCounts['Building Storey'] || 0}
  - Rum (Space): ${buildingSpecificCounts['Space'] || 0}
  - Inventarier/Tillgångar (Instance): ${buildingSpecificCounts['Instance'] || 0}
  - Dörrar (Door): ${buildingSpecificCounts['Door'] || 0}

GLOBAL STATISTIK (hela databasen - för referens):
- Totalt: ${totalAssets} objekt
  - Byggnader (Building): ${globalCategoryCounts['Building'] || 0}
  - Våningsplan (Building Storey): ${globalCategoryCounts['Building Storey'] || 0}
  - Rum (Space): ${globalCategoryCounts['Space'] || 0}
  - Inventarier/Tillgångar (Instance): ${globalCategoryCounts['Instance'] || 0}
  - Dörrar (Door): ${globalCategoryCounts['Door'] || 0}`;
    } else {
      // No building context - show global stats
      dataStatsSection = `
GLOBAL STATISTIK (hela databasen):
- Totalt: ${totalAssets} objekt
  - Byggnader (Building): ${globalCategoryCounts['Building'] || 0}
  - Våningsplan (Building Storey): ${globalCategoryCounts['Building Storey'] || 0}
  - Rum (Space): ${globalCategoryCounts['Space'] || 0}
  - Inventarier/Tillgångar (Instance): ${globalCategoryCounts['Instance'] || 0}
  - Dörrar (Door): ${globalCategoryCounts['Door'] || 0}`;
    }

    // Build context about the data
    const dataContext = `
Du är Gunnar, en intelligent AI-assistent för ett fastighetssystem. Du hjälper användare att utforska och förstå sina byggnader och tillgångar.

${currentContextSection}

TILLGÄNGLIG DATA I DATABASEN (tabell: assets):
${dataStatsSection}

BYGGNADER I SYSTEMET:
${buildingsInfo}

${currentContextSection}

DATABASKOLUMNER I ASSETS-TABELLEN:
- fm_guid: Unik identifierare (UUID)
- common_name: Beskrivande namn
- name: Tekniskt namn
- category: 'Building' | 'Building Storey' | 'Space' | 'Instance' | 'Door'
- building_fm_guid: Referens till byggnad
- level_fm_guid: Referens till våningsplan
- in_room_fm_guid: Referens till rum (för Instance/tillgångar)
- gross_area: Yta i m²
- asset_type: Typ av tillgång (t.ex. brandsläckare)
- attributes: JSONB med utökade egenskaper (golvmaterial, tak, etc.)

FRÅGEEXEMPEL DU KAN BESVARA DIREKT:
- "Hur många rum finns i [byggnad]?" → Räkna Space med rätt building_fm_guid
- "Vilka våningsplan har [byggnad]?" → Lista Building Storey för byggnaden
- "Hur många tillgångar finns på [plan]?" → Räkna Instance på level_fm_guid
- "Hur stor area har [byggnad/rum]?" → Summera gross_area

OM DU BEHÖVER DATA FÖR ATT SVARA:
Generera en SQL-fråga i detta format:
\`\`\`sql
SELECT ... FROM assets WHERE ...
\`\`\`

Jag kommer köra frågan och ge dig resultatet. Använd ENDAST SELECT-satser!

ACTIONS DU KAN RETURNERA:
Om användaren vill SE objekt i systemet, returnera en JSON-block:

1. Visa objekt i Navigatorn:
\`\`\`json
{"action": "selectInTree", "fmGuids": ["guid1", "guid2"]}
\`\`\`

2. Visa ett våningsplan i 3D (om i viewer):
\`\`\`json
{"action": "showFloor", "floorFmGuid": "guid"}
\`\`\`

3. Markera objekt i 3D:
\`\`\`json
{"action": "highlight", "fmGuids": ["guid1", "guid2"]}
\`\`\`

4. Växla vy-läge:
\`\`\`json
{"action": "switchTo2D"}
\`\`\`
eller
\`\`\`json
{"action": "switchTo3D"}
\`\`\`

5. Flyga till ett objekt:
\`\`\`json
{"action": "flyTo", "fmGuid": "guid"}
\`\`\`

VIKTIGA REGLER:
1. Svara på samma språk som frågan (svenska/engelska)
2. Var koncis och tydlig
3. **KRITISKT**: Om användaren är på en specifik byggnad (se "Aktiv byggnad" i kontexten), anta ALLTID att frågor handlar om den byggnaden om inte annat specificeras. ANVÄND ALLTID building_fm_guid i SQL-frågor när det finns en aktiv byggnad.
4. När du svarar om en byggnad, använd ENDAST statistik från den byggnaden - INTE global statistik.
5. Om du refererar till en specifik byggnad, använd dess fmGuid i WHERE-villkor: building_fm_guid = '[fmGuid]'
6. Ge alltid konkreta siffror när du har data
7. Om du inte kan svara, förklara varför och föreslå alternativ

Svara nu på användarens fråga:
`;

    // First AI call to understand the question and potentially generate SQL
    const firstResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: dataContext },
          ...messages,
        ],
        stream: false,
      }),
    });

    if (!firstResponse.ok) {
      const errorText = await firstResponse.text();
      console.error("First AI call error:", firstResponse.status, errorText);
      
      if (firstResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (firstResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const firstResult = await firstResponse.json();
    const firstContent = firstResult.choices?.[0]?.message?.content || "";

    // Check if AI generated a SQL query
    const sqlQuery = extractSqlQuery(firstContent);
    
    if (sqlQuery) {
      console.log("Executing SQL query:", sqlQuery);
      
      try {
        const queryResult = await executeQuery(supabase, sqlQuery);
        
        // Second AI call with query results
        const secondResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: dataContext },
              ...messages,
              { role: "assistant", content: firstContent },
              { role: "user", content: `Här är resultatet av din SQL-fråga:\n\n${JSON.stringify(queryResult, null, 2)}\n\nFormulera nu ett tydligt och koncist svar till användaren baserat på detta resultat. INKLUDERA INTE SQL-koden i ditt svar.` },
            ],
            stream: true,
          }),
        });

        if (!secondResponse.ok) {
          throw new Error("Second AI call failed");
        }

        return new Response(secondResponse.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      } catch (queryError) {
        console.error("Query execution failed:", queryError);
        // Fall back to streaming the original response without query
      }
    }

    // If no SQL query or query failed, stream the first response
    const streamResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: dataContext },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!streamResponse.ok) {
      if (streamResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (streamResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    return new Response(streamResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Gunnar chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
