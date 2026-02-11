import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Pause, Play, StopCircle, Eye, Camera, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useIvionSdk } from '@/hooks/useIvionSdk';
import { supabase } from '@/integrations/supabase/client';

interface BrowserScanRunnerProps {
  scanJobId: string;
  buildingFmGuid: string;
  ivionSiteId: string;
  ivionBaseUrl: string;
  templates: string[];
  onCompleted: (job: any) => void;
  onCancelled: () => void;
}

type ScanState = 'initializing' | 'scanning' | 'paused' | 'completing' | 'done' | 'error';

const ROTATIONS_PER_POSITION = 6;
const ROTATION_DELAY_MS = 1500;
const CAPTURE_DELAY_MS = 500;

const BrowserScanRunner: React.FC<BrowserScanRunnerProps> = ({
  scanJobId,
  buildingFmGuid,
  ivionSiteId,
  ivionBaseUrl,
  templates,
  onCompleted,
  onCancelled,
}) => {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);

  const [scanState, setScanState] = useState<ScanState>('initializing');
  const [totalImages, setTotalImages] = useState(0);
  const [processedImages, setProcessedImages] = useState(0);
  const [detectionsFound, setDetectionsFound] = useState(0);
  const [currentImageInfo, setCurrentImageInfo] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [sdkEnabled, setSdkEnabled] = useState(false);

  // Wait for container to have dimensions before enabling SDK
  useEffect(() => {
    if (sdkEnabled) return;

    const checkDimensions = () => {
      const el = containerRef.current;
      if (el && el.offsetHeight > 0 && el.offsetWidth > 0) {
        console.log('[BrowserScan] Container ready:', el.offsetWidth, 'x', el.offsetHeight);
        setSdkEnabled(true);
        return true;
      }
      return false;
    };

    if (checkDimensions()) return;

    const interval = setInterval(() => {
      if (checkDimensions()) clearInterval(interval);
    }, 200);

    return () => clearInterval(interval);
  }, [sdkEnabled]);

  const { sdkStatus, ivApiRef, retry, errorMessage: sdkErrorMessage } = useIvionSdk({
    baseUrl: ivionBaseUrl,
    siteId: ivionSiteId,
    buildingFmGuid,
    containerRef,
    enabled: sdkEnabled,
  });

  // Start scanning when SDK is ready
  useEffect(() => {
    if (sdkStatus === 'ready' && scanState === 'initializing') {
      startScan();
    }
    if (sdkStatus === 'failed' && scanState === 'initializing') {
      setErrorMessage(sdkErrorMessage || '360°-visaren kunde inte laddas. Kontrollera Ivion-anslutningen.');
      setScanState('error');
    }
  }, [sdkStatus, scanState]);

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const waitForPause = async () => {
    while (pausedRef.current && !cancelledRef.current) {
      await sleep(500);
    }
  };

  /**
   * Capture screenshot using Ivion SDK's synchronous getScreenshot().
   * Returns ScreenshotDataInterface { data: string (data-URI), width, height }.
   */
  const captureScreenshot = async (): Promise<string | null> => {
    const api = ivApiRef.current;
    if (!api) return null;

    try {
      const mainView = (api as any).mainView ?? api.getMainView?.();
      if (mainView && typeof mainView.getScreenshot === 'function') {
        // SDK returns ScreenshotDataInterface synchronously (not a Promise)
        const screenshotResult = mainView.getScreenshot('image/jpeg', 0.85);

        // Handle both object (correct) and string (unlikely) return types
        let dataUri: string | null = null;
        if (screenshotResult && typeof screenshotResult === 'object' && screenshotResult.data) {
          dataUri = screenshotResult.data;
          console.log(`[BrowserScan] Screenshot captured: ${screenshotResult.width}x${screenshotResult.height}`);
        } else if (typeof screenshotResult === 'string') {
          dataUri = screenshotResult;
          console.log('[BrowserScan] Screenshot captured (string fallback)');
        }

        if (dataUri && typeof dataUri === 'string') {
          const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
          if (base64 && base64.length > 100) {
            console.log(`[BrowserScan] Screenshot base64 length: ${base64.length}`);
            return base64;
          }
          console.warn('[BrowserScan] Screenshot data too small, likely empty');
        }
      } else {
        console.warn('[BrowserScan] mainView.getScreenshot not available');
      }

      // Fallback: try canvas element
      const ivionEl = containerRef.current?.querySelector('ivion');
      if (ivionEl) {
        const canvas = ivionEl.querySelector('canvas');
        if (canvas) {
          try {
            const dataUri = canvas.toDataURL('image/jpeg', 0.85);
            const base64 = dataUri.split(',')[1];
            if (base64 && base64.length > 100) {
              console.log(`[BrowserScan] Canvas fallback screenshot, base64 length: ${base64.length}`);
              return base64;
            }
          } catch (canvasErr) {
            console.warn('[BrowserScan] Canvas toDataURL failed (WebGL security):', canvasErr);
          }
        }
      }
    } catch (e) {
      console.warn('[BrowserScan] Screenshot capture failed:', e);
    }
    return null;
  };

  const getImagePosition = (): { x: number; y: number; z: number } => {
    const api = ivApiRef.current;
    if (!api) return { x: 0, y: 0, z: 0 };

    try {
      const mainView = (api as any).mainView ?? api.getMainView?.();
      const image = mainView?.getImage?.();
      if (image?.location) {
        return { x: image.location.x, y: image.location.y, z: image.location.z };
      }
    } catch (e) {
      console.warn('[BrowserScan] Could not get image position:', e);
    }
    return { x: 0, y: 0, z: 0 };
  };

  /**
   * Rotate camera by lonDeg degrees. SDK requires both lon and lat in ViewOrientationInterface.
   */
  const rotateView = async (lonDeg: number) => {
    const api = ivApiRef.current;
    if (!api) return;

    try {
      const mainView = (api as any).mainView ?? api.getMainView?.();
      if (mainView?.updateOrientation) {
        const currentDir = mainView.currViewingDir;
        const newLon = (currentDir?.lon || 0) + (lonDeg * Math.PI / 180);
        const currentLat = currentDir?.lat || 0;
        mainView.updateOrientation({ lon: newLon, lat: currentLat });
        console.log(`[BrowserScan] Rotated to lon=${(newLon * 180 / Math.PI).toFixed(1)}°, lat=${(currentLat * 180 / Math.PI).toFixed(1)}°`);
      }
    } catch (e) {
      console.warn('[BrowserScan] Rotation failed:', e);
    }
  };

  const analyzeScreenshot = async (
    base64: string,
    imageId: number | null,
    position: { x: number; y: number; z: number },
    datasetName?: string,
  ) => {
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: {
          action: 'analyze-screenshot',
          scanJobId,
          screenshotBase64: base64,
          imageId,
          imagePosition: position,
          datasetName,
        },
      });

      if (error) {
        console.error('[BrowserScan] Analysis error:', error);
        return 0;
      }
      console.log(`[BrowserScan] AI analysis returned ${data?.detections || 0} detections`);
      return data?.detections || 0;
    } catch (e) {
      console.error('[BrowserScan] Analysis request failed:', e);
      return 0;
    }
  };

  /**
   * Get image list using Ivion SDK's image.repository.findAll().
   * The SDK exposes api.image (ImageApiInterface) with repository.findAll() -> Promise<ImageInterface[]>.
   */
  const getImageList = async (): Promise<Array<{ id: number; datasetName?: string }>> => {
    const api = ivApiRef.current as any;
    if (!api) {
      console.error('[BrowserScan] No API reference for image list');
      return [];
    }

    try {
      // Primary method: use SDK's image repository
      const imageApi = api.image;
      if (imageApi?.repository?.findAll) {
        console.log('[BrowserScan] Fetching images via api.image.repository.findAll()...');
        const images = await imageApi.repository.findAll(true); // forceFetch=true
        if (Array.isArray(images) && images.length > 0) {
          console.log(`[BrowserScan] ✅ Got ${images.length} images from SDK repository`);
          const imageList = images.map((img: any) => ({
            id: img.id,
            datasetName: img.siteModelEntity?.name || undefined,
          }));
          return imageList;
        }
        console.warn('[BrowserScan] findAll() returned empty array');
      } else {
        console.warn('[BrowserScan] api.image.repository.findAll not available');
      }

      // Fallback: use dataset repository to get datasets, then filter images
      const datasetApi = api.dataset;
      if (datasetApi?.repository?.findAll) {
        console.log('[BrowserScan] Trying dataset-based fallback...');
        const datasets = await datasetApi.repository.findAll(true);
        if (Array.isArray(datasets) && datasets.length > 0) {
          console.log(`[BrowserScan] Found ${datasets.length} datasets, re-trying image findAll...`);
          // After datasets are loaded, images might be available
          if (imageApi?.repository?.findAll) {
            const images = await imageApi.repository.findAll(true);
            if (Array.isArray(images) && images.length > 0) {
              console.log(`[BrowserScan] ✅ Got ${images.length} images after dataset load`);
              return images.map((img: any) => ({
                id: img.id,
                datasetName: img.siteModelEntity?.name || undefined,
              }));
            }
          }
        }
      }

      // Last resort: scan from current position using getClosestImageInDir
      console.log('[BrowserScan] Fallback: exploring from current position...');
      const mainView = api.mainView ?? api.getMainView?.();
      const currentImage = mainView?.getImage?.();
      if (currentImage && imageApi?.service?.getClosestImageInDir) {
        const explored = new Set<number>();
        const imageList: Array<{ id: number; datasetName?: string }> = [];
        let nextImage = currentImage;
        const viewDir = mainView.currViewingDir || { lon: 0, lat: 0 };

        for (let step = 0; step < 200 && nextImage; step++) {
          if (explored.has(nextImage.id)) break;
          explored.add(nextImage.id);
          imageList.push({ id: nextImage.id });

          try {
            nextImage = await imageApi.service.getClosestImageInDir(nextImage, viewDir, 1, 3);
          } catch {
            break;
          }
        }
        console.log(`[BrowserScan] Explored ${imageList.length} images via getClosestImageInDir`);
        if (imageList.length > 0) return imageList;
      }

      console.warn('[BrowserScan] Could not get any images');
      return [];
    } catch (e) {
      console.error('[BrowserScan] Image list error:', e);
      return [];
    }
  };

  const startScan = async () => {
    const api = ivApiRef.current;
    if (!api) {
      setErrorMessage('SDK ej redo');
      setScanState('error');
      return;
    }

    setScanState('scanning');
    console.log('[BrowserScan] === Starting scan ===');
    console.log(`[BrowserScan] Job: ${scanJobId}, Site: ${ivionSiteId}, Templates: ${templates.length}`);

    try {
      const images = await getImageList();
      
      if (images.length === 0) {
        toast({
          title: 'Kunde inte lista bilder',
          description: 'Skannar den aktuella positionen istället.',
        });
        setTotalImages(1);
      } else {
        setTotalImages(images.length);
        console.log(`[BrowserScan] Will scan ${images.length} images with ${ROTATIONS_PER_POSITION} rotations each`);
      }

      await supabase.from('scan_jobs').update({
        total_images: images.length || 1,
        status: 'running',
        started_at: new Date().toISOString(),
      }).eq('id', scanJobId);

      let totalDetections = 0;
      let screenshotFailures = 0;

      for (let i = 0; i < Math.max(images.length, 1); i++) {
        if (cancelledRef.current) break;
        await waitForPause();
        if (cancelledRef.current) break;

        const img = images[i];
        setCurrentImageInfo(`Bild ${i + 1} / ${images.length || 1}${img?.datasetName ? ` (${img.datasetName})` : ''}`);
        console.log(`[BrowserScan] --- Image ${i + 1}/${images.length || 1}, id=${img?.id ?? 'current'} ---`);

        // Navigate to image using SDK
        if (img) {
          try {
            // moveToImageId requires (imageId, viewDir, fov) - pass undefined to keep current
            await (api as any).moveToImageId(img.id, undefined, undefined);
            console.log(`[BrowserScan] Navigated to image ${img.id}`);
            await sleep(2000); // Wait for panorama to render
          } catch (e) {
            console.warn(`[BrowserScan] Could not navigate to image ${img.id}, skipping:`, e);
            setProcessedImages(i + 1);
            continue;
          }
        }

        for (let rot = 0; rot < ROTATIONS_PER_POSITION; rot++) {
          if (cancelledRef.current) break;

          await sleep(CAPTURE_DELAY_MS);

          const screenshot = await captureScreenshot();
          if (screenshot) {
            const position = getImagePosition();
            console.log(`[BrowserScan] Analyzing rotation ${rot + 1}/${ROTATIONS_PER_POSITION}, pos=(${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
            const detCount = await analyzeScreenshot(
              screenshot,
              img?.id ?? null,
              position,
              img?.datasetName,
            );
            totalDetections += detCount;
            setDetectionsFound(totalDetections);
          } else {
            screenshotFailures++;
            console.warn(`[BrowserScan] Screenshot failed (rotation ${rot + 1}, total failures: ${screenshotFailures})`);
          }

          if (rot < ROTATIONS_PER_POSITION - 1) {
            await rotateView(360 / ROTATIONS_PER_POSITION);
            await sleep(ROTATION_DELAY_MS);
          }
        }

        setProcessedImages(i + 1);

        // Update scan job progress in DB
        await supabase.from('scan_jobs').update({
          processed_images: i + 1,
          current_image_index: i,
          detections_found: totalDetections,
        }).eq('id', scanJobId);
      }

      if (screenshotFailures > 0) {
        console.warn(`[BrowserScan] Total screenshot failures: ${screenshotFailures}`);
      }

      if (!cancelledRef.current) {
        setScanState('completing');
        console.log(`[BrowserScan] === Scan complete: ${totalDetections} detections in ${processedImages} images ===`);

        await supabase.functions.invoke('ai-asset-detection', {
          body: { action: 'complete-browser-scan', scanJobId },
        });

        setScanState('done');
        toast({
          title: 'Skanning klar!',
          description: `Hittade ${totalDetections} potentiella objekt i ${processedImages} bilder.`,
        });

        const { data: finalJob } = await supabase.functions.invoke('ai-asset-detection', {
          body: { action: 'get-scan-status', scanJobId },
        });
        onCompleted(finalJob || { id: scanJobId, status: 'completed', detections_found: totalDetections });
      }
    } catch (e: any) {
      console.error('[BrowserScan] Scan error:', e);
      setErrorMessage(e.message || 'Okänt fel');
      setScanState('error');
    }
  };

  const handlePause = () => {
    pausedRef.current = !pausedRef.current;
    setScanState(pausedRef.current ? 'paused' : 'scanning');
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    pausedRef.current = false;

    try {
      await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'cancel-scan', scanJobId },
      });
    } catch (e) {
      console.error('[BrowserScan] Cancel error:', e);
    }

    onCancelled();
  };

  const progressPercent = totalImages > 0 ? (processedImages / totalImages) * 100 : 0;

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Progress overlay */}
      <div className="bg-card border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {scanState === 'scanning' && <Camera className="h-4 w-4 text-primary animate-pulse" />}
            {scanState === 'paused' && <Pause className="h-4 w-4 text-amber-500" />}
            {scanState === 'initializing' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {scanState === 'error' && <AlertCircle className="h-4 w-4 text-destructive" />}
            <span className="text-sm font-medium">
              {scanState === 'initializing' && !sdkEnabled && 'Förbereder visare...'}
              {scanState === 'initializing' && sdkEnabled && sdkStatus === 'loading' && 'Laddar SDK och autentiserar...'}
              {scanState === 'initializing' && sdkEnabled && sdkStatus === 'idle' && 'Ansluter till site...'}
              {scanState === 'scanning' && 'Skannar...'}
              {scanState === 'paused' && 'Pausad'}
              {scanState === 'completing' && 'Sparar resultat...'}
              {scanState === 'done' && 'Klar!'}
              {scanState === 'error' && 'Fel'}
            </span>
          </div>
          <Badge variant="secondary">{detectionsFound} hittade</Badge>
        </div>

        <Progress value={progressPercent} />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{currentImageInfo}</span>
          <span>{processedImages} / {totalImages} bilder</span>
        </div>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <Alert>
          <Eye className="h-4 w-4" />
          <AlertDescription>
            Skanningen körs i webbläsaren — håll fliken öppen. 360°-visaren navigerar automatiskt genom panoramabilderna.
          </AlertDescription>
        </Alert>

        {/* Controls */}
        <div className="flex gap-2">
          {(scanState === 'scanning' || scanState === 'paused') && (
            <>
              <Button
                variant={scanState === 'paused' ? 'default' : 'secondary'}
                size="sm"
                onClick={handlePause}
              >
                {scanState === 'paused' ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
                {scanState === 'paused' ? 'Fortsätt' : 'Pausa'}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleCancel}>
                <StopCircle className="h-4 w-4 mr-1" />
                Avbryt
              </Button>
            </>
          )}
          {scanState === 'error' && (
            <Button variant="outline" size="sm" onClick={() => { setSdkEnabled(false); retry(); setScanState('initializing'); setErrorMessage(''); }}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Försök igen
            </Button>
          )}
        </div>
      </div>

      {/* Ivion SDK viewer container */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden border bg-muted"
        style={{ display: 'block', width: '100%', minHeight: '400px', height: '50vh' }}
      />
    </div>
  );
};

export default BrowserScanRunner;
