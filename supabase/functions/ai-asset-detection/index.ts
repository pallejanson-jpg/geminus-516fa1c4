import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIvionToken, testIvionConnection, getIvionConfigStatus, isTokenExpired } from "../_shared/ivion-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Environment
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Ivion API URL
const IVION_API_URL = (Deno.env.get('IVION_API_URL') || '').trim().replace(/\/+$/, '');

// Filename patterns for different NavVis scanner versions
type FilenamePattern = (i: number) => string;

const FILENAME_PATTERNS: { name: string; pattern: FilenamePattern }[] = [
  { name: 'dash-pano-5', pattern: (i: number) => `${String(i).padStart(5, '0')}-pano.jpg` },
  { name: 'simple-5', pattern: (i: number) => `${String(i).padStart(5, '0')}.jpg` },
  { name: 'pano-prefix-5', pattern: (i: number) => `pano_${String(i).padStart(5, '0')}.jpg` },
  { name: 'panorama-simple', pattern: (i: number) => `panorama_${i}.jpg` },
  { name: 'img-6', pattern: (i: number) => `img_${String(i).padStart(6, '0')}.jpg` },
  { name: 'dash-pano-4', pattern: (i: number) => `${String(i).padStart(4, '0')}-pano.jpg` },
  { name: 'simple-4', pattern: (i: number) => `${String(i).padStart(4, '0')}.jpg` },
];

const DIRECTORY_PATTERNS = [
  'pano',           // Standard
  'panorama',       // Alternative
  'images',         // Alternative
  'pano_high',      // High-res
];

// Types
interface DetectionTemplate {
  id: string;
  name: string;
  object_type: string;
  description: string | null;
  ai_prompt: string;
  default_symbol_id: string | null;
  default_category: string | null;
  is_active: boolean;
  example_images: string[] | null;
}

interface ExtractedProperties {
  brand?: string;
  model?: string;
  size?: string;
  type?: string;
  color?: string;
  mounting?: string;
  condition?: string;
  text_visible?: string;
}

interface Detection {
  object_type: string;
  confidence: number;
  bounding_box: [number, number, number, number];
  description: string;
  extracted_properties?: ExtractedProperties;
}

interface ScanJob {
  id: string;
  building_fm_guid: string;
  ivion_site_id: string;
  templates: string[];
  status: string;
  total_images: number;
  processed_images: number;
  current_dataset: string | null;
  current_image_index: number;
  detections_found: number;
}

interface IvionDataset {
  name: string;
  id?: number;
  type?: string;
}

interface IvionImage {
  id: number;
  filePath?: string;
  name?: string;
  pose?: {
    position: { x: number; y: number; z: number };
    orientation?: { x: number; y: number; z: number; w: number };
  };
  timestamp?: number;
}

// Get detection templates
async function getTemplates(): Promise<DetectionTemplate[]> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data, error } = await supabase
    .from('detection_templates')
    .select('*')
    .eq('is_active', true)
    .order('name');
  
  if (error) throw new Error(`Failed to get templates: ${error.message}`);
  return data || [];
}

// Get pending detections
async function getPendingDetections(params: {
  buildingFmGuid?: string;
  scanJobId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ detections: any[]; total: number }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  let query = supabase
    .from('pending_detections')
    .select('*, detection_templates(*)', { count: 'exact' });
  
  if (params.buildingFmGuid) {
    query = query.eq('building_fm_guid', params.buildingFmGuid);
  }
  if (params.scanJobId) {
    query = query.eq('scan_job_id', params.scanJobId);
  }
  if (params.status) {
    query = query.eq('status', params.status);
  }
  
  query = query
    .order('confidence', { ascending: false })
    .range(params.offset || 0, (params.offset || 0) + (params.limit || 50) - 1);
  
  const { data, error, count } = await query;
  
  if (error) throw new Error(`Failed to get pending detections: ${error.message}`);
  return { detections: data || [], total: count || 0 };
}

// Cleanup stale scan jobs - mark old running jobs as failed
async function cleanupStaleScanJobs(): Promise<number> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Mark stale running jobs as failed (no update in 30 min)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  const { data: staleRunning } = await supabase
    .from('scan_jobs')
    .update({ 
      status: 'failed', 
      error_message: 'Automatiskt avbruten - ingen aktivitet på 30 minuter',
      completed_at: new Date().toISOString()
    })
    .eq('status', 'running')
    .lt('started_at', thirtyMinAgo)
    .is('completed_at', null)
    .select('id');
  
  // Mark old queued jobs as cancelled (created >1 hour ago)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { data: staleQueued } = await supabase
    .from('scan_jobs')
    .update({ 
      status: 'cancelled', 
      error_message: 'Automatiskt avbruten - aldrig startad',
      completed_at: new Date().toISOString()
    })
    .eq('status', 'queued')
    .lt('created_at', oneHourAgo)
    .select('id');
  
  const cleaned = (staleRunning?.length || 0) + (staleQueued?.length || 0);
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} stale scan jobs`);
  }
  return cleaned;
}

// Get scan jobs
async function getScanJobs(params: {
  buildingFmGuid?: string;
  status?: string;
}): Promise<any[]> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Auto-cleanup stale jobs before returning the list
  await cleanupStaleScanJobs();
  
  let query = supabase.from('scan_jobs').select('*');
  
  if (params.buildingFmGuid) {
    query = query.eq('building_fm_guid', params.buildingFmGuid);
  }
  if (params.status) {
    query = query.eq('status', params.status);
  }
  
  query = query.order('created_at', { ascending: false });
  
  const { data, error } = await query;
  if (error) throw new Error(`Failed to get scan jobs: ${error.message}`);
  return data || [];
}

// Get datasets from Ivion
async function getIvionDatasets(siteId: string): Promise<IvionDataset[]> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/datasets`, {
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get datasets: ${response.status} - ${text.slice(0, 200)}`);
  }
  
  return response.json();
}

// Parse poses.csv to extract image metadata
function parsePosesCsv(csvText: string): IvionImage[] {
  const lines = csvText.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  
  return lines.map(line => {
    // Support both semicolon and comma as delimiters
    const delimiter = line.includes(';') ? ';' : ',';
    const parts = line.split(delimiter).map(s => s.trim());
    const [id, filename, timestamp, posX, posY, posZ, oriW, oriX, oriY, oriZ] = parts;
    
    return {
      id: parseInt(id) || 0,
      filePath: filename,
      name: filename,
      pose: {
        position: { 
          x: parseFloat(posX) || 0, 
          y: parseFloat(posY) || 0, 
          z: parseFloat(posZ) || 0 
        },
        orientation: { 
          x: parseFloat(oriX) || 0, 
          y: parseFloat(oriY) || 0, 
          z: parseFloat(oriZ) || 0, 
          w: parseFloat(oriW) || 1 
        }
      },
      timestamp: parseFloat(timestamp) || 0
    };
  }).filter(img => img.filePath); // Filter out any malformed entries
}

// Discover dataset files using NavVis Storage List API
async function discoverDatasetFiles(
  siteId: string,
  datasetName: string
): Promise<{ filenames: string[]; directory: string; source: string }> {
  const token = await getIvionToken();
  
  console.log(`[Discovery] Attempting to discover files for dataset ${datasetName}`);
  
  // Try different directories
  for (const dir of DIRECTORY_PATTERNS) {
    // Method 1: Try Storage List API
    const listUrl = `${IVION_API_URL}/api/site/${siteId}/storage/list/datasets_web/${datasetName}/${dir}`;
    console.log(`[Discovery] Trying Storage List API: ${listUrl.slice(0, 120)}...`);
    
    try {
      const resp = await fetch(listUrl, {
        headers: { 
          'x-authorization': `Bearer ${token}`, 
          'Accept': 'application/json' 
        },
      });
      
      console.log(`[Discovery] Storage List response: ${resp.status}`);
      
      if (resp.ok) {
        const data = await resp.json();
        // NavVis returns different formats: array, { files: [...] }, { items: [...] }
        let files: any[] = [];
        if (Array.isArray(data)) {
          files = data;
        } else if (data.files && Array.isArray(data.files)) {
          files = data.files;
        } else if (data.items && Array.isArray(data.items)) {
          files = data.items;
        } else if (data.content && Array.isArray(data.content)) {
          files = data.content;
        }
        
        // Extract filenames - filter for images only
        const imageFiles = files
          .map((f: any) => typeof f === 'string' ? f : (f.name || f.filename || f.path || ''))
          .filter((name: string) => name && /\.(jpg|jpeg|png)$/i.test(name));
        
        if (imageFiles.length > 0) {
          console.log(`[Discovery] Found ${imageFiles.length} images via Storage List API in ${dir}/`);
          return { filenames: imageFiles, directory: dir, source: 'storage-list-api' };
        }
      } else {
        await resp.text(); // consume
      }
    } catch (e) {
      console.log(`[Discovery] Storage List API failed: ${e}`);
    }
  }
  
  // Method 2: Probe different filename patterns in different directories
  console.log('[Discovery] Storage List API unavailable, probing filename patterns...');
  
  for (const dir of DIRECTORY_PATTERNS) {
    for (const { name, pattern } of FILENAME_PATTERNS) {
      const testFilename = pattern(0);
      const testUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/${dir}/${testFilename}`;
      
      console.log(`[Discovery] Testing pattern "${name}" in ${dir}/: ${testFilename}`);
      
      const exists = await verifyImageUrlWithGet(testUrl, token);
      if (exists) {
        console.log(`[Discovery] ✓ Found working pattern: "${name}" in ${dir}/ (${testFilename})`);
        return { filenames: [testFilename], directory: dir, source: `pattern:${name}` };
      }
    }
  }
  
  console.log('[Discovery] ✗ No working filename pattern found');
  return { filenames: [], directory: 'pano', source: 'none' };
}

