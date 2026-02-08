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
// Mobile 3D Viewer page (fullscreen)
const Mobile3DViewer = lazy(() => import("@/pages/Mobile3DViewer"));
// Onboarding wizard
const Onboarding = lazy(() => import("@/pages/Onboarding"));
// Split Viewer - 3D + 360° side-by-side
const SplitViewer = lazy(() => import("@/pages/SplitViewer"));
// Mobile 360° Viewer page (fullscreen)
const Mobile360Viewer = lazy(() => import("@/pages/Mobile360Viewer"));
// Fault Report page (public, no auth required)
const FaultReport = lazy(() => import("@/pages/FaultReport"));
// Autodesk OAuth callback page (public, no auth required)
const AutodeskCallback = lazy(() => import("@/pages/AutodeskCallback"));

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
          
          {/* Mobile 3D Viewer - fullscreen mode */}
          <Route 
            path="/viewer" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <ProtectedRoute>
                  <Mobile3DViewer />
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
