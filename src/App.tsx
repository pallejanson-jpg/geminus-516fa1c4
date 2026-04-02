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
import { FullPageSpinner } from "@/components/ui/FullPageSpinner";

// Standalone page for Ivion integration (can be embedded in iframe)
const IvionCreate = lazy(() => import("@/pages/IvionCreate"));
// Ivion 360° Inventory page
const IvionInventory = lazy(() => import("@/pages/IvionInventory"));
// AI Asset Scan page
const AiAssetScan = lazy(() => import("@/pages/AiAssetScan"));
// Unified Viewer page (legacy, kept as fallback)
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
// Internal showcase presentation
const Presentation2 = lazy(() => import("@/pages/Presentation2"));
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
// Geminus View — standalone IFC viewer + building selector
const GeminusView = lazy(() => import("@/pages/GeminusView"));
// New viewer (promoted from mockup)
const ViewerMockup = lazy(() => import("@/pages/ViewerMockup"));
// FM Access 2D Standalone test page
const FmAccess2DStandalone = lazy(() => import("@/pages/FmAccess2DStandalone"));

const queryClient = new QueryClient();

const PresentationSpinner = () => (
  <div className="flex items-center justify-center h-screen bg-black">
    <FullPageSpinner />
  </div>
);

const App = () => {
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      console.error('[Global] Unhandled promise rejection:', event.reason);
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('[Global] Uncaught error:', event.error);
      event.preventDefault();
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
          <Route path="/login" element={<Login />} />
          
          <Route path="/ivion-create" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><IvionCreate /></ProtectedRoute></Suspense>} />
          <Route path="/ivion-inventory" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><IvionInventory /></ProtectedRoute></Suspense>} />
          <Route path="/inventory/ai-scan" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><AiAssetScan /></ProtectedRoute></Suspense>} />
          <Route path="/viewer" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><UnifiedViewerPage /></ProtectedRoute></Suspense>} />
          <Route path="/viewer-mockup" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><ViewerMockup /></ProtectedRoute></Suspense>} />
          <Route path="/onboarding" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><Onboarding /></ProtectedRoute></Suspense>} />
          <Route path="/split-viewer" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><SplitViewer /></ProtectedRoute></Suspense>} />
          <Route path="/virtual-twin" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><VirtualTwin /></ProtectedRoute></Suspense>} />
          <Route path="/360-viewer" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><Mobile360Viewer /></ProtectedRoute></Suspense>} />
          <Route path="/fault-report" element={<Suspense fallback={<FullPageSpinner />}><FaultReport /></Suspense>} />
          <Route path="/auth/autodesk/callback" element={<Suspense fallback={<FullPageSpinner />}><AutodeskCallback /></Suspense>} />
          <Route path="/presentation" element={<Suspense fallback={<PresentationSpinner />}><Presentation /></Suspense>} />
          <Route path="/presentation2" element={<Suspense fallback={<PresentationSpinner />}><Presentation2 /></Suspense>} />
          <Route path="/issue/:token" element={<Suspense fallback={<FullPageSpinner />}><IssueResolution /></Suspense>} />
          <Route path="/fm-access" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><FmAccessDashboard /></ProtectedRoute></Suspense>} />
          <Route path="/plugin" element={<Suspense fallback={<FullPageSpinner />}><PluginPage /></Suspense>} />
          <Route path="/home-v2" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><HomeLandingV2 /></ProtectedRoute></Suspense>} />
          <Route path="/api-docs" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><ApiDocs /></ProtectedRoute></Suspense>} />
          <Route path="/ai" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><AiChat /></ProtectedRoute></Suspense>} />
          <Route path="/view" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><GeminusView /></ProtectedRoute></Suspense>} />
          <Route path="/fma-2d" element={<Suspense fallback={<FullPageSpinner />}><ProtectedRoute><FmAccess2DStandalone /></ProtectedRoute></Suspense>} />
          
          <Route path="/*" element={<ProtectedRoute><AppLayout /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