// Probe images using a specific pattern
async function probeWithPattern(
  siteId: string,
  datasetName: string,
  directory: string,
  pattern: FilenamePattern,
  maxImages: number,
  token: string
): Promise<IvionImage[]> {
  const images: IvionImage[] = [];
  const baseUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/${directory}`;
  
  const batchSize = 10;
  let index = 0;
  let consecutiveFailures = 0;
  
  while (index < maxImages && consecutiveFailures < 5) {
    // Create batch of probe requests
    const batch: { index: number; filename: string }[] = [];
    for (let i = 0; i < batchSize && (index + i) < maxImages; i++) {
      const filename = pattern(index + i);
      batch.push({ index: index + i, filename });
    }
    
    // Execute batch in parallel
    const results = await Promise.all(
      batch.map(async ({ index: idx, filename }) => {
        const url = `${baseUrl}/${filename}`;
        try {
          const response = await fetch(url, {
            method: 'HEAD',
            headers: { 'x-authorization': `Bearer ${token}` },
            redirect: 'manual',
          });
          return { index: idx, filename, exists: response.status === 200 || response.status === 302 };
        } catch {
          return { index: idx, filename, exists: false };
        }
      })
    );
    
    // Process results
    let batchHadSuccess = false;
    for (const result of results) {
      if (result.exists) {
        images.push({
          id: result.index,
          filePath: result.filename,
          name: result.filename,
        });
        consecutiveFailures = 0;
        batchHadSuccess = true;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= 5) break;
      }
    }
    
    if (!batchHadSuccess) break;
    index += batchSize;
  }
  
  return images;
}

// Probe for images in a dataset - now with discovery and multiple patterns
async function probeDatasetImages(
  siteId: string,
  datasetName: string,
  maxImages: number = 500
): Promise<IvionImage[]> {
  const token = await getIvionToken();
  
  // First: try to discover files directly via API or pattern probing
  const discovered = await discoverDatasetFiles(siteId, datasetName);
  
  // If we got filenames from Storage List API, use those directly
  if (discovered.source === 'storage-list-api' && discovered.filenames.length > 0) {
    console.log(`Using ${discovered.filenames.length} files from Storage List API`);
    return discovered.filenames.slice(0, maxImages).map((f, i) => ({
      id: i,
      filePath: f,
      name: f,
    }));
  }
  
  // If we discovered a working pattern, probe using it
  if (discovered.source.startsWith('pattern:')) {
    const patternName = discovered.source.replace('pattern:', '');
    const matchedPattern = FILENAME_PATTERNS.find(p => p.name === patternName);
    if (matchedPattern) {
      console.log(`Probing with discovered pattern: ${patternName} in ${discovered.directory}/`);
      const images = await probeWithPattern(
        siteId, 
        datasetName, 
        discovered.directory, 
        matchedPattern.pattern, 
        maxImages, 
        token
      );
      if (images.length > 0) {
        console.log(`Probed ${images.length} images using pattern ${patternName}`);
        return images;
      }
    }
  }
  
  // Fallback: try each pattern in sequence until one works
  console.log('No pattern discovered, trying all patterns in sequence...');
  for (const dir of DIRECTORY_PATTERNS) {
    for (const { name, pattern } of FILENAME_PATTERNS) {
      // Quick test with image 0
      const testUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/${dir}/${pattern(0)}`;
      const exists = await verifyImageUrlWithGet(testUrl, token);
      
      if (exists) {
        console.log(`Found working pattern: ${name} in ${dir}/`);
        const images = await probeWithPattern(siteId, datasetName, dir, pattern, maxImages, token);
        if (images.length > 0) {
          console.log(`Probed ${images.length} images for dataset ${datasetName}`);
          return images;
        }
      }
    }
  }
  
  console.log(`No images found for dataset ${datasetName} with any pattern`);
  return [];
}

// Get images from a dataset - tries poses.csv first, falls back to probing
async function getDatasetImages(siteId: string, datasetName: string): Promise<IvionImage[]> {
  const token = await getIvionToken();
  
  // Try poses.csv first (for future compatibility)
  const posesUrl = `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/poses.csv`;
  
  try {
    const response = await fetch(posesUrl, {
      headers: {
        'x-authorization': `Bearer ${token}`,
        'Accept': 'text/csv, text/plain, */*',
      },
    });
    
    if (response.ok) {
      const csvText = await response.text();
      const images = parsePosesCsv(csvText);
      if (images.length > 0) {
        console.log(`Found ${images.length} images via poses.csv for ${datasetName}`);
        return images;
      }
    } else {
      // Consume body to avoid resource leak
      await response.text();
    }
  } catch (e) {
    console.log(`poses.csv not available for ${datasetName}, falling back to probing`);
  }
  
  // Fallback: probe for images
  return await probeDatasetImages(siteId, datasetName, 200);
}

// Verify URL with mini-GET (Range request) to ensure image is actually downloadable
async function verifyImageUrlWithGet(url: string, token: string): Promise<boolean> {
  try {
    // Use Range request to only fetch first 1KB - enough to verify access
    const response = await fetch(url, {
      method: 'GET',
      headers: { 
        'x-authorization': `Bearer ${token}`,
        'Range': 'bytes=0-1023'
      },
      redirect: 'follow',
    });
    
    // 200 = full content (server doesn't support range), 206 = partial content (range worked)
    if (response.status === 200 || response.status === 206) {
      const contentType = response.headers.get('content-type') || '';
      // Verify it's actually an image
      if (contentType.startsWith('image/')) {
        await response.arrayBuffer(); // consume
        return true;
      }
    }
    await response.text(); // consume body
    return false;
  } catch (e) {
    return false;
  }
}

