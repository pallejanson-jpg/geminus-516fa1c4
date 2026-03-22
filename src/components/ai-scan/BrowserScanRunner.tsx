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

const ROTATIONS_PER_POSITION = 3;
const ROTATION_DELAY_MS = 600;
const CAPTURE_DELAY_MS = 300;
const MAX_IMAGES_PER_SCAN = 200;
const MAX_CONSECUTIVE_NAV_FAILURES = 10;

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
  const isScanningRef = useRef(false);

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

  // Minimize Ivion UI when SDK is ready to maximize screenshot coverage
  // Inject CSS into shadow root(s) and via direct DOM manipulation
  const injectMinimalUiCss = useCallback(() => {
    const SCAN_UI_CSS = `
      mat-sidenav, mat-toolbar, mat-sidenav-container,
      [class*="sidebar"], [class*="menu-panel"], [class*="toolbar"],
      [class*="floor-switcher"], [class*="floor-changer"],
      [class*="navigation-panel"], [class*="info-panel"],
      [class*="minimap"], [class*="controls-panel"],
      .mat-icon-button, .sidenav, .toolbar,
      nv-floor-changer, nv-minimap, nv-controls,
      nv-sidebar, nv-toolbar, nv-navigation,
      [_nghost*="nv-"], [class*="nv-sidebar"],
      [class*="nv-floor"], [class*="nv-toolbar"],
      [class*="nv-menu"], [class*="nv-controls"],
      button:not([aria-label="close"]) {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
      canvas {
        width: 100% !important;
        height: 100% !important;
      }
    `;

    const ivionEls = document.querySelectorAll('ivion');
    ivionEls.forEach((ivionEl) => {
      const roots: ShadowRoot[] = [];
      if (ivionEl.shadowRoot) roots.push(ivionEl.shadowRoot);

      const walker = document.createTreeWalker(ivionEl, NodeFilter.SHOW_ELEMENT);
      let node: Node | null = walker.nextNode();
      while (node) {
        const el = node as Element;
        if (el.shadowRoot) roots.push(el.shadowRoot);
        node = walker.nextNode();
      }

      roots.forEach((root) => {
        if (!root.getElementById('ivion-scan-css')) {
          const s = document.createElement('style');
          s.id = 'ivion-scan-css';
          s.textContent = SCAN_UI_CSS;
          root.appendChild(s);
        }
      });

      const hideSelectors = [
        'mat-sidenav', 'mat-toolbar', 'mat-sidenav-container',
        'nv-floor-changer', 'nv-minimap', 'nv-sidebar', 'nv-controls',
        '[class*="floor"]', '[class*="Floor"]',
        '[class*="sidebar"]', '[class*="Sidebar"]',
        '[class*="toolbar"]', '[class*="Toolbar"]',
        '[class*="minimap"]', '[class*="menu-panel"]',
        '[class*="navigation-panel"]', '[class*="controls-panel"]',
      ];
      hideSelectors.forEach((sel) => {
        try {
          ivionEl.querySelectorAll(sel).forEach((el) => {
            (el as HTMLElement).style.setProperty('display', 'none', 'important');
            (el as HTMLElement).style.setProperty('visibility', 'hidden', 'important');
          });
        } catch { /* ignore */ }
      });
    });

    if (!document.getElementById('ivion-scan-minimal-ui')) {
      const globalStyle = document.createElement('style');
      globalStyle.id = 'ivion-scan-minimal-ui';
      globalStyle.textContent = `
        ivion mat-sidenav, ivion mat-toolbar, ivion mat-sidenav-container,
        ivion nv-floor-changer, ivion nv-minimap, ivion nv-sidebar,
        ivion nv-controls, ivion nv-toolbar, ivion nv-navigation,
        ivion [class*="floor-changer"], ivion [class*="floor-switcher"],
        ivion [class*="sidebar"], ivion [class*="toolbar"],
        ivion [class*="minimap"], ivion [class*="controls"],
        ivion [class*="navigation-panel"], ivion [class*="info-panel"],
        ivion .mat-sidenav, ivion .mat-toolbar {
          display: none !important;
          visibility: hidden !important;
        }
        ivion canvas { width: 100% !important; height: 100% !important; }
      `;
      document.head.appendChild(globalStyle);
    }

    console.log('[BrowserScan] Ivion minimal UI CSS injected into', ivionEls.length, 'element(s)');
  }, []);

  useEffect(() => {
    if (sdkStatus !== 'ready') return;

    injectMinimalUiCss();

    const retryTimer = setTimeout(injectMinimalUiCss, 1500);
    const retryTimer2 = setTimeout(injectMinimalUiCss, 4000);

    try {
      const api = ivApiRef.current as any;
      api?.ui?.sidebarMenu?.hide?.();
      api?.getMenuItems?.()?.forEach((item: any) => item.setVisible?.(false));
      api?.closeMenu?.();
      const mainView = api?.view?.mainView ?? (typeof api?.getMainView === 'function' ? api.getMainView() : null);
      mainView?.setFullscreen?.(true);
      console.log('[BrowserScan] Ivion UI minimized via SDK');
    } catch (e) {
      console.warn('[BrowserScan] Could not minimize Ivion UI via SDK:', e);
    }

    return () => {
      clearTimeout(retryTimer);
      clearTimeout(retryTimer2);
      document.getElementById('ivion-scan-minimal-ui')?.remove();
    };
  }, [sdkStatus, injectMinimalUiCss]);

  useEffect(() => {
    if (sdkStatus === 'ready' && !isScanningRef.current) {
      startScan();
    }
    if (sdkStatus === 'failed' && !isScanningRef.current) {
      setErrorMessage(sdkErrorMessage || 'The 360° viewer could not load. Check the Ivion connection.');
      setScanState('error');
    }
  }, [sdkStatus]);

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const waitForPause = async () => {
    while (pausedRef.current && !cancelledRef.current) {
      await sleep(500);
    }
  };

  const captureScreenshot = async (): Promise<string | null> => {
    const api = ivApiRef.current;
    if (!api) return null;

    try {
      const candidates = [
        (api as any).view?.mainView,
        typeof api.getMainView === 'function' ? api.getMainView() : null,
        (api as any).mainView,
      ];

      for (const mainView of candidates) {
        if (mainView && typeof mainView.getScreenshot === 'function') {
          const screenshotResult = mainView.getScreenshot('image/jpeg', 0.85);

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
              return base64;
            }
            console.warn('[BrowserScan] Screenshot data too small, likely empty');
          }
        }
      }

      console.warn('[BrowserScan] getScreenshot not found on any view path');

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

  const getMainView = () => {
    const api = ivApiRef.current as any;
    if (!api) return null;
    return api.view?.mainView ?? (typeof api.getMainView === 'function' ? api.getMainView() : null) ?? api.mainView ?? null;
  };

  const getImagePosition = (): { x: number; y: number; z: number } => {
    try {
      const mainView = getMainView();
      const image = mainView?.getImage?.();
      if (image?.location) {
        return { x: image.location.x, y: image.location.y, z: image.location.z };
      }
    } catch (e) {
      console.warn('[BrowserScan] Could not get image position:', e);
    }
    return { x: 0, y: 0, z: 0 };
  };

  const rotateView = async (lonDeg: number) => {
    try {
      const mainView = getMainView();
      if (mainView?.updateOrientation) {
        const currentDir = mainView.currViewingDir;
        const newLon = (currentDir?.lon || 0) + (lonDeg * Math.PI / 180);
        const currentLat = currentDir?.lat || 0;
        mainView.updateOrientation({ lon: newLon, lat: currentLat });
        console.log(`[BrowserScan] Rotated to lon=${(newLon * 180 / Math.PI).toFixed(1)}°`);
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

  const analyzeScreenshotBatch = async (
    screenshots: string[],
    imageId: number | null,
    position: { x: number; y: number; z: number },
    datasetName?: string,
  ): Promise<number> => {
    if (screenshots.length === 0) return 0;
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: {
          action: 'analyze-screenshot-batch',
          scanJobId,
          screenshots,
          imageId,
          imagePosition: position,
          datasetName,
        },
      });

      if (error) {
        console.error('[BrowserScan] Batch analysis error:', error);
        return 0;
      }
      console.log(`[BrowserScan] Batch AI analysis returned ${data?.detections || 0} detections from ${screenshots.length} images`);
      return data?.detections || 0;
    } catch (e) {
      console.error('[BrowserScan] Batch analysis request failed:', e);
      return 0;
    }
  };

  const getImageList = async (): Promise<Array<{ id: number; datasetName?: string }>> => {
    const api = ivApiRef.current as any;
    if (!api) {
      console.error('[BrowserScan] No API reference for image list');
      return [];
    }

    try {
      const imageApi = api.image;
      if (imageApi?.repository?.findAll) {
        console.log('[BrowserScan] Fetching images via api.image.repository.findAll()...');
        const images = await imageApi.repository.findAll(true);
        if (Array.isArray(images) && images.length > 0) {
          console.log(`[BrowserScan] ✅ Got ${images.length} images from SDK repository`);
          return images.map((img: any) => ({
            id: img.id,
            datasetName: img.siteModelEntity?.name || undefined,
          }));
        }
        console.warn('[BrowserScan] findAll() returned empty array');
      } else {
        console.warn('[BrowserScan] api.image.repository.findAll not available');
      }

      const datasetApi = api.dataset;
      if (datasetApi?.repository?.findAll) {
        console.log('[BrowserScan] Trying dataset-based fallback...');
        const datasets = await datasetApi.repository.findAll(true);
        if (Array.isArray(datasets) && datasets.length > 0) {
          console.log(`[BrowserScan] Found ${datasets.length} datasets, re-trying image findAll...`);
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
    if (isScanningRef.current) {
      console.warn('[BrowserScan] startScan() called but already scanning, ignoring');
      return;
    }
    isScanningRef.current = true;
    cancelledRef.current = false;

    const api = ivApiRef.current;
    if (!api) {
      setErrorMessage('SDK not ready');
      setScanState('error');
      isScanningRef.current = false;
      return;
    }

    setScanState('scanning');
    const t0 = Date.now();
    console.log(`[BrowserScan] === Starting scan at ${new Date().toISOString()} ===`);
    console.log(`[BrowserScan] Job: ${scanJobId}, Site: ${ivionSiteId}, Templates: ${templates.length}`);
    console.log(`[BrowserScan] cancelledRef.current = ${cancelledRef.current}`);

    try {
      const allImages = await getImageList();
      console.log(`[BrowserScan] Image list fetched: ${allImages.length} images (took ${Date.now() - t0}ms)`);
      console.log(`[BrowserScan] cancelledRef.current after getImageList = ${cancelledRef.current}`);

      if (allImages.length === 0) {
        toast({
          title: 'Could not list images',
          description: 'Scanning the current position instead.',
        });
      }

      let images = allImages;
      if (allImages.length > MAX_IMAGES_PER_SCAN) {
        const step = Math.max(1, Math.floor(allImages.length / MAX_IMAGES_PER_SCAN));
        images = allImages.filter((_, i) => i % step === 0).slice(0, MAX_IMAGES_PER_SCAN);
        console.log(`[BrowserScan] Sampled ${images.length} images from ${allImages.length} (every ${step}th image)`);
      }

      const scanCount = Math.max(images.length, 1);
      setTotalImages(scanCount);
      console.log(`[BrowserScan] Will scan ${scanCount} images with ${ROTATIONS_PER_POSITION} rotations each`);

      await supabase.from('scan_jobs').update({
        total_images: scanCount,
        status: 'running',
        started_at: new Date().toISOString(),
      }).eq('id', scanJobId);

      let totalDetections = 0;
      let screenshotFailures = 0;
      let consecutiveNavFailures = 0;
      let processed = 0;

      console.log(`[BrowserScan] === Entering scan loop, cancelledRef=${cancelledRef.current} ===`);

      for (let i = 0; i < scanCount; i++) {
        if (cancelledRef.current) {
          console.log(`[BrowserScan] Cancelled at image ${i}`);
          break;
        }
        await waitForPause();
        if (cancelledRef.current) {
          console.log(`[BrowserScan] Cancelled after pause at image ${i}`);
          break;
        }

        const img = images[i];
        setCurrentImageInfo(`Image ${i + 1} / ${scanCount}${img?.datasetName ? ` (${img.datasetName})` : ''}`);
        console.log(`[BrowserScan] --- Image ${i + 1}/${scanCount}, id=${img?.id ?? 'current'} (${new Date().toISOString()}) ---`);

        if (img) {
          try {
            await (api as any).legacyApi.moveToImageId(img.id, undefined, undefined);
            console.log(`[BrowserScan] ✅ Navigated to image ${img.id}`);
            consecutiveNavFailures = 0;
            await sleep(800);
          } catch (e) {
            consecutiveNavFailures++;
            console.warn(`[BrowserScan] ❌ Navigation failed for image ${img.id} (consecutive failures: ${consecutiveNavFailures}):`, e);
            
            if (consecutiveNavFailures > MAX_CONSECUTIVE_NAV_FAILURES) {
              console.error(`[BrowserScan] Too many consecutive navigation failures (${consecutiveNavFailures}), aborting scan`);
              setErrorMessage(`Navigation failed ${consecutiveNavFailures} times in a row. Check that the site ID is correct.`);
              setScanState('error');
              await supabase.from('scan_jobs').update({
                status: 'error',
                error_message: `${consecutiveNavFailures} consecutive navigation failures`,
                processed_images: processed,
                detections_found: totalDetections,
              }).eq('id', scanJobId);
              isScanningRef.current = false;
              return;
            }

            processed++;
            setProcessedImages(processed);
            continue;
          }
        }

        const screenshots: string[] = [];
        for (let rot = 0; rot < ROTATIONS_PER_POSITION; rot++) {
          if (cancelledRef.current) break;

          await sleep(CAPTURE_DELAY_MS);

          const screenshot = await captureScreenshot();
          if (screenshot) {
            screenshots.push(screenshot);
          } else {
            screenshotFailures++;
            console.warn(`[BrowserScan] Screenshot failed (rotation ${rot + 1}, total failures: ${screenshotFailures})`);
          }

          if (rot < ROTATIONS_PER_POSITION - 1) {
            await rotateView(360 / ROTATIONS_PER_POSITION);
            await sleep(ROTATION_DELAY_MS);
          }
        }

        if (screenshots.length > 0 && !cancelledRef.current) {
          const position = getImagePosition();
          console.log(`[BrowserScan] Batch analyzing ${screenshots.length} screenshots, pos=(${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)})`);
          const detCount = await analyzeScreenshotBatch(screenshots, img?.id ?? null, position, img?.datasetName);
          totalDetections += detCount;
          setDetectionsFound(totalDetections);
        }

        processed++;
        setProcessedImages(processed);

        await supabase.from('scan_jobs').update({
          processed_images: processed,
          current_image_index: i,
          detections_found: totalDetections,
        }).eq('id', scanJobId);
      }

      if (screenshotFailures > 0) {
        console.warn(`[BrowserScan] Total screenshot failures: ${screenshotFailures}`);
      }

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[BrowserScan] === Loop finished: processed=${processed}, detections=${totalDetections}, elapsed=${elapsed}s, cancelled=${cancelledRef.current} ===`);

      if (!cancelledRef.current) {
        if (processed === 0) {
          console.error('[BrowserScan] No images were processed — marking as error');
          setErrorMessage('No images could be processed. Check the Ivion connection.');
          setScanState('error');
          await supabase.from('scan_jobs').update({
            status: 'error',
            error_message: 'No images processed',
            processed_images: 0,
          }).eq('id', scanJobId);
        } else {
          setScanState('completing');
          console.log(`[BrowserScan] === Scan complete: ${totalDetections} detections in ${processed} images ===`);

          await supabase.functions.invoke('ai-asset-detection', {
            body: { action: 'complete-browser-scan', scanJobId },
          });

          setScanState('done');
          toast({
            title: 'Scan complete!',
            description: `Found ${totalDetections} potential objects in ${processed} images.`,
          });

          const { data: finalJob } = await supabase.functions.invoke('ai-asset-detection', {
            body: { action: 'get-scan-status', scanJobId },
          });
          onCompleted(finalJob || { id: scanJobId, status: 'completed', detections_found: totalDetections });
        }
      }
    } catch (e: any) {
      console.error('[BrowserScan] Scan error:', e);
      setErrorMessage(e.message || 'Unknown error');
      setScanState('error');
    } finally {
      isScanningRef.current = false;
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
            {scanState === 'paused' && <Pause className="h-4 w-4 text-warning" />}
            {scanState === 'initializing' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {scanState === 'error' && <AlertCircle className="h-4 w-4 text-destructive" />}
            <span className="text-sm font-medium">
              {scanState === 'initializing' && !sdkEnabled && 'Preparing viewer...'}
              {scanState === 'initializing' && sdkEnabled && sdkStatus === 'loading' && 'Loading SDK and authenticating...'}
              {scanState === 'initializing' && sdkEnabled && sdkStatus === 'idle' && 'Connecting to site...'}
              {scanState === 'scanning' && 'Scanning...'}
              {scanState === 'paused' && 'Paused'}
              {scanState === 'completing' && 'Saving results...'}
              {scanState === 'done' && 'Done!'}
              {scanState === 'error' && 'Error'}
            </span>
          </div>
          <Badge variant="secondary">{detectionsFound} found</Badge>
        </div>

        <Progress value={progressPercent} />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{currentImageInfo}</span>
          <span>{processedImages} / {totalImages} images</span>
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
            The scan runs in the browser — keep this tab open. The 360° viewer navigates automatically through the panorama images.
            {totalImages > 0 && totalImages < (processedImages || Infinity) && ` (sampled ${totalImages} of total images)`}
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
                {scanState === 'paused' ? 'Resume' : 'Pause'}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleCancel}>
                <StopCircle className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </>
          )}
          {scanState === 'error' && (
            <Button variant="outline" size="sm" onClick={() => { 
              isScanningRef.current = false;
              setSdkEnabled(false); 
              retry(); 
              setScanState('initializing'); 
              setErrorMessage(''); 
            }}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Retry
            </Button>
          )}
        </div>
      </div>

      {/* Ivion SDK viewer container */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden border bg-muted"
        style={{ display: 'block', width: '100%', minHeight: '500px', height: '70vh' }}
      />
    </div>
  );
};

export default BrowserScanRunner;
