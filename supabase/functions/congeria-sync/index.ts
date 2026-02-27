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
  return trimmed
    .replace(/ \//g, '/')
    .replace(/%20\//g, '/');
}

function getMimeType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.pdf')) return 'application/pdf';
  if (lower.includes('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.includes('.doc')) return 'application/msword';
  if (lower.includes('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.includes('.xls')) return 'application/vnd.ms-excel';
  if (lower.includes('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.includes('.ppt')) return 'application/vnd.ms-powerpoint';
  return 'application/octet-stream';
}

const DOC_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip', '.dwg', '.ifc'];

function isDocumentUrl(url: string): boolean {
  const lower = url.toLowerCase().split('?')[0];
  return DOC_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function extractFileName(url: string): string {
  const urlParts = url.split('/');
  let name = urlParts[urlParts.length - 1];
  try { name = decodeURIComponent(name); } catch { /* keep original */ }
  name = name.split('?')[0];
  return name;
}

/** Parse document links from the Firecrawl links array */
function parseLinksArray(links: string[]): ParsedDocument[] {
  const docs: ParsedDocument[] = [];
  for (const link of links) {
    if (isDocumentUrl(link)) {
      docs.push({
        name: extractFileName(link),
        url: link,
        mimeType: getMimeType(link),
      });
    }
  }
  return docs;
}

/** Parse document links from raw HTML content (handles SPA download links) */
function parseHtmlContent(html: string): ParsedDocument[] {
  const docs: ParsedDocument[] = [];
  const seen = new Set<string>();

  // Match href attributes containing document extensions
  const hrefRegex = /href\s*=\s*["']([^"']+?)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    if (isDocumentUrl(href) && !seen.has(href)) {
      seen.add(href);
      docs.push({ name: extractFileName(href), url: href, mimeType: getMimeType(href) });
    }
  }

  // Also match data-url, data-href, data-download attributes
  const dataRegex = /data-(?:url|href|download)\s*=\s*["']([^"']+?)["']/gi;
  while ((match = dataRegex.exec(html)) !== null) {
    const href = match[1];
    if (isDocumentUrl(href) && !seen.has(href)) {
      seen.add(href);
      docs.push({ name: extractFileName(href), url: href, mimeType: getMimeType(href) });
    }
  }

  return docs;
}

async function downloadDocument(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { buildingFmGuid, action } = await req.json();

    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ── test-scrape: diagnostic action returning raw scrape results ──
    if (action === 'test-scrape' && buildingFmGuid) {
      if (!firecrawlKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Firecrawl connector not configured. Enable it in Settings → Connectors.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: linkData, error: linkError } = await supabase
        .from('building_external_links')
        .select('external_url, external_id')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('system_name', 'congeria')
        .single();

      if (linkError || !linkData?.external_url) {
        return new Response(
          JSON.stringify({ success: false, error: 'No Congeria URL configured for this building', details: linkError?.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const folderUrl = normalizeCongeriaUrl(linkData.external_url);

      const resp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: folderUrl, formats: ['links', 'html'], waitFor: 8000, timeout: 60000, onlyMainContent: false }),
      });

      const scraped = resp.ok ? await resp.json() : { error: await resp.text() };
      const links = scraped.data?.links || [];
      const html = scraped.data?.html || '';

      const fromLinks = parseLinksArray(links);
      const fromHtml = parseHtmlContent(html);

      // Merge deduplicated
      const allUrls = new Set(fromLinks.map(d => d.url));
      const merged = [...fromLinks];
      for (const doc of fromHtml) {
        if (!allUrls.has(doc.url)) { merged.push(doc); allUrls.add(doc.url); }
      }

      return new Response(
        JSON.stringify({
          success: true,
          folderUrl,
          totalLinksFound: links.length,
          htmlLength: html.length,
          documentsFromLinks: fromLinks.length,
          documentsFromHtml: fromHtml.length,
          totalDocuments: merged.length,
          documents: merged.map(d => ({ name: d.name, url: d.url, mimeType: d.mimeType })),
          sampleLinks: links.slice(0, 20),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── sync: main document sync ──
    if (action === 'sync' && buildingFmGuid) {
      const { data: linkData, error: linkError } = await supabase
        .from('building_external_links')
        .select('external_url, external_id')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('system_name', 'congeria')
        .single();

      if (linkError || !linkData?.external_url) {
        return new Response(
          JSON.stringify({ success: false, error: 'No Congeria URL configured for this building', details: linkError?.message }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!firecrawlKey) {
        return new Response(
          JSON.stringify({ success: false, error: 'Firecrawl connector not configured. Enable it in Settings → Connectors.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const folderUrl = normalizeCongeriaUrl(linkData.external_url);
      console.log(`[Congeria Sync] Scraping ${folderUrl} for building ${buildingFmGuid}`);

      const runScrape = async (opts: { waitFor: number; timeout: number }) => {
        return await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: folderUrl, formats: ['links', 'html'], waitFor: opts.waitFor, timeout: opts.timeout, onlyMainContent: false }),
        });
      };

      // Try fast scrape first, then heavier render
      let scrapeResponse = await runScrape({ waitFor: 0, timeout: 30000 });
      if (!scrapeResponse.ok) {
        await scrapeResponse.text();
        console.log('[Congeria Sync] Fast scrape failed, trying with waitFor...');
        scrapeResponse = await runScrape({ waitFor: 8000, timeout: 90000 });
      }

      if (!scrapeResponse.ok) {
        const errorText = await scrapeResponse.text();
        console.error('[Congeria Sync] Firecrawl error:', errorText);
        return new Response(
          JSON.stringify({ success: false, error: 'Could not fetch Congeria page automatically. Use manual upload instead.', code: 'SCRAPE_TIMEOUT', suggestion: 'manual_upload', folderUrl }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const scraped = await scrapeResponse.json();
      const html = scraped.data?.html || '';
      const links = scraped.data?.links || [];

      console.log(`[Congeria Sync] Found ${links.length} links, HTML length: ${html.length}`);

      // Parse documents from both links array and HTML content
      const fromLinks = parseLinksArray(links);
      const fromHtml = parseHtmlContent(html);
      const allUrls = new Set(fromLinks.map(d => d.url));
      const documents = [...fromLinks];
      for (const doc of fromHtml) {
        if (!allUrls.has(doc.url)) { documents.push(doc); allUrls.add(doc.url); }
      }

      console.log(`[Congeria Sync] Identified ${documents.length} documents (${fromLinks.length} from links, ${fromHtml.length} from HTML)`);

      if (documents.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'No documents found on page. Try manual upload.', suggestion: 'manual_upload', scrapedLinksCount: links.length, documentsFound: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const urlPath = folderUrl.split('#/')[1] || '';
      const folderPath = decodeURIComponent(urlPath);

      let syncedCount = 0;
      let failedCount = 0;
      const errors: string[] = [];

      for (const doc of documents) {
        try {
          console.log(`[Congeria Sync] Processing: ${doc.name}`);
          const fileData = await downloadDocument(doc.url);
          if (!fileData) { failedCount++; errors.push(`Failed to download: ${doc.name}`); continue; }

          const storagePath = `${buildingFmGuid}/${doc.name}`;
          await supabase.storage.from('documents').remove([storagePath]);

          const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(storagePath, fileData, { contentType: doc.mimeType, upsert: true });

          if (uploadError) { console.error(`[Congeria Sync] Upload error for ${doc.name}:`, uploadError); failedCount++; errors.push(`Upload failed: ${doc.name}`); continue; }

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
              metadata: { congeria_path: folderPath, original_url: doc.url },
            }, { onConflict: 'building_fm_guid,file_path' });

          if (dbError) console.error(`[Congeria Sync] DB error for ${doc.name}:`, dbError);

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
          buildingFmGuid, folderUrl: linkData.external_url, documentsFound: documents.length, syncedCount, failedCount,
          errors: errors.length > 0 ? errors : undefined,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'test-connection') {
      const hasFirecrawl = !!firecrawlKey;
      return new Response(
        JSON.stringify({ success: true, message: hasFirecrawl ? 'Firecrawl connector is configured and ready' : 'Firecrawl connector not configured', hasFirecrawl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Invalid action', validActions: ['sync', 'test-connection', 'test-scrape'] }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Congeria Sync] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