// Get panorama image URL using filename from poses.csv - now with GET verification
async function getPanoramaImageUrl(
  siteId: string,
  datasetName: string,
  imageFilename: string
): Promise<string | null> {
  const token = await getIvionToken();
  
  // URL patterns based on NavVis file structure
  const patterns = [
    // Primary: via storage redirect API (most common working pattern)
    `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/pano/${imageFilename}`,
    // Alternative directories
    `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/panorama/${imageFilename}`,
    `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/images/${imageFilename}`,
    // Direct data paths
    `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/pano/${imageFilename}`,
    `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/panorama/${imageFilename}`,
    // High-res alternatives
    `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/pano_high/${imageFilename}`,
    `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/pano_high/${imageFilename}`,
  ];
  
  for (const url of patterns) {
    // Use mini-GET verification instead of HEAD to ensure actual download works
    const isValid = await verifyImageUrlWithGet(url, token);
    if (isValid) {
      console.log(`Verified image URL (GET): ${url.slice(0, 100)}...`);
      return url;
    }
  }
  
  console.log(`No downloadable URL found for image ${imageFilename} in dataset ${datasetName}`);
  return null;
}

// Download image and convert to base64 - handles NavVis redirect chain with improved fallbacks
async function downloadImageAsBase64(url: string): Promise<string> {
  const token = await getIvionToken();
  
  console.log(`Attempting to download: ${url.slice(0, 120)}...`);
  
  // Method 1: Try with redirect: 'follow' to let Deno handle redirects automatically
  try {
    const directResponse = await fetch(url, {
      headers: { 'x-authorization': `Bearer ${token}` },
      redirect: 'follow',
    });
    
    if (directResponse.ok) {
      const contentType = directResponse.headers.get('content-type') || 'unknown';
      console.log(`Direct download successful! Type: ${contentType}`);
      return bufferToBase64(await directResponse.arrayBuffer());
    }
    console.log(`Direct download returned: ${directResponse.status}`);
  } catch (e) {
    console.log(`Direct download failed: ${e}`);
  }
  
  // Method 2: Try alternative URL patterns
  const alternativePatterns: string[] = [];
  
  // If URL uses storage/redirect, try /data/ path instead
  if (url.includes('/storage/redirect/')) {
    const dataUrl = url.replace('/api/site/', '/data/').replace('/storage/redirect/', '/');
    alternativePatterns.push(dataUrl);
  }
  
  // If URL uses /api/site/, try direct /data/ path
  if (url.includes('/api/site/')) {
    const siteMatch = url.match(/\/api\/site\/([^/]+)\/(.*)/);
    if (siteMatch) {
      alternativePatterns.push(`${IVION_API_URL}/data/${siteMatch[1]}/${siteMatch[2]}`);
    }
  }
  
  for (const altUrl of alternativePatterns) {
    console.log(`Trying alternative URL: ${altUrl.slice(0, 100)}...`);
    try {
      const response = await fetch(altUrl, {
        headers: { 'x-authorization': `Bearer ${token}` },
        redirect: 'follow',
      });
      
      if (response.ok) {
        console.log(`Alternative URL worked!`);
        return bufferToBase64(await response.arrayBuffer());
      }
      console.log(`Alternative returned: ${response.status}`);
    } catch (e) {
      console.log(`Alternative failed: ${e}`);
    }
  }
  
  // Method 3: Manual redirect following with auth on each hop
  let currentUrl = url;
  let depth = 0;
  const maxDepth = 5;
  
  while (depth < maxDepth) {
    const headers: Record<string, string> = { 'x-authorization': `Bearer ${token}` };
    
    console.log(`Manual hop ${depth + 1}: ${currentUrl.slice(0, 100)}...`);
    
    const response = await fetch(currentUrl, {
      headers,
      redirect: 'manual',
    });
    
    console.log(`Status: ${response.status}`);
    
    // Follow redirects
    if (response.status === 301 || response.status === 302 || 
        response.status === 307 || response.status === 308) {
      const location = response.headers.get('location');
      await response.text(); // consume body
      
      if (!location) {
        throw new Error('Redirect without location header');
      }
      
      // Resolve relative URLs against the current URL
      currentUrl = location.startsWith('http') 
        ? location 
        : new URL(location, currentUrl).href;
      
      depth++;
      continue;
    }
    
    // Success - download the image
    if (response.ok) {
      const contentType = response.headers.get('content-type') || 'unknown';
      console.log(`Image found via manual redirect! Type: ${contentType}`);
      return bufferToBase64(await response.arrayBuffer());
    }
    
    // Not a redirect and not OK - failed
    throw new Error(`Download failed with status: ${response.status}`);
  }
  
  throw new Error(`Failed to download after ${maxDepth} redirects`);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Analyze image with Gemini Vision - Enhanced with property extraction and few-shot learning
async function analyzeImageWithAI(
  imageBase64: string,
  templates: DetectionTemplate[]
): Promise<Detection[]> {
  // Build content array with example images for few-shot learning
  const userContent: any[] = [];
  
  // Add example images for each template that has them
  const templatesWithExamples = templates.filter(t => t.example_images && t.example_images.length > 0);
  if (templatesWithExamples.length > 0) {
    userContent.push({
      type: "text",
      text: "Here are example images of objects you should look for:"
    });
    
    for (const template of templatesWithExamples) {
      userContent.push({
        type: "text",
        text: `Examples of ${template.object_type} (${template.name}):`
      });
      
      for (const exampleUrl of template.example_images!) {
        userContent.push({
          type: "image_url",
          image_url: { url: exampleUrl }
        });
      }
    }
    
    userContent.push({
      type: "text",
      text: "\nNow analyze the following 360° panorama and find these objects:"
    });
  }
  
  // Add object descriptions
  const objectDescriptions = templates.map(t => 
    `- ${t.object_type}: ${t.ai_prompt}`
  ).join('\n');
  
  userContent.push({ 
    type: "text", 
    text: `Detect these objects in this 360° panorama and extract detailed properties:\n${objectDescriptions}` 
  });
  
  // Add the panorama image to analyze
  userContent.push({ 
    type: "image_url", 
    image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
  });
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are an expert at detecting safety equipment in 360° equirectangular panorama images.
You have excellent OCR capabilities and can read text on labels, stickers, and equipment.

For each object you find, return JSON with:
- object_type: the type code from the list below
- confidence: your confidence level (0.0 to 1.0)
- bounding_box: [ymin, xmin, ymax, xmax] normalized to 0-1000 scale
- description: detailed description of what you see including any visible text
- extracted_properties: an object with these fields (include only if you can determine them):
  - brand: manufacturer name if visible (e.g., 'Gloria', 'Ansul', 'Presto', 'Housegard')
  - model: model number or name if visible on labels/stickers
  - size: capacity or size (e.g., '6 kg', '2 kg', 'A3', '9L')
  - type: specific type (e.g., 'Pulver ABC', 'CO2', 'Skum', 'Vatten')
  - color: primary color of the object
  - mounting: how it's installed ('Väggmonterad', 'Golvstående', 'I skåp', 'Takmontering')
  - condition: visible condition ('God', 'Sliten', 'Ny', 'Okänd')
  - text_visible: all readable text you can see on labels, stickers, or the object itself

IMPORTANT: Use OCR to read ALL visible text on labels, stickers, and equipment. 
Extract brand and model from visible text when possible.
If a property cannot be determined with reasonable confidence, omit it.
When example images are provided, use them to better understand what each object type looks like.

Return ONLY a JSON array. If nothing found, return []. Do not include any other text or markdown.`
        },
        {
          role: "user",
          content: userContent
        }
      ]
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI API error: ${response.status} - ${error.slice(0, 200)}`);
  }
  
  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || '[]';
  
  console.log('AI raw response (first 500 chars):', content.slice(0, 500));
  console.log('AI response length:', content.length);
  
  // Robust JSON array extraction that handles nested arrays (e.g., bounding_box: [1,2,3,4])
  // The old regex /\[[\s\S]*?\]/ was non-greedy and broke on nested arrays
  function extractJsonArray(text: string): string | null {
    const start = text.indexOf('[');
    if (start === -1) return null;
    
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }
  
  const jsonString = extractJsonArray(content);
  if (!jsonString) {
    console.log('No JSON array found in AI response!');
    console.log('Full response:', content);
    return [];
  }
  
  console.log('Extracted JSON length:', jsonString.length);
  
  try {
    const parsed = JSON.parse(jsonString);
    console.log('Parsed detections count:', parsed.length);
    return parsed;
  } catch (e) {
    console.log('Failed to parse JSON:', e);
    console.log('Extracted JSON (first 500):', jsonString.slice(0, 500));
    return [];
  }
}

