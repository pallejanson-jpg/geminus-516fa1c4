

## FM Access: Show Only 2D View + Filter (Strip Full App UI)

### Problem
The FM Access iframe currently loads `/client/` which renders the **entire HDC application** including the tree structure, navigation buttons, and all UI chrome. You only want the **2D drawing view and filter functionality**.

### Strategy

The edge function already generates two different URL patterns:
- `/client/?token=...` (currently used -- full app)
- `/viewer/2d?objectId=...&token=...&versionId=...` (already built in `get-viewer-url` action but not used by the frontend)

We will try a **two-layer approach**:

**Layer 1: Switch to `/viewer/2d` endpoint**
Change `FmAccess2DPanel.tsx` to build the iframe URL using `/viewer/2d` instead of `/client/`. This is a dedicated viewer path that likely shows only the 2D drawing without the full application shell.

**Layer 2: CSS fallback for remaining chrome**
If `/viewer/2d` still shows some unwanted UI elements (toolbar, headers), we cannot inject CSS into a cross-origin iframe directly. However, since the server blocks iframes anyway (X-Frame-Options) and you're working on getting whitelisting, we should first test with `/viewer/2d` and then iterate based on what actually renders.

---

### Technical Changes

#### File: `src/components/viewer/FmAccess2DPanel.tsx`

**Change the iframe URL construction** (lines 157-166):

Replace the current `/client/` URL builder:
```typescript
// BEFORE:
const base = `${embedConfig.apiUrl}/client/`;
const params = new URLSearchParams();
params.set('token', embedConfig.token);
if (embedConfig.versionId) params.set('versionId', embedConfig.versionId);
if (embedConfig.drawingObjectId) params.set('objectId', embedConfig.drawingObjectId);
```

With the `/viewer/2d` endpoint:
```typescript
// AFTER:
const base = `${embedConfig.apiUrl}/viewer/2d`;
const params = new URLSearchParams();
params.set('token', embedConfig.token);
if (embedConfig.versionId) params.set('versionId', embedConfig.versionId);
if (embedConfig.drawingObjectId) params.set('objectId', embedConfig.drawingObjectId);
```

This is a single-line change (`/client/` becomes `/viewer/2d`).

#### File: `supabase/functions/fm-access-query/index.ts`

**Update `get-embed-config` to also return the viewer-2d URL** so the frontend has both options:

Add a `viewer2dUrl` field to the response alongside the existing `embedUrl`:
```typescript
const viewer2dUrl = drawingObjectId
  ? `${config.apiUrl}/viewer/2d?objectId=${encodeURIComponent(drawingObjectId)}&token=${encodeURIComponent(token)}&versionId=${encodeURIComponent(versionId)}`
  : `${config.apiUrl}/viewer/2d?token=${encodeURIComponent(token)}&versionId=${encodeURIComponent(versionId)}`;
```

Return it in the response so the frontend can use it directly if preferred.

---

### What This Achieves

| Before | After |
|--------|-------|
| Full HDC application with tree, nav, all panels | Only the 2D drawing viewer |
| `/client/?token=...` | `/viewer/2d?objectId=...&token=...&versionId=...` |

### Dependencies

- The FM Access server (`swg-demo.bim.cloud`) must still be whitelisted to allow iframe embedding from `*.lovable.app`
- The `/viewer/2d` endpoint must exist on their server (it is already referenced in the edge function, so it should)

### Risk & Iteration

If `/viewer/2d` does not exist or shows different UI than expected, we can:
1. Fall back to `/client/?awaitConfig=true` and send a `postMessage` to configure which panels to show (the HDC client appears to support this pattern)
2. Investigate other HDC URL parameters that control UI visibility

This is a minimal, low-risk change -- just switching the URL path from `/client/` to `/viewer/2d`.

