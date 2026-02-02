import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { buildingFmGuid, action } = await req.json();

    const username = Deno.env.get("CONGERIA_USERNAME");
    const password = Deno.env.get("CONGERIA_PASSWORD");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!username || !password) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Congeria credentials not configured' 
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (action === 'sync' && buildingFmGuid) {
      // Get the Congeria URL for this building
      const { data: linkData, error: linkError } = await supabase
        .from('building_external_links')
        .select('external_url, external_id')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('system_name', 'congeria')
        .single();

      if (linkError || !linkData?.external_url) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'No Congeria URL configured for this building',
            details: linkError?.message
          }),
          { 
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      // TODO: Implement actual Congeria session-based sync
      // 1. Login to Congeria with credentials
      // 2. Navigate to the folder URL
      // 3. Parse HTML to extract document list
      // 4. Download each document
      // 5. Upload to Supabase Storage
      // 6. Insert/update documents table

      // For now, return placeholder response
      console.log(`[Congeria Sync] Would sync building ${buildingFmGuid} from ${linkData.external_url}`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Congeria sync initiated (placeholder - actual implementation pending)',
          buildingFmGuid,
          folderUrl: linkData.external_url,
          note: 'Session-based scraping requires additional implementation for Congeria auth flow'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'test-connection') {
      // Test if we can connect to Congeria
      // This would attempt a login and verify credentials work
      console.log('[Congeria] Testing connection...');
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Connection test placeholder - credentials exist',
          hasCredentials: !!(username && password)
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Invalid action',
        validActions: ['sync', 'test-connection']
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Congeria Sync] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