// Convert 2D bounding box to 3D world coordinates
function imageToWorldCoords(
  bbox: { ymin: number; xmin: number; ymax: number; xmax: number },
  cameraPos: { x: number; y: number; z: number },
  imageWidth: number = 1000,
  imageHeight: number = 1000,
  estimatedDepth: number = 2.0
): { x: number; y: number; z: number } {
  const centerX = (bbox.xmin + bbox.xmax) / 2;
  const centerY = (bbox.ymin + bbox.ymax) / 2;
  
  // Equirectangular projection
  const longitude = ((centerX / imageWidth) - 0.5) * 2 * Math.PI;
  const latitude = (0.5 - (centerY / imageHeight)) * Math.PI;
  
  // Spherical to Cartesian
  const dirX = Math.cos(latitude) * Math.sin(longitude);
  const dirY = Math.sin(latitude);
  const dirZ = Math.cos(latitude) * Math.cos(longitude);
  
  return {
    x: cameraPos.x + dirX * estimatedDepth,
    y: cameraPos.y + dirY * estimatedDepth,
    z: cameraPos.z + dirZ * estimatedDepth
  };
}

// Save thumbnail to Supabase Storage - with 20% margin around object
async function saveThumbnail(
  imageBase64: string,
  boundingBox: { ymin: number; xmin: number; ymax: number; xmax: number },
  detectionId: string
): Promise<string | null> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Add 20% margin around the bounding box for better context
    const margin = 0.2;
    const boxWidth = boundingBox.xmax - boundingBox.xmin;
    const boxHeight = boundingBox.ymax - boundingBox.ymin;
    
    const expandedBbox = {
      ymin: Math.max(0, boundingBox.ymin - boxHeight * margin),
      xmin: Math.max(0, boundingBox.xmin - boxWidth * margin),
      ymax: Math.min(1000, boundingBox.ymax + boxHeight * margin),
      xmax: Math.min(1000, boundingBox.xmax + boxWidth * margin),
    };
    
    console.log(`Thumbnail bbox: original (${boundingBox.xmin},${boundingBox.ymin})-(${boundingBox.xmax},${boundingBox.ymax}), ` +
                `expanded (${expandedBbox.xmin.toFixed(0)},${expandedBbox.ymin.toFixed(0)})-(${expandedBbox.xmax.toFixed(0)},${expandedBbox.ymax.toFixed(0)})`);
    
    // Decode base64 to bytes
    const binaryStr = atob(imageBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    // Note: We're saving the full panorama for now
    // In a future update, we could use a server-side image processing library
    // to crop the image to the expanded bounding box
    
    const fileName = `${detectionId}.jpg`;
    
    const { error } = await supabase.storage
      .from('detection-thumbnails')
      .upload(fileName, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    
    if (error) {
      console.error('Failed to save thumbnail:', error);
      return null;
    }
    
    const { data } = supabase.storage
      .from('detection-thumbnails')
      .getPublicUrl(fileName);
    
    return data.publicUrl;
  } catch (e) {
    console.error('Thumbnail save error:', e);
    return null;
  }
}

// Start a new scan job
async function startScan(params: {
  buildingFmGuid: string;
  ivionSiteId: string;
  templates: string[];
  userId: string;
}): Promise<ScanJob> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Create scan job
  const { data: job, error } = await supabase
    .from('scan_jobs')
    .insert({
      building_fm_guid: params.buildingFmGuid,
      ivion_site_id: params.ivionSiteId,
      templates: params.templates,
      status: 'queued',
      created_by: params.userId,
    })
    .select()
    .single();
  
  if (error) throw new Error(`Failed to create scan job: ${error.message}`);
  
  return job;
}

// Cancel a scan job
async function cancelScan(scanJobId: string): Promise<{ success: boolean }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { error } = await supabase
    .from('scan_jobs')
    .update({ 
      status: 'cancelled',
      completed_at: new Date().toISOString()
    })
    .eq('id', scanJobId);
  
  if (error) throw new Error(`Failed to cancel scan: ${error.message}`);
  return { success: true };
}

// Update a detection template
async function updateTemplate(params: {
  templateId: string;
  name?: string;
  object_type?: string;
  description?: string | null;
  ai_prompt?: string;
  default_category?: string | null;
  default_symbol_id?: string | null;
  is_active?: boolean;
  example_images?: string[];
}): Promise<{ success: boolean }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const updates: Record<string, any> = {
    updated_at: new Date().toISOString()
  };
  
  if (params.name !== undefined) updates.name = params.name;
  if (params.object_type !== undefined) updates.object_type = params.object_type;
  if (params.description !== undefined) updates.description = params.description;
  if (params.ai_prompt !== undefined) updates.ai_prompt = params.ai_prompt;
  if (params.default_category !== undefined) updates.default_category = params.default_category;
  if (params.default_symbol_id !== undefined) updates.default_symbol_id = params.default_symbol_id;
  if (params.is_active !== undefined) updates.is_active = params.is_active;
  if (params.example_images !== undefined) updates.example_images = params.example_images;
  
  const { error } = await supabase
    .from('detection_templates')
    .update(updates)
    .eq('id', params.templateId);
  
  if (error) throw new Error(`Failed to update template: ${error.message}`);
  return { success: true };
}

// Create a new detection template
async function createTemplate(params: {
  name: string;
  object_type: string;
  ai_prompt: string;
  description?: string | null;
  default_category?: string | null;
  default_symbol_id?: string | null;
  is_active?: boolean;
  example_images?: string[];
}): Promise<{ success: boolean; id: string }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('detection_templates')
    .insert({
      name: params.name,
      object_type: params.object_type,
      ai_prompt: params.ai_prompt,
      description: params.description || null,
      default_category: params.default_category || null,
      default_symbol_id: params.default_symbol_id || null,
      is_active: params.is_active ?? true,
      example_images: params.example_images || [],
    })
    .select('id')
    .single();
  
  if (error) throw new Error(`Failed to create template: ${error.message}`);
  return { success: true, id: data.id };
}

// Delete a detection template
async function deleteTemplate(templateId: string): Promise<{ success: boolean }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { error } = await supabase
    .from('detection_templates')
    .delete()
    .eq('id', templateId);
  
  if (error) throw new Error(`Failed to delete template: ${error.message}`);
  return { success: true };
}

// Delete a scan job and its associated detections
async function deleteScanJob(scanJobId: string): Promise<{ success: boolean }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Verify job exists and is not running
  const { data: job, error: jobError } = await supabase
    .from('scan_jobs')
    .select('status')
    .eq('id', scanJobId)
    .maybeSingle();
  
  if (jobError) {
    throw new Error(`Failed to get scan job: ${jobError.message}`);
  }
  
  if (!job) {
    throw new Error('Scan job not found');
  }
  
  if (job.status === 'running' || job.status === 'queued') {
    throw new Error('Cannot delete a running or queued scan job');
  }
  
  // Delete related pending_detections first
  const { error: detectionsError } = await supabase
    .from('pending_detections')
    .delete()
    .eq('scan_job_id', scanJobId);
  
  if (detectionsError) {
    console.error('Failed to delete detections:', detectionsError);
    // Continue anyway, main goal is to delete the job
  }
  
  // Delete the scan job
  const { error: deleteError } = await supabase
    .from('scan_jobs')
    .delete()
    .eq('id', scanJobId);
  
  if (deleteError) {
    throw new Error(`Failed to delete scan job: ${deleteError.message}`);
  }
  
  return { success: true };
}

