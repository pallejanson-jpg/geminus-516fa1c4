import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Environment
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Ivion credentials
const IVION_API_URL = (Deno.env.get('IVION_API_URL') || '').trim().replace(/\/+$/, '');
const IVION_ACCESS_TOKEN = (Deno.env.get('IVION_ACCESS_TOKEN') || '').trim();
const IVION_REFRESH_TOKEN = (Deno.env.get('IVION_REFRESH_TOKEN') || '').trim();

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
}

interface Detection {
  object_type: string;
  confidence: number;
  bounding_box: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  description: string;
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

// Cached Ivion token
let cachedToken: string | null = null;

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    const exp = payload.exp;
    if (!exp) return true;
    const now = Math.floor(Date.now() / 1000);
    return now >= (exp - 60);
  } catch {
    return true;
  }
}

async function getIvionToken(): Promise<string> {
  if (cachedToken && !isTokenExpired(cachedToken)) {
    return cachedToken;
  }
  
  if (IVION_ACCESS_TOKEN && !isTokenExpired(IVION_ACCESS_TOKEN)) {
    return IVION_ACCESS_TOKEN;
  }
  
  if (IVION_REFRESH_TOKEN) {
    try {
      const refreshResponse = await fetch(`${IVION_API_URL}/api/auth/refresh_access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ refresh_token: IVION_REFRESH_TOKEN }),
      });
      
      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        if (data.access_token) {
          cachedToken = data.access_token;
          return data.access_token;
        }
      }
    } catch (e) {
      console.log(`Refresh token error: ${e}`);
    }
  }
  
  throw new Error('Ivion access token expired or not configured');
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

// Get scan jobs
async function getScanJobs(params: {
  buildingFmGuid?: string;
  status?: string;
}): Promise<any[]> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
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

// Get images from a specific dataset
async function getDatasetImages(siteId: string, datasetId: number | string): Promise<IvionImage[]> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/datasets/${datasetId}/images`, {
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });
  
  if (!response.ok) {
    console.log(`Failed to get images for dataset ${datasetId}: ${response.status}`);
    return [];
  }
  
  const data = await response.json();
  
  // Handle different response formats
  if (Array.isArray(data)) {
    return data;
  }
  
  if (data.images && Array.isArray(data.images)) {
    return data.images;
  }
  
  if (data.data && Array.isArray(data.data)) {
    return data.data;
  }
  
  console.log('Unexpected images response format:', JSON.stringify(data).slice(0, 200));
  return [];
}

// Try to get panorama image URL - probe multiple patterns
async function getPanoramaImageUrl(
  siteId: string,
  datasetName: string,
  imageId: number
): Promise<string | null> {
  const token = await getIvionToken();
  
  // Pattern candidates for panorama image access
  const patterns = [
    // Pattern 1: storage/redirect with datasets_web
    `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/pano_high/${imageId}-pano.jpg`,
    // Pattern 2: Alternative pano path
    `${IVION_API_URL}/api/site/${siteId}/storage/redirect/datasets_web/${datasetName}/images/high/${imageId}.jpg`,
    // Pattern 3: Direct data path
    `${IVION_API_URL}/data/${siteId}/datasets_web/${datasetName}/pano_high/${imageId}-pano.jpg`,
  ];
  
  for (const url of patterns) {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'x-authorization': `Bearer ${token}` },
        redirect: 'manual',
      });
      
      // 302 redirect means we found the right URL pattern
      if (response.status === 302 || response.status === 200) {
        return url;
      }
    } catch (e) {
      // Continue to next pattern
    }
  }
  
  return null;
}

