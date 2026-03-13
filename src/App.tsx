import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { AppProvider } from "@/context/AppContext";
import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import Login from "@/pages/Login";
import NotFound from "./pages/NotFound";

// Standalone page for Ivion integration (can be embedded in iframe)
const IvionCreate = lazy(() => import("@/pages/IvionCreate"));
// Ivion 360° Inventory page
const IvionInventory = lazy(() => import("@/pages/IvionInventory"));
// AI Asset Scan page
const AiAssetScan = lazy(() => import("@/pages/AiAssetScan"));
// Unified Viewer page (fullscreen, all modes)
const UnifiedViewerPage = lazy(() => import("@/pages/UnifiedViewer"));
// Onboarding wizard
const Onboarding = lazy(() => import("@/pages/Onboarding"));
// Split Viewer - 3D + 360° side-by-side
const SplitViewer = lazy(() => import("@/pages/SplitViewer"));
// Virtual Twin - 3D overlay on 360° panorama
const VirtualTwin = lazy(() => import("@/pages/VirtualTwin"));
// Mobile 360° Viewer page (fullscreen)
const Mobile360Viewer = lazy(() => import("@/pages/Mobile360Viewer"));
// Fault Report page (public, no auth required)
const FaultReport = lazy(() => import("@/pages/FaultReport"));
// Autodesk OAuth callback page (public, no auth required)
const AutodeskCallback = lazy(() => import("@/pages/AutodeskCallback"));
// Jury presentation slide deck
const Presentation = lazy(() => import("@/pages/Presentation"));
// FM Access dashboard
const FmAccessDashboard = lazy(() => import("@/pages/FmAccessDashboard"));
// Issue resolution page (public, accessed via token link)
const IssueResolution = lazy(() => import("@/pages/IssueResolution"));
// Standalone plugin page for external system integration
const PluginPage = lazy(() => import("@/pages/PluginPage"));
// Homepage V2 test page
const HomeLandingV2 = lazy(() => import("@/pages/HomeLandingV2"));
// API Documentation page
const ApiDocs = lazy(() => import("@/pages/ApiDocs"));
// Standalone AI Chat page
const AiChat = lazy(() => import("@/pages/AiChat"));

const queryClient = new QueryClient();

const App = () => {
  // Global handler for unhandled promise rejections from external libraries (e.g. Asset+ 3D viewer).
  // Prevents the entire app from crashing on async errors we can't catch locally.
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error('[Global] Unhandled promise rejection:', event.reason);
      event.preventDefault(); // Prevent crash / console uncaught error
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  // Global handler for uncaught synchronous errors from external libraries (e.g. Asset+ UMD bundle).
  // Complements the unhandledrejection handler above – catches errors thrown outside React's
  // render cycle that neither Error Boundaries nor the rejection handler can intercept.
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('[Global] Uncaught error:', event.error);
      event.preventDefault(); // Prevent default browser error reporting / crash
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AppProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
          {/* Public login page */}
          <Route path="/login" element={<Login />} />
          
          {/* Standalone Ivion create page - accessible without app layout */}
          <Route 
            path="/ivion-create" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <IvionCreate />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Ivion 360° Inventory page - fullscreen mode */}
          <Route 
            path="/ivion-inventory" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <IvionInventory />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* AI Asset Scan page - fullscreen mode */}
          <Route 
            path="/inventory/ai-scan" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <AiAssetScan />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Unified Viewer - fullscreen mode for all view modes */}
          <Route 
            path="/viewer" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <UnifiedViewerPage />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* AI Onboarding wizard */}
          <Route 
            path="/onboarding" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <Onboarding />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Split Viewer - 3D + 360° side-by-side */}
          <Route 
            path="/split-viewer" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <SplitViewer />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Virtual Twin - 3D overlay on 360° */}
          <Route 
            path="/virtual-twin" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <VirtualTwin />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Mobile 360° Viewer - fullscreen mode */}
          <Route 
            path="/360-viewer" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <Mobile360Viewer />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Public Fault Report page - accessible via QR code without auth */}
          <Route 
            path="/fault-report" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <FaultReport />
              </Suspense>
            } 
          />
          
          {/* Autodesk OAuth callback - public, captures auth code */}
          <Route 
            path="/auth/autodesk/callback" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <AutodeskCallback />
              </Suspense>
            } 
          />
          
          {/* Jury presentation - public, no auth */}
          <Route 
            path="/presentation" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen bg-black">Loading...</div>}>
                <Presentation />
              </Suspense>
            } 
          />
          
          {/* Public Issue Resolution page - accessed via email token */}
          <Route 
            path="/issue/:token" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <IssueResolution />
              </Suspense>
            } 
          />
          
          {/* FM Access Dashboard */}
          <Route 
            path="/fm-access" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <FmAccessDashboard />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Standalone Plugin page — minimal chrome, for companion windows */}
          <Route 
            path="/plugin" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <PluginPage />
              </Suspense>
            } 
          />
          
          {/* Homepage V2 test page — two-column desktop layout */}
          <Route 
            path="/home-v2" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <HomeLandingV2 />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* API Documentation page */}
          <Route 
            path="/api-docs" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <ApiDocs />
                </ProtectedRoute>
              </Suspense>
            } 
          />
          
          {/* Protected app routes */}
          <Route 
            path="/*" 
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            } 
          />
          
          <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
