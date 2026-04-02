

# Generate Geminus 3D Viewer Technical Report (Word Document)

## What
Create a professional Word document explaining the migration from the Asset+ embedded viewer to the native xeokit viewer implementation, suitable for presenting to product and development managers.

## Document Structure

### Title Page
- "Geminus 3D Viewer — Technical Architecture Report"
- Subtitle: "From Asset+ Embedded Viewer to Native xeokit Implementation"

### 1. Executive Summary
- One-paragraph overview: we replaced the Asset+ Vue component with a direct xeokit integration, achieving 3–5× faster load times with full control over the rendering pipeline.

### 2. The Starting Point: Asset+ Viewer
- How it worked (Vue-in-React bridge, fetch interceptor hack, Asset+ CDN dependency)
- Problems found:
  - **Performance**: 2–5s latency per model, no caching, no progressive loading, random model order
  - **Architecture**: Vue-in-React lifecycle conflicts, opaque pipeline, 5,160-line monolith, fetch monkey-patching
  - **Features**: No floor-priority loading, no data visualization, no color themes, no IFC conversion

### 3. What We Built
- **Modular architecture**: 8 composable hooks (useXeokitInstance, useModelLoader, useViewerEventListeners, useFloorPriorityLoading, usePerformancePlugins, useXktPreload, XktCacheService, AccXktConverter)
- **Loading pipeline**: Memory cache → Cloud cache → Asset+ source, with progressive rendering and architectural priority
- **IFC conversion**: Browser-based (WebAssembly) + server fallback, supporting IFC/RVT/GLB → XKT
- **3-tier caching**: Memory (0ms, 200MB LRU), Cloud storage (200–500ms), Asset+ (2–5s, first-time only)
- **Floor-priority loading**: Virtual chunks (Phase 1) and real per-storey tiles (Phase 2)
- **Performance plugins**: Frustum culling, LOD distance culling, FastNav, SAO, geometry instancing
- **Typed event system**: 40+ events with compile-time type safety
- **UI components**: Full toolbar, floor switcher, filter panel, tree navigator, visualization overlays, context menu, mobile overlay, architect color themes

### 4. Before vs. After Comparison Table
14-row comparison covering load times, caching, features, architecture, and codebase size.

### 5. Backend Services
Table of 8 edge functions (ifc-to-xkt, xkt-cache, xkt-split, viewer-manifest, etc.)

### 6. Database Schema
Key tables: xkt_models, geometry_entity_map, conversion_jobs, assets

### 7. Why We Made This Change
- Independence from Asset+ runtime dependency
- 3–5× performance improvement
- Feature velocity (ship without waiting for upstream)

### 8. Current Status & 9. Roadmap

## Implementation
- Single script using `docx` (npm) to generate a professional .docx with styled headings, tables, bullet lists, headers/footers, and page numbers
- Output to `/mnt/documents/Geminus-3D-Viewer-Technical-Report.docx`
- QA via LibreOffice PDF conversion + visual inspection