// Download image and convert to base64
async function downloadImageAsBase64(url: string): Promise<string> {
  const token = await getIvionToken();
  
  const response = await fetch(url, {
    headers: { 'x-authorization': `Bearer ${token}` },
    redirect: 'follow',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Analyze image with Gemini Vision
async function analyzeImageWithAI(
  imageBase64: string,
  templates: DetectionTemplate[]
): Promise<Detection[]> {
  const objectDescriptions = templates.map(t => 
    `- ${t.object_type}: ${t.ai_prompt}`
  ).join('\n');
  
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

For each object you find, return JSON with:
- object_type: the type code from the list below
- confidence: your confidence level (0.0 to 1.0)
- bounding_box: [ymin, xmin, ymax, xmax] normalized to 0-1000 scale
- description: brief description of what you see

Return ONLY a JSON array. If nothing found, return []. Do not include any other text or markdown.`
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Detect these objects in this 360° panorama:\n${objectDescriptions}` 
            },
            { 
              type: "image_url", 
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
            }
          ]
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
  
  // Parse JSON from response (handle markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];
  
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.log('Failed to parse AI response:', content.slice(0, 500));
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

// Save thumbnail to Supabase Storage
async function saveThumbnail(
  imageBase64: string,
  boundingBox: { ymin: number; xmin: number; ymax: number; xmax: number },
  detectionId: string
): Promise<string | null> {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Decode base64 to bytes
    const binaryStr = atob(imageBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
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

// Process a batch of images - Full Phase 2 implementation
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
  const batchSize = params.batchSize || 3; // Smaller batch for memory with large panoramas
  
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
      .update({ status: 'failed', error_message: 'No active templates found' })
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
      .update({ status: 'failed', error_message: e.message })
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
  
  console.log(`Starting batch processing: ${datasets.length} datasets, resume at dataset ${startDatasetIndex}, image ${startImageIndex}`);
  
  // 6. Process datasets
  for (let di = startDatasetIndex; di < datasets.length && imagesInBatch < batchSize; di++) {
    const dataset = datasets[di];
    const datasetId = dataset.id || dataset.name;
    
    console.log(`Processing dataset ${di + 1}/${datasets.length}: ${dataset.name}`);
    
    let images: IvionImage[];
    try {
      images = await getDatasetImages(job.ivion_site_id, datasetId);
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
    
    // Update total count on first pass of first dataset
    if (di === 0 && startImageIndex === 0 && (job.total_images === 0 || job.total_images === null)) {
      // Calculate actual total across all datasets
      let estimatedTotal = 0;
      for (const ds of datasets) {
        try {
          const dsImages = await getDatasetImages(job.ivion_site_id, ds.id || ds.name);
          estimatedTotal += dsImages.length;
        } catch {
          estimatedTotal += 100; // Fallback estimate
        }
      }
      await supabase.from('scan_jobs').update({ total_images: estimatedTotal }).eq('id', job.id);
      console.log(`Estimated total images: ${estimatedTotal}`);
    }
    
    const imageStart = di === startDatasetIndex ? startImageIndex : 0;
    
    for (let ii = imageStart; ii < images.length && imagesInBatch < batchSize; ii++) {
      const image = images[ii];
      
      console.log(`Processing image ${ii + 1}/${images.length} (ID: ${image.id})`);
      
      try {
        // Download image
        const imageUrl = await getPanoramaImageUrl(job.ivion_site_id, dataset.name, image.id);
        if (!imageUrl) {
          console.log(`No URL found for image ${image.id}, skipping`);
          totalProcessed++;
          imagesInBatch++;
          continue;
        }
        
        console.log(`Downloading image from: ${imageUrl.slice(0, 100)}...`);
        const base64 = await downloadImageAsBase64(imageUrl);
        console.log(`Downloaded image, size: ${Math.round(base64.length / 1024)}KB base64`);
        
        // Analyze with AI
        console.log(`Analyzing with AI, ${activeTemplates.length} templates`);
        let detections: Detection[] = [];
        
        try {
          detections = await analyzeImageWithAI(base64, activeTemplates);
          console.log(`AI found ${detections.length} detections`);
        } catch (aiError: any) {
          // Handle rate limits
          if (aiError.message?.includes('429') || aiError.message?.includes('rate')) {
            console.log('AI rate limited, waiting 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            try {
              detections = await analyzeImageWithAI(base64, activeTemplates);
            } catch (retryError) {
              console.error('AI retry failed:', retryError);
            }
          } else {
            console.error('AI analysis error:', aiError);
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

// Approve a detection - create asset and POI
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
  
  // Create asset
  const { error: assetError } = await supabase
    .from('assets')
    .insert({
      fm_guid: assetFmGuid,
      name: detection.detection_templates?.name || detection.object_type,
      common_name: detection.detection_templates?.name || detection.object_type,
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
      attributes: {
        ai_detected: true,
        ai_confidence: detection.confidence,
        ai_description: detection.ai_description,
      },
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
    
    // Try to find a working image URL pattern
    const testDataset = datasets[0];
    const imageUrl = await getPanoramaImageUrl(siteId, testDataset.name, 1);
    
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