// Process a batch of images - Full Phase 2 implementation with fail-fast
async function processBatch(params: {
  scanJobId: string;
  batchSize?: number;
}): Promise<{
  processed: number;
  detections: number;
  status: string;
  message: string;
}> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const batchSize = params.batchSize || 25;
  
  // Fail-fast configuration
  const MAX_CONSECUTIVE_DOWNLOAD_FAILURES = 10;
  const MAX_CONSECUTIVE_AI_FAILURES = 5;
  
  // 1. Get scan job
  const { data: job, error: jobError } = await supabase
    .from('scan_jobs')
    .select('*')
    .eq('id', params.scanJobId)
    .single();
  
  if (jobError || !job) {
    throw new Error('Scan job not found');
  }
  
  if (job.status === 'completed' || job.status === 'failed') {
    return {
      processed: job.processed_images || 0,
      detections: job.detections_found || 0,
      status: job.status,
      message: `Job already ${job.status}`
    };
  }
  
  // 2. Set to running
  if (job.status === 'queued') {
    await supabase
      .from('scan_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', job.id);
  }
  
  // 3. Get templates
  const templates = await getTemplates();
  const activeTemplates = templates.filter(t => job.templates.includes(t.object_type));
  
  if (activeTemplates.length === 0) {
    await supabase
      .from('scan_jobs')
      .update({ 
        status: 'failed', 
        error_message: 'No active templates found',
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    throw new Error('No active templates found for selected types');
  }
  
  // 4. Get datasets from Ivion
  let datasets: IvionDataset[];
  try {
    datasets = await getIvionDatasets(job.ivion_site_id);
  } catch (e: any) {
    await supabase
      .from('scan_jobs')
      .update({ 
        status: 'failed', 
        error_message: `Ivion-anslutning misslyckades: ${e.message}`,
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
    throw e;
  }
  
  if (datasets.length === 0) {
    await supabase
      .from('scan_jobs')
      .update({ 
        status: 'completed', 
        completed_at: new Date().toISOString(),
        error_message: 'No datasets found in Ivion site'
      })
      .eq('id', job.id);
    return {
      processed: 0,
      detections: 0,
      status: 'completed',
      message: 'No datasets found in Ivion site'
    };
  }
  
  // 5. Find resume point
  let startDatasetIndex = job.current_dataset 
    ? datasets.findIndex(d => d.name === job.current_dataset) 
    : 0;
  if (startDatasetIndex < 0) startDatasetIndex = 0;
  let startImageIndex = job.current_image_index || 0;
  
  let totalProcessed = job.processed_images || 0;
  let totalDetections = job.detections_found || 0;
  let imagesInBatch = 0;
  let errorMessages: string[] = [];
  
  // Fail-fast counters
  let consecutiveDownloadFailures = 0;
  let consecutiveAiFailures = 0;
  let downloadFailures = 0;
  let noUrlSkips = 0;
  let aiSuccesses = 0;
  let lastDownloadError = '';
  
  console.log(`Starting batch processing: ${datasets.length} datasets, resume at dataset ${startDatasetIndex}, image ${startImageIndex}`);
  
  // 6. Process datasets
  for (let di = startDatasetIndex; di < datasets.length && imagesInBatch < batchSize; di++) {
    const dataset = datasets[di];
    
    console.log(`Processing dataset ${di + 1}/${datasets.length}: ${dataset.name}`);
    
    let images: IvionImage[];
    try {
      // Use dataset.name to fetch poses.csv
      images = await getDatasetImages(job.ivion_site_id, dataset.name);
    } catch (e: any) {
      console.error(`Failed to get images for dataset ${dataset.name}:`, e);
      errorMessages.push(`Dataset ${dataset.name}: ${e.message}`);
      continue;
    }
    
    if (images.length === 0) {
      console.log(`No images in dataset ${dataset.name}`);
      continue;
    }
    
    console.log(`Dataset ${dataset.name} has ${images.length} images`);
    
    // Update total count estimate on first dataset with images (quick estimate to avoid probing all)
    if ((job.total_images === 0 || job.total_images === null) && images.length > 0) {
      // Estimate based on first dataset's image count × number of datasets with similar names
      const estimatedTotal = images.length * Math.min(datasets.length, 50);
      await supabase.from('scan_jobs').update({ total_images: estimatedTotal }).eq('id', job.id);
      console.log(`Estimated total images: ~${estimatedTotal} (based on ${images.length} in first dataset)`);
    }
    
    const imageStart = di === startDatasetIndex ? startImageIndex : 0;
    
    for (let ii = imageStart; ii < images.length && imagesInBatch < batchSize; ii++) {
      const image = images[ii];
      
      // Check fail-fast: too many consecutive download failures
      if (consecutiveDownloadFailures >= MAX_CONSECUTIVE_DOWNLOAD_FAILURES) {
        const failMessage = `Skanning avbruten: ${consecutiveDownloadFailures} bildnedladdningar misslyckades i rad. Senaste fel: ${lastDownloadError}. Kontrollera NavVis/Ivion behörigheter.`;
        console.error(failMessage);
        await supabase.from('scan_jobs').update({
          status: 'failed',
          error_message: failMessage,
          completed_at: new Date().toISOString(),
          processed_images: totalProcessed,
          detections_found: totalDetections,
        }).eq('id', job.id);
        
        return {
          processed: totalProcessed,
          detections: totalDetections,
          status: 'failed',
          message: failMessage
        };
      }
      
      // Check fail-fast: too many consecutive AI failures
      if (consecutiveAiFailures >= MAX_CONSECUTIVE_AI_FAILURES) {
        const failMessage = `Skanning avbruten: ${consecutiveAiFailures} AI-analyser misslyckades i rad. Kan vara rate-limit eller API-problem.`;
        console.error(failMessage);
        await supabase.from('scan_jobs').update({
          status: 'failed',
          error_message: failMessage,
          completed_at: new Date().toISOString(),
          processed_images: totalProcessed,
          detections_found: totalDetections,
        }).eq('id', job.id);
        
        return {
          processed: totalProcessed,
          detections: totalDetections,
          status: 'failed',
          message: failMessage
        };
      }
      
      // Use filePath from poses.csv, fallback to generated filename pattern
      const imageFilename = image.filePath || `${String(image.id).padStart(5, '0')}-pano.jpg`;
      
      console.log(`Processing image ${ii + 1}/${images.length} (file: ${imageFilename})`);
      
      try {
        // Download image using filename
        const imageUrl = await getPanoramaImageUrl(job.ivion_site_id, dataset.name, imageFilename);
        if (!imageUrl) {
          console.log(`No URL found for image ${imageFilename}, skipping`);
          noUrlSkips++;
          consecutiveDownloadFailures++;
          lastDownloadError = 'Ingen giltig URL hittades';
          totalProcessed++;
          imagesInBatch++;
          continue;
        }
        
        console.log(`Downloading image from: ${imageUrl.slice(0, 100)}...`);
        let base64: string;
        try {
          base64 = await downloadImageAsBase64(imageUrl);
          console.log(`Downloaded image, size: ${Math.round(base64.length / 1024)}KB base64`);
          consecutiveDownloadFailures = 0; // Reset on success
        } catch (dlError: any) {
          console.error(`Download failed for ${imageFilename}:`, dlError.message);
          downloadFailures++;
          consecutiveDownloadFailures++;
          lastDownloadError = dlError.message?.slice(0, 100) || 'Nedladdning misslyckades';
          errorMessages.push(`Image ${imageFilename}: ${lastDownloadError}`);
          totalProcessed++;
          imagesInBatch++;
          
          // Update error_message in real-time
          const statusMsg = `Nedladdningsfel: ${downloadFailures}/${totalProcessed}. Senaste: ${lastDownloadError}`;
          await supabase.from('scan_jobs').update({
            error_message: statusMsg,
            current_dataset: dataset.name,
            current_image_index: ii + 1,
            processed_images: totalProcessed,
          }).eq('id', job.id);
          
          continue;
        }
        
        // Analyze with AI
        console.log(`Analyzing with AI, ${activeTemplates.length} templates`);
        let detections: Detection[] = [];
        
        try {
          detections = await analyzeImageWithAI(base64, activeTemplates);
          console.log(`AI found ${detections.length} detections`);
          aiSuccesses++;
          consecutiveAiFailures = 0; // Reset on success
        } catch (aiError: any) {
          // Handle rate limits
          if (aiError.message?.includes('429') || aiError.message?.includes('rate')) {
            console.log('AI rate limited, waiting 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
              detections = await analyzeImageWithAI(base64, activeTemplates);
              aiSuccesses++;
              consecutiveAiFailures = 0;
            } catch (retryError: any) {
              console.error('AI retry failed:', retryError);
              consecutiveAiFailures++;
            }
          } else {
            console.error('AI analysis error:', aiError);
            consecutiveAiFailures++;
          }
        }
        
        // Save detections
        for (const det of detections) {
          const bbox = {
            ymin: det.bounding_box[0],
            xmin: det.bounding_box[1],
            ymax: det.bounding_box[2],
            xmax: det.bounding_box[3]
          };
          
          const coords = imageToWorldCoords(
            bbox,
            image.pose?.position || { x: 0, y: 0, z: 0 }
          );
          
          const detectionId = crypto.randomUUID();
          const template = activeTemplates.find(t => t.object_type === det.object_type);
          
          // Save thumbnail
          let thumbnailUrl: string | null = null;
          try {
            thumbnailUrl = await saveThumbnail(base64, bbox, detectionId);
          } catch (thumbError) {
            console.error('Thumbnail save failed:', thumbError);
          }
          
          const { error: insertError } = await supabase.from('pending_detections').insert({
            id: detectionId,
            scan_job_id: job.id,
            building_fm_guid: job.building_fm_guid,
            ivion_site_id: job.ivion_site_id,
            ivion_dataset_name: dataset.name,
            ivion_image_id: image.id,
            detection_template_id: template?.id || null,
            object_type: det.object_type,
            confidence: det.confidence,
            bounding_box: bbox,
            coordinate_x: coords.x,
            coordinate_y: coords.y,
            coordinate_z: coords.z,
            thumbnail_url: thumbnailUrl,
            ai_description: det.description,
            extracted_properties: det.extracted_properties || {},
            status: 'pending',
          });
          
          if (insertError) {
            console.error('Failed to save detection:', insertError);
          } else {
            totalDetections++;
            console.log(`Saved detection: ${det.object_type} (${Math.round(det.confidence * 100)}%)`);
          }
        }
        
        totalProcessed++;
        imagesInBatch++;
        
      } catch (e: any) {
        console.error(`Error processing image ${image.id}:`, e);
        errorMessages.push(`Image ${image.id}: ${e.message?.slice(0, 100)}`);
        totalProcessed++;
        imagesInBatch++;
        // Continue with next image
      }
      
      // Update progress after each image
      await supabase.from('scan_jobs').update({
        current_dataset: dataset.name,
        current_image_index: ii + 1,
        processed_images: totalProcessed,
        detections_found: totalDetections,
      }).eq('id', job.id);
    }
    
    // Reset image index for next dataset
    startImageIndex = 0;
  }
  
  // 7. Check if we've processed all images
  const { data: updatedJob } = await supabase
    .from('scan_jobs')
    .select('total_images')
    .eq('id', job.id)
    .single();
  
  const totalImages = updatedJob?.total_images || 0;
  const allDone = totalProcessed >= totalImages;
  
  if (allDone && totalImages > 0) {
    await supabase.from('scan_jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: errorMessages.length > 0 ? errorMessages.join('; ').slice(0, 500) : null,
    }).eq('id', job.id);
  }
  
  const message = allDone 
    ? `Completed. Processed ${totalProcessed} images, found ${totalDetections} detections.`
    : `Processed ${imagesInBatch} images in this batch. ${totalProcessed}/${totalImages} total.`;
  
  console.log(message);
  
  return {
    processed: totalProcessed,
    detections: totalDetections,
    status: allDone ? 'completed' : 'running',
    message
  };
}

// Get scan status
async function getScanStatus(scanJobId: string): Promise<any> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data: job, error } = await supabase
    .from('scan_jobs')
    .select('*')
    .eq('id', scanJobId)
    .single();
  
  if (error) throw new Error(`Failed to get scan status: ${error.message}`);
  return job;
}

