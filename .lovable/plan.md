
# Plan: FM Access 2D-ritningsintegration

## Oversikt

Integrera FM Access 2D-viewer som en inbaddad iframe i UnifiedViewer (nytt lage "2D") och skapa en separat dashboard-sida for FM Access-data.

## Del 1: Ny "2D"-mode i UnifiedViewer

### Utoka ViewMode-typen

I `src/pages/UnifiedViewer.tsx` (rad 37):
```typescript
// Fran:
export type ViewMode = '3d' | 'split' | 'vt' | '360';
// Till:
export type ViewMode = '3d' | 'split' | 'vt' | '360' | '2d';
```

### Utoka edge function med `get-viewer-url`

I `supabase/functions/fm-access-query/index.ts`, lagg till en ny action `get-viewer-url` som:
1. Hamtar token + versionId (befintlig logik)
2. Returnerar en viewer-URL med autentiseringsparametrar for den begarda byggnaden/vaningen

```typescript
case 'get-viewer-url': {
  const { buildingId, floorId } = params;
  const token = await getToken(config);
  const versionId = await getVersionId(config, token);
  
  // Bygg viewer-URL med token-parameter
  const viewerUrl = `${config.apiUrl}/viewer/2d?floorId=${floorId}&token=${token}&versionId=${versionId}`;
  
  return new Response(
    JSON.stringify({ success: true, url: viewerUrl, token, versionId }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

Obs: Den exakta URL-strukturen beror pa FM Access API-dokumentationen. Vi bygger grundstrukturen och justerar parametrarna nar vi testar mot API:t.

### Lagg till ny action `get-floors` i edge function

For att hamta vaningsplan fran FM Access via byggnadens FMGUID:

```typescript
case 'get-floors': {
  const { buildingFmGuid } = params;
  const response = await fmAccessFetch(config, `/api/floors?buildingId=${encodeURIComponent(buildingFmGuid)}`);
  const data = await response.json();
  return new Response(
    JSON.stringify({ success: response.ok, data }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

### Ny komponent: FmAccess2DPanel

Skapa `src/components/viewer/FmAccess2DPanel.tsx`:
- Tar `buildingFmGuid` som prop
- Anropar edge function `fm-access-query` med action `get-viewer-url`
- Renderar en fullstorleks iframe med viewer-URL:en
- Visar laddningsindikator medan URL hamtas
- Visar felmeddelande om FM Access inte ar konfigurerat

### Integrera i UnifiedViewer

**Desktop-toolbar (rad 308-313):** Lagg till en "2D"-knapp i mode-switchern:
```typescript
<ModeButton mode="2d" current={viewMode} disabled={!hasFmAccess} onClick={setViewMode}
  icon={<Square className="h-3.5 w-3.5" />} label="2D" />
```

`hasFmAccess` bestams av om byggnaden har FM Access-konfiguration (kontrolleras via ett anrop vid mount eller via `building_external_links`-tabellen).

**Desktop-layout:** Lagg till 2D-panelen som ett nytt lager (display-styrt):
```typescript
{hasFmAccess && viewMode === '2d' && (
  <div style={{ position: 'absolute', inset: 0 }}>
    <FmAccess2DPanel buildingFmGuid={buildingData.fmGuid} />
  </div>
)}
```

**Mobil-layout:** Lagg till en "2D"-knapp i MobileUnifiedViewers toggle och rendera FmAccess2DPanel med display-styling.

### QuickActions: Lagg till 2D-knapp

I `QuickActions.tsx`, lagg till en "2D Ritning"-knapp som navigerar till `/split-viewer?building=...&mode=2d`.

---

## Del 2: FM Access Dashboard-sida

### Ny route och sida

Skapa `src/pages/FmAccessDashboard.tsx`:
- Visar en oversikt over FM Access-data for en vald byggnad
- Sektioner:
  - **Ritningar** — lista fran `get-drawings` action (redan implementerad i edge function)
  - **Dokument** — lista fran `get-documents` action (redan implementerad)
  - Klickbara rader som oppnar ritning/dokument-detaljer
- Anvander befintliga edge function-actions

### Lagg till route i App.tsx

```typescript
<Route path="/fm-access" element={<ProtectedRoute><FmAccessDashboard /></ProtectedRoute>} />
```

### Navigation

Lagg till i sidebar/meny sa att man kan na FM Access-dashboarden fran appens huvudnavigation.

---

## Sammanfattning av filandringar

```
Andrade filer:
  supabase/functions/fm-access-query/index.ts
    - Ny action: get-viewer-url (returnerar iframe-URL med token)
    - Ny action: get-floors (hamta vaningsplan via FMGUID)

  src/pages/UnifiedViewer.tsx
    - ViewMode: lagg till '2d'
    - ModeButton for 2D i toolbar
    - Rendera FmAccess2DPanel nar mode === '2d'
    - MobileUnifiedViewer: 2D-knapp + panel

  src/components/portfolio/QuickActions.tsx
    - Ny "2D Ritning"-knapp som navigerar till /split-viewer?mode=2d

Nya filer:
  src/components/viewer/FmAccess2DPanel.tsx
    - Iframe-embed av FM Access 2D-viewer
    - Hamtar autentiserad URL via edge function

  src/pages/FmAccessDashboard.tsx
    - Separat sida for FM Access ritningar och dokument

  src/App.tsx
    - Ny route /fm-access
```

## Risker och osakerheter

- **Viewer-URL-format:** Den exakta URL-strukturen for FM Access embed ar okand — vi bygger grundstrukturen och justerar efter test mot API:t.
- **Iframe-autentisering:** Om FM Access-viewern kraver cookies/session istallet for token i URL, behover vi en alternativ autentiseringsstrategi (t.ex. proxy via edge function).
- **CORS:** Iframe-embed brukar inte ha CORS-problem (till skillnad fran fetch), men vissa servrar blockerar iframe via `X-Frame-Options`.

Forsta steget ar att bygga grundstrukturen, testa `get-viewer-url` mot FM Access API:t, och justera darefter.
