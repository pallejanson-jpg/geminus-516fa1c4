
# Plan: FM Access 2D-ritningsintegration

**Status: ✅ Implementerad**

## Vad som implementerats

### Edge function (fm-access-query)
- Ny action `get-viewer-url`: Hämtar OAuth-token + versionId, bygger autentiserad viewer-URL
- Ny action `get-floors`: Hämtar våningsplan via byggnadens FMGUID

### FmAccess2DPanel (src/components/viewer/FmAccess2DPanel.tsx)
- Iframe-embed av FM Access 2D-viewer
- Hämtar autentiserad URL via edge function
- Laddningsindikator + felhantering

### UnifiedViewer (src/pages/UnifiedViewer.tsx)
- ViewMode utökad med `'2d'`
- 2D-knapp i toolbar (desktop + mobil) — visas om `building_external_links` har `system_name='fm_access'`
- FmAccess2DPanel renderas i 2D-läge

### FmAccessDashboard (src/pages/FmAccessDashboard.tsx)
- Separat sida med ritningar och dokument från FM Access
- Route: `/fm-access?building=<fmGuid>`

### Navigation
- FM Access tillagd i AppSidebar
- Route `/fm-access` registrerad i App.tsx
- "2D Ritning"-knapp i QuickActions

## Kvarvarande osäkerheter
- Viewer-URL-format behöver verifieras mot FM Access API
- Iframe-autentisering kan kräva cookie/session istället för token i URL
- X-Frame-Options kan blockera iframe-embed