// Approve a detection - create asset and POI with smart naming from extracted properties
async function approveDetection(params: {
  detectionId: string;
  userId: string;
}): Promise<{ success: boolean; assetFmGuid?: string; poiId?: number; message?: string }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Get detection with template
  const { data: detection, error: detError } = await supabase
    .from('pending_detections')
    .select('*, detection_templates(*)')
    .eq('id', params.detectionId)
    .single();
  
  if (detError || !detection) {
    return { success: false, message: 'Detection not found' };
  }
  
  if (detection.status !== 'pending') {
    return { success: false, message: `Detection already ${detection.status}` };
  }
  
  // Generate FMGUID for new asset
  const assetFmGuid = crypto.randomUUID();
  
  // Extract properties for smart naming
  const props = (detection.extracted_properties as ExtractedProperties) || {};
  const baseName = detection.detection_templates?.name || detection.object_type;
  
  // Generate descriptive name: "Gloria PD6GA 6kg" or fallback to template name
  const assetName = [props.brand, props.model, props.size]
    .filter(Boolean)
    .join(' ') || baseName;
  
  // Generate common_name: "Pulver ABC 6kg" or fallback
  const commonName = [props.type, props.size]
    .filter(Boolean)
    .join(' ') || baseName;
  
  // Build attributes with all extracted properties
  const attributes: Record<string, any> = {
    ai_detected: true,
    ai_confidence: detection.confidence,
    ai_description: detection.ai_description,
  };
  
  // Add auto-captured photo from detection thumbnail
  if (detection.thumbnail_url) {
    attributes.imageUrl = detection.thumbnail_url;
  }
  
  // Add extracted properties to attributes
  if (props.brand) attributes.brand = props.brand;
  if (props.model) attributes.model = props.model;
  if (props.size) attributes.size = props.size;
  if (props.type) attributes.type = props.type;
  if (props.color) attributes.color = props.color;
  if (props.mounting) attributes.mounting = props.mounting;
  if (props.condition) attributes.condition = props.condition;
  if (props.text_visible) attributes.text_visible = props.text_visible;
  
  // Create asset with smart naming and extracted properties
  const { error: assetError } = await supabase
    .from('assets')
    .insert({
      fm_guid: assetFmGuid,
      name: assetName,
      common_name: commonName,
      category: 'Instance',
      asset_type: detection.detection_templates?.default_category || detection.object_type,
      building_fm_guid: detection.building_fm_guid,
      coordinate_x: detection.coordinate_x,
      coordinate_y: detection.coordinate_y,
      coordinate_z: detection.coordinate_z,
      symbol_id: detection.detection_templates?.default_symbol_id,
      ivion_site_id: detection.ivion_site_id,
      ivion_image_id: detection.ivion_image_id,
      is_local: true,
      created_in_model: false,
      annotation_placed: true,
      attributes,
    });
  
  if (assetError) {
    return { success: false, message: `Failed to create asset: ${assetError.message}` };
  }
  
  // Update detection as approved
  await supabase
    .from('pending_detections')
    .update({
      status: 'approved',
      reviewed_by: params.userId,
      reviewed_at: new Date().toISOString(),
      created_asset_fm_guid: assetFmGuid,
    })
    .eq('id', params.detectionId);
  
  return { success: true, assetFmGuid };
}

// Reject a detection
async function rejectDetection(params: {
  detectionId: string;
  userId: string;
  reason?: string;
}): Promise<{ success: boolean; message?: string }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { error } = await supabase
    .from('pending_detections')
    .update({
      status: 'rejected',
      reviewed_by: params.userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: params.reason,
    })
    .eq('id', params.detectionId);
  
  if (error) {
    return { success: false, message: error.message };
  }
  
  return { success: true };
}

