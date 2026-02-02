import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface ParsedDocument {
  name: string;
  url: string;
  size?: number;
  mimeType?: string;
  folder?: string;
}

function normalizeCongeriaUrl(url: string): string {
  const trimmed = (url || '').trim();
  // Common user-input issue: trailing space before a slash in the hash path
  // Example: "Småviken%20/DoU" should be "Småviken/DoU"
  return trimmed
    .replace(/ \//g, '/')
    .replace(/%20\//g, '/');
}

// Parse document links from HTML content
function parseDocumentLinks(html: string, links: string[]): ParsedDocument[] {
  const documents: ParsedDocument[] = [];
  
  // Filter links that look like document downloads
  const docExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip'];
  
  for (const link of links) {
    const lowerLink = link.toLowerCase();
    const isDocument = docExtensions.some(ext => lowerLink.includes(ext));
    
    if (isDocument) {
      // Extract filename from URL
      const urlParts = link.split('/');
      let name = urlParts[urlParts.length - 1];
      
      // Decode URL-encoded characters
      try {
        name = decodeURIComponent(name);
      } catch {
        // Keep original if decoding fails
      }
      
      // Remove query parameters from filename
      name = name.split('?')[0];
      
      // Determine mime type from extension
      let mimeType = 'application/octet-stream';
      if (lowerLink.includes('.pdf')) mimeType = 'application/pdf';
      else if (lowerLink.includes('.doc')) mimeType = 'application/msword';
      else if (lowerLink.includes('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (lowerLink.includes('.xls')) mimeType = 'application/vnd.ms-excel';
      else if (lowerLink.includes('.xlsx')) mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      
      documents.push({
        name,
        url: link,
        mimeType,
      });
    }
  }
  
  return documents;
}

// Download a document from URL
async function downloadDocument(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      console.error(`Failed to download ${url}: ${response.status}`);
      return null;
    }
    
    return await response.arrayBuffer();
  } catch (error) {
    console.error(`Error downloading ${url}:`, error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { buildingFmGuid, action } = await req.json();

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey);

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

      // Check if Firecrawl is configured
      if (!firecrawlKey) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Firecrawl connector not configured. Please enable it in Settings → Connectors.',
          }),
          { 
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }

      const folderUrl = normalizeCongeriaUrl(linkData.external_url);
      console.log(`[Congeria Sync] Scraping ${folderUrl} for building ${buildingFmGuid}`);

      const runScrape = async (opts: { waitFor: number; timeout: number }) => {
        const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: folderUrl,
            // Only ask for links to keep scraping lightweight
            formats: ['links'],
            waitFor: opts.waitFor,
            timeout: opts.timeout,
            onlyMainContent: false,
          }),
        });
        return resp;
      };

      // Try a fast scrape first (avoids heavy JS rendering stalls)
      let scrapeResponse = await runScrape({ waitFor: 0, timeout: 30000 });

      // If the fast scrape fails/timeouts, try a heavier render
      if (!scrapeResponse.ok) {
        // Consume body before retry
        await scrapeResponse.text();
        console.log('[Congeria Sync] Fast scrape failed, trying with waitFor...');
        scrapeResponse = await runScrape({ waitFor: 8000, timeout: 90000 });
      }

      // If still failing, return user-friendly error suggesting manual upload
      if (!scrapeResponse.ok) {
        const errorText = await scrapeResponse.text();
        console.error('[Congeria Sync] Firecrawl error:', errorText);
        
        // Parse error for user-friendly message
        let userMessage = 'Congeria-sidan kunde inte hämtas automatiskt.';
        try {
          const errJson = JSON.parse(errorText);
          if (errJson.code === 'SCRAPE_TIMEOUT') {
            userMessage = 'Congeria-sidan tog för lång tid att ladda. Använd manuell uppladdning istället.';
          }
        } catch { /* ignore parse error */ }

        return new Response(
          JSON.stringify({
            success: false,
            error: userMessage,
            code: 'SCRAPE_TIMEOUT',
            suggestion: 'manual_upload',
            folderUrl,
          }),
          {
            status: 200, // Return 200 so frontend can show friendly message
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const scraped = await scrapeResponse.json();
      const html = scraped.data?.html || '';
      const links = scraped.data?.links || [];

      console.log(`[Congeria Sync] Found ${links.length} links on page`);

      // Parse document links from the scraped content
      const documents = parseDocumentLinks(html, links);
      
      console.log(`[Congeria Sync] Identified ${documents.length} documents`);

      if (documents.length === 0) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Inga dokument hittades på sidan. Prova manuell uppladdning.',
            suggestion: 'manual_upload',
            scrapedLinksCount: links.length,
            documentsFound: 0,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Extract folder path from Congeria URL for metadata
      const urlPath = folderUrl.split('#/')[1] || '';
      const folderPath = decodeURIComponent(urlPath);

      // Process each document
      let syncedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const doc of documents) {
        try {
          console.log(`[Congeria Sync] Processing: ${doc.name}`);
          
          // Download the document
          const fileData = await downloadDocument(doc.url);
          
          if (!fileData) {
            failedCount++;
            errors.push(`Failed to download: ${doc.name}`);
            continue;
          }

          const storagePath = `${buildingFmGuid}/${doc.name}`;
          
          // Upload to Supabase Storage (upsert by removing first if exists)
          await supabase.storage.from('documents').remove([storagePath]);
          
          const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(storagePath, fileData, {
              contentType: doc.mimeType,
              upsert: true,
            });

          if (uploadError) {
            console.error(`[Congeria Sync] Upload error for ${doc.name}:`, uploadError);
            failedCount++;
            errors.push(`Upload failed: ${doc.name}`);
            continue;
          }

          // Upsert document metadata
          const { error: dbError } = await supabase
            .from('documents')
            .upsert({
              building_fm_guid: buildingFmGuid,
              file_name: doc.name,
              file_path: storagePath,
              file_size: fileData.byteLength,
              mime_type: doc.mimeType,
              source_system: 'congeria',
              source_url: doc.url,
              synced_at: new Date().toISOString(),
              metadata: {
                congeria_path: folderPath,
                original_url: doc.url,
              },
            }, {
              onConflict: 'building_fm_guid,file_path',
            });

          if (dbError) {
            console.error(`[Congeria Sync] DB error for ${doc.name}:`, dbError);
            // Document is in storage but metadata failed - still count as partial success
          }

          syncedCount++;
          console.log(`[Congeria Sync] Successfully synced: ${doc.name}`);
        } catch (docError) {
          console.error(`[Congeria Sync] Error processing ${doc.name}:`, docError);
          failedCount++;
          errors.push(`Error: ${doc.name}`);
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Synced ${syncedCount} documents${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
          buildingFmGuid,
          folderUrl: linkData.external_url,
          documentsFound: documents.length,
          syncedCount,
          failedCount,
          errors: errors.length > 0 ? errors : undefined,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'test-connection') {
      // Test if Firecrawl is configured
      const hasFirecrawl = !!firecrawlKey;
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: hasFirecrawl 
            ? 'Firecrawl connector is configured and ready'
            : 'Firecrawl connector not configured',
          hasFirecrawl,
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
