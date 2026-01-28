import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import AppLayout from "@/components/layout/AppLayout";
import NotFound from "./pages/NotFound";

// Standalone page for Ivion integration (can be embedded in iframe)
const IvionCreate = lazy(() => import("@/pages/IvionCreate"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Standalone Ivion create page - accessible without app layout */}
          <Route 
            path="/ivion-create" 
            element={
              <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
                <IvionCreate />
              </Suspense>
            } 
          />
          <Route path="/*" element={<AppLayout />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