// Bulk approve high-confidence detections
async function bulkApprove(params: {
  detectionIds: string[];
  userId: string;
}): Promise<{ approved: number; failed: number }> {
  let approved = 0;
  let failed = 0;
  
  for (const id of params.detectionIds) {
    const result = await approveDetection({ detectionId: id, userId: params.userId });
    if (result.success) {
      approved++;
    } else {
      failed++;
    }
  }
  
  return { approved, failed };
}

// Bulk reject detections
async function bulkReject(params: {
  detectionIds: string[];
  userId: string;
  reason?: string;
}): Promise<{ rejected: number; failed: number }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { error, count } = await supabase
    .from('pending_detections')
    .update({
      status: 'rejected',
      reviewed_by: params.userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: params.reason,
    })
    .in('id', params.detectionIds);
  
  if (error) {
    return { rejected: 0, failed: params.detectionIds.length };
  }
  
  return { rejected: count || params.detectionIds.length, failed: 0 };
}

// Test downloading an image through the complete redirect chain
async function testImageDownload(
  siteId: string, 
  datasetName?: string, 
  imageFilename?: string
): Promise<{
  success: boolean;
  attempts: { method: string; url: string; status: number; contentType?: string; size?: number }[];
  imageSize?: number;
  contentType?: string;
  error?: string;
  testedPatterns?: string[];
  discoveryResult?: { source: string; directory: string; filesFound: number };
  suggestion?: string;
}> {
  const attempts: { method: string; url: string; status: number; contentType?: string; size?: number }[] = [];
  const testedPatterns: string[] = [];
  
  try {
    const token = await getIvionToken();
    
    // Use provided dataset or get first available
    const datasets = await getIvionDatasets(siteId);
    if (datasets.length === 0) {
      return { success: false, attempts, testedPatterns, error: 'No datasets found', suggestion: 'Verify site has uploaded datasets in NavVis admin' };
    }
    
    const testDataset = datasetName || datasets[0].name;
    
    // Step 1: Try file discovery first
    console.log(`[Test] Running file discovery for dataset ${testDataset}...`);
    const discovered = await discoverDatasetFiles(siteId, testDataset);
    
    const discoveryResult = {
      source: discovered.source,
      directory: discovered.directory,
      filesFound: discovered.filenames.length,
    };
    
    // If discovery found files, use those
    let filename = imageFilename;
    let directory = 'pano';
    
    if (discovered.filenames.length > 0) {
      filename = filename || discovered.filenames[0];
      directory = discovered.directory;
      console.log(`[Test] Using discovered file: ${filename} in ${directory}/`);
    } else if (!filename) {
      // If no discovery result and no filename provided, test all patterns
      console.log('[Test] No files discovered, testing all filename patterns...');
      
      for (const dir of DIRECTORY_PATTERNS) {
        for (const { name, pattern } of FILENAME_PATTERNS) {
          const testFile = pattern(0);
          testedPatterns.push(`${dir}/${testFile}`);
          const testUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${testDataset}/${dir}/${testFile}`;
          
          const exists = await verifyImageUrlWithGet(testUrl, token);
          if (exists) {
            console.log(`[Test] ✓ Found working pattern: ${name} in ${dir}/`);
            filename = testFile;
            directory = dir;
            break;
          }
        }
        if (filename) break;
      }
      
      if (!filename) {
        return { 
          success: false, 
          attempts, 
          testedPatterns,
          discoveryResult,
          error: 'No working filename pattern found',
          suggestion: 'Check NavVis instance for actual filename format. Common formats: 00000-pano.jpg, 00000.jpg, pano_00000.jpg'
        };
      }
    }
    
    const baseUrl = `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${testDataset}/${directory}/${filename}`;
    
    // Method 1: Let fetch follow redirects automatically
    console.log('[Test] Method 1: Auto-follow redirects with auth header');
    const resp1 = await fetch(baseUrl, {
      headers: { 'x-authorization': `Bearer ${token}` },
      redirect: 'follow',
    });
    attempts.push({ 
      method: 'auto-follow-with-auth', 
      url: baseUrl.slice(0, 150), 
      status: resp1.status,
      contentType: resp1.headers.get('content-type') || undefined,
    });
    if (resp1.ok) {
      const buffer = await resp1.arrayBuffer();
      return {
        success: true,
        attempts,
        testedPatterns,
        discoveryResult,
        imageSize: buffer.byteLength,
        contentType: resp1.headers.get('content-type') || 'unknown',
      };
    }
    await resp1.text(); // consume
    
    // Method 2: Manual first redirect, then auto-follow WITHOUT auth
    console.log('[Test] Method 2: Manual first hop, then auto-follow without auth');
    try {
      const resp2a = await fetch(baseUrl, {
        headers: { 'x-authorization': `Bearer ${token}` },
        redirect: 'manual',
      });
      if (resp2a.status === 302) {
        const location = resp2a.headers.get('location');
        await resp2a.text();
        if (location) {
          const signedUrl = location.startsWith('/') ? `${IVION_API_URL}${location}` : location;
          console.log(`[Test] Got signed URL: ${signedUrl.slice(0, 150)}...`);
          
          // Try following this without auth (signed URLs often don't need it)
          const resp2b = await fetch(signedUrl, { redirect: 'follow' });
          attempts.push({ 
            method: 'signed-url-no-auth', 
            url: signedUrl.slice(0, 150), 
            status: resp2b.status,
            contentType: resp2b.headers.get('content-type') || undefined,
          });
          if (resp2b.ok) {
            const buffer = await resp2b.arrayBuffer();
            return {
              success: true,
              attempts,
              testedPatterns,
              discoveryResult,
              imageSize: buffer.byteLength,
              contentType: resp2b.headers.get('content-type') || 'unknown',
            };
          }
          await resp2b.text();
        }
      }
    } catch (e: any) {
      console.log(`[Test] Method 2 error: ${e.message}`);
    }
    
    // Method 3: Try direct /data/ path (static files, not via storage API)
    console.log('[Test] Method 3: Direct /data/ path');
    const directUrl = `${IVION_API_URL}/data/${siteId}/datasets_web/${testDataset}/${directory}/${filename}`;
    try {
      const resp3 = await fetch(directUrl, {
        headers: { 'x-authorization': `Bearer ${token}` },
        redirect: 'follow',
      });
      attempts.push({ 
        method: 'direct-data-path', 
        url: directUrl.slice(0, 150), 
        status: resp3.status,
        contentType: resp3.headers.get('content-type') || undefined,
      });
      if (resp3.ok) {
        const buffer = await resp3.arrayBuffer();
        return {
          success: true,
          attempts,
          testedPatterns,
          discoveryResult,
          imageSize: buffer.byteLength,
          contentType: resp3.headers.get('content-type') || 'unknown',
        };
      }
      await resp3.text();
    } catch (e: any) {
      attempts.push({ method: 'direct-data-path', url: directUrl.slice(0, 150), status: -1 });
    }
    
    // Method 4: Try x-api-key instead of x-authorization
    console.log('[Test] Method 4: Try Authorization header instead of x-authorization');
    try {
      const resp4 = await fetch(baseUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
        redirect: 'follow',
      });
      attempts.push({ 
        method: 'standard-auth-header', 
        url: baseUrl.slice(0, 150), 
        status: resp4.status,
        contentType: resp4.headers.get('content-type') || undefined,
      });
      if (resp4.ok) {
        const buffer = await resp4.arrayBuffer();
        return {
          success: true,
          attempts,
          testedPatterns,
          discoveryResult,
          imageSize: buffer.byteLength,
          contentType: resp4.headers.get('content-type') || 'unknown',
        };
      }
      await resp4.text();
    } catch (e: any) {
      attempts.push({ method: 'standard-auth-header', url: baseUrl.slice(0, 150), status: -1 });
    }
    
    return { 
      success: false, 
      attempts,
      testedPatterns,
      discoveryResult,
      error: 'All download methods failed - check NavVis account permissions for image access',
      suggestion: 'Contact NavVis admin to verify the service account has storage read permissions',
    };
    
  } catch (e: any) {
    return { success: false, attempts, testedPatterns, error: e.message, suggestion: 'Check Ivion credentials and network connectivity' };
  }
}

// Test Ivion image access
async function testImageAccess(siteId: string): Promise<{
  success: boolean;
  workingPattern?: string;
  datasets?: string[];
  message: string;
}> {
  try {
    const datasets = await getIvionDatasets(siteId);
    
    if (datasets.length === 0) {
      return { success: false, message: 'No datasets found in site' };
    }
    
    // Try to find a working image URL pattern by getting poses.csv first
    const testDataset = datasets[0];
    const testImages = await getDatasetImages(siteId, testDataset.name);
    
    // Use first image filename if available, else use default pattern
    const testFilename = testImages.length > 0 && testImages[0].filePath 
      ? testImages[0].filePath 
      : '00000-pano.jpg';
    const imageUrl = await getPanoramaImageUrl(siteId, testDataset.name, testFilename);
    
    if (imageUrl) {
      return {
        success: true,
        workingPattern: imageUrl,
        datasets: datasets.map(d => d.name),
        message: `Found ${datasets.length} datasets. Image access confirmed.`
      };
    }
    
    return {
      success: false,
      datasets: datasets.map(d => d.name),
      message: `Found ${datasets.length} datasets but could not access panorama images. May need different URL pattern.`
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();
    
    // Get user from auth header for write operations
    const authHeader = req.headers.get('authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    let result: any;

    switch (action) {
      case 'get-templates':
        result = await getTemplates();
        break;

      case 'get-pending':
        result = await getPendingDetections(params);
        break;

      case 'get-scan-jobs':
        result = await getScanJobs(params);
        break;

      case 'start-scan':
        if (!userId) throw new Error('Authentication required');
        if (!params.buildingFmGuid || !params.ivionSiteId || !params.templates) {
          throw new Error('buildingFmGuid, ivionSiteId, and templates are required');
        }
        result = await startScan({ ...params, userId });
        break;

      case 'process-batch':
        if (!params.scanJobId) throw new Error('scanJobId required');
        result = await processBatch(params);
        break;

      case 'get-scan-status':
        if (!params.scanJobId) throw new Error('scanJobId required');
        result = await getScanStatus(params.scanJobId);
        break;

      case 'approve-detection':
        if (!userId) throw new Error('Authentication required');
        if (!params.detectionId) throw new Error('detectionId required');
        result = await approveDetection({ detectionId: params.detectionId, userId });
        break;

      case 'reject-detection':
        if (!userId) throw new Error('Authentication required');
        if (!params.detectionId) throw new Error('detectionId required');
        result = await rejectDetection({ 
          detectionId: params.detectionId, 
          userId, 
          reason: params.reason 
        });
        break;

      case 'bulk-approve':
        if (!userId) throw new Error('Authentication required');
        if (!params.detectionIds || !Array.isArray(params.detectionIds)) {
          throw new Error('detectionIds array required');
        }
        result = await bulkApprove({ detectionIds: params.detectionIds, userId });
        break;

      case 'bulk-reject':
        if (!userId) throw new Error('Authentication required');
        if (!params.detectionIds || !Array.isArray(params.detectionIds)) {
          throw new Error('detectionIds array required');
        }
        result = await bulkReject({ 
          detectionIds: params.detectionIds, 
          userId, 
          reason: params.reason 
        });
        break;

      case 'test-image-access':
        if (!params.siteId) throw new Error('siteId required');
        result = await testImageAccess(params.siteId);
        break;

      case 'test-image-download':
        if (!params.siteId) throw new Error('siteId required');
        result = await testImageDownload(params.siteId, params.datasetName, params.imageFilename);
        break;

      case 'cancel-scan':
        if (!params.scanJobId) throw new Error('scanJobId required');
        result = await cancelScan(params.scanJobId);
        break;

      case 'delete-scan-job':
        if (!params.scanJobId) throw new Error('scanJobId required');
        result = await deleteScanJob(params.scanJobId);
        break;

      case 'update-template':
        if (!params.templateId) throw new Error('templateId required');
        result = await updateTemplate(params);
        break;

      case 'create-template':
        if (!params.name || !params.object_type || !params.ai_prompt) {
          throw new Error('name, object_type, and ai_prompt are required');
        }
        result = await createTemplate(params);
        break;

      case 'delete-template':
        if (!params.templateId) throw new Error('templateId required');
        result = await deleteTemplate(params.templateId);
        break;

      case 'analyze-screenshot': {
        // Browser-based scan: receives a screenshot captured by the frontend SDK
        if (!params.scanJobId) throw new Error('scanJobId required');
        if (!params.screenshotBase64) throw new Error('screenshotBase64 required');
        
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        // Get scan job to find templates
        const { data: scanJob, error: sjErr } = await supabase
          .from('scan_jobs')
          .select('*')
          .eq('id', params.scanJobId)
          .single();
        if (sjErr || !scanJob) throw new Error('Scan job not found');
        
        // Get active templates for this job
        const { data: tpls } = await supabase
          .from('detection_templates')
          .select('*')
          .in('object_type', scanJob.templates)
          .eq('is_active', true);
        
        if (!tpls || tpls.length === 0) {
          result = { detections: 0, message: 'No active templates' };
          break;
        }
        
        // Run AI analysis on the screenshot
        const detections = await analyzeImageWithAI(params.screenshotBase64, tpls);
        
        // Calculate 3D coordinates from image position if available
        const cameraPos = params.imagePosition || { x: 0, y: 0, z: 0 };
        
        // Store detections
        let savedCount = 0;
        for (const det of detections) {
          if (det.confidence < 0.3) continue;
          
          const bbox = {
            ymin: det.bounding_box[0],
            xmin: det.bounding_box[1],
            ymax: det.bounding_box[2],
            xmax: det.bounding_box[3],
          };
          
          const worldCoords = imageToWorldCoords(bbox, cameraPos);
          
          const matchingTemplate = tpls.find(t => t.object_type === det.object_type);
          
          const detectionId = crypto.randomUUID();
          
          // Try to save thumbnail
          let thumbnailUrl: string | null = null;
          try {
            thumbnailUrl = await saveThumbnail(params.screenshotBase64, bbox, detectionId);
          } catch (e) {
            console.error('Thumbnail save failed:', e);
          }
          
          const { error: insertErr } = await supabase
            .from('pending_detections')
            .insert({
              id: detectionId,
              scan_job_id: params.scanJobId,
              building_fm_guid: scanJob.building_fm_guid,
              ivion_site_id: scanJob.ivion_site_id,
              ivion_image_id: params.imageId || null,
              ivion_dataset_name: params.datasetName || null,
              object_type: det.object_type,
              confidence: det.confidence,
              bounding_box: bbox,
              ai_description: det.description,
              extracted_properties: det.extracted_properties || null,
              coordinate_x: worldCoords.x,
              coordinate_y: worldCoords.y,
              coordinate_z: worldCoords.z,
              thumbnail_url: thumbnailUrl,
              detection_template_id: matchingTemplate?.id || null,
              status: 'pending',
            });
          
          if (!insertErr) savedCount++;
        }
        
        // Update scan job progress
        await supabase.from('scan_jobs').update({
          processed_images: (scanJob.processed_images || 0) + 1,
          detections_found: (scanJob.detections_found || 0) + savedCount,
          status: 'running',
          started_at: scanJob.started_at || new Date().toISOString(),
        }).eq('id', params.scanJobId);
        
        result = { detections: savedCount, totalInImage: detections.length };
        break;
      }

      case 'complete-browser-scan': {
        if (!params.scanJobId) throw new Error('scanJobId required');
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        await supabase.from('scan_jobs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', params.scanJobId);
        result = { success: true };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('AI Asset Detection error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
