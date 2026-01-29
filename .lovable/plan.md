
# Plan: Åtgärda Inventerings-UI, Annotations och Ivion-synkproblem

## Sammanfattning av Identifierade Problem

Baserat på min analys av skärmbilderna och koden har jag identifierat följande problem som behöver åtgärdas:

---

## Problem 1: Desktop Layout för Inventering

**Nuvarande situation:** 
Formuläret är i mitten med en lista till vänster och 3D-viewer till höger (bild 1).

**Önskat läge:**
- Formuläret ska flyttas längst till vänster (ca 25% bredd som på bilden)
- Listan på senast registrerade assets ska bli en collapsible dropdown istället för en fast panel
- Höger sida ska vara förberedd för 3D-viewer OCH 360+ viewer

**Lösning:**
Omstrukturera `Inventory.tsx` med ny layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ DESKTOP LAYOUT                                              │
├────────────────┬────────────────────────────────────────────┤
│ FORMULÄR (25%) │ VIEWER PANEL (75%)                        │
│                │                                            │
│ ┌─ Dropdown ─┐ │  ┌──────────────────────────────────────┐  │
│ │ Senaste 6  │ │  │                                      │  │
│ │ sparade ▼  │ │  │  3D Viewer / 360+ Ivion              │  │
│ └────────────┘ │  │                                      │  │
│                │  │  (fylls med viewer vid behov)        │  │
│ Registrera     │  │                                      │  │
│ tillgång       │  │                                      │  │
│                │  └──────────────────────────────────────┘  │
│ [Formulär]     │                                            │
│                │                                            │
└────────────────┴────────────────────────────────────────────┘
```

---

## Problem 2: Inventerade Assets Syns Inte i Portfolio/Navigator

**Nuvarande situation:**
Nyregistrerade assets med `is_local: true` och `created_in_model: false` visas inte i Portfolio eller Navigator-vyerna.

**Orsak:**
`NavigatorView` och `PortfolioView` hämtar data från `AppContext.navigatorTreeData` som byggs från `allData`. Men `allData` filtrerar bort Instance-objekt som inte är `created_in_model`.

**Lösning:**
1. Uppdatera data-hämtningslogiken i `AppContext` för att inkludera lokalt skapade assets
2. Lägg till ny kategori "Lokala assets" eller "Inventerade" som underordnade barn till relevant building/room

---

## Problem 3: Annotation Försvinner vid Bekräftelse + Dubbla Bekräftelser

**Nuvarande situation (bild 2):**
- Användaren kan placera FLERA pins (📍) i 3D-vyn
- Det finns TVÅ bekräftelsesteg: en overlay i 3D-viewern OCH en i Inline3dPositionPicker-toolbaren
- Vid bekräftelse försvinner markeringen

**Orsak:**
1. `Inline3dPositionPicker.tsx` har sin egen "Bekräfta"-knapp (rad 79-86)
2. `AssetPlusViewer.tsx` har också en bekräftelse-overlay (rad 2318-2343)
3. Det finns ingen logik som tar bort tidigare temporära markeringar när en ny väljs
4. Temp-markören (`tempMarkerElement`) tas bort vid bekräftelse men ingen permanent annotation skapas förrän formuläret sparas

**Lösning:**
1. **En markering per asset:** Rensa befintlig temp-markör innan ny placeras
2. **Konsolidera bekräftelse:** Ta bort redundant bekräftelse-UI från antingen `Inline3dPositionPicker` eller `AssetPlusViewer`
3. **Permanent markör:** Behåll en visuell indikator tills formuläret sparas ELLER viewern stängs

---

## Problem 4: Annotations Kvarstår Efter Viewer Stängs (Bild 3)

**Nuvarande situation:**
Pins ligger kvar i gränssnittet även efter att 3D-viewern stängts.

**Orsak:**
Temp-markörerna skapas som absolut positionerade DOM-element med `document.body.appendChild(marker)` (rad 1130-1145 i AssetPlusViewer). Men dessa rensas inte ordentligt när:
1. Viewern stängs
2. Användaren navigerar bort
3. Formuläret sparas

**Lösning:**
1. Lägg till cleanup i `Inventory.tsx` som tar bort alla `.temp-pick-marker` element när viewer stängs
2. Lägg till cleanup i `AssetPlusViewer` unmount/cleanup effect
3. Använd React refs istället för direkt DOM-manipulation

---

## Problem 5: Ivion POI Sync Fel (403 Authentication Required)

**Felmeddelande:**
```
Ivion auth failed: 403 - {"msg":"Full authentication is required to access this resource"}
```

**Orsak:**
Ivion API:n förväntar sig en annan autentiseringsmetod. Funktionen `ivion-poi/index.ts` använder `/api/auth/login` med username/password i JSON body, men svaret ger 403.

**Möjliga orsaker:**
1. Fel endpoint för autentisering (NavVis har olika auth-metoder)
2. Credentials är korrekta men API:n kräver OAuth2 flow
3. Username/password är felaktiga

**Lösning:**
Verifiera Ivion-konfigurationen:
1. Kontrollera att `IVION_API_URL`, `IVION_USERNAME`, `IVION_PASSWORD` är korrekta
2. Testa alternativa auth-endpoints (t.ex. `/auth/token`, `/oauth/token`)
3. Logga detaljerad request/response för debugging

---

## Problem 6: Övervakning av Asset+-synkronisering

**Användarfråga:** 
"Har du lyckats med att skapa upp objekten från Lovable till Asset+?"

**Nuvarande situation:**
- `asset-plus-create` edge function finns och anropas, men det finns ingen UI för att visa synkstatus
- Assets sparas lokalt (`is_local: true`) men synkning till Asset+ sker inte automatiskt

**Lösning:**
1. Lägg till synkstatus-indikator i AssetsView (finns delvis redan med "Synka till Asset+"-knappen)
2. Lägg till loggning/statusvisning i API Settings för att visa senaste synkförsök
3. Visa tydlig feedback när ett objekt synkas

---

## Implementeringsplan

### Fas 1: Layout-förändringar (Inventory.tsx)

**Fil:** `src/pages/Inventory.tsx`

Ändringar:
- Flytta formuläret till vänster
- Gör "Senast registrerade"-listan till en collapsible dropdown
- Justera panel-proportioner (25% form, 75% viewer)

### Fas 2: Annotation Bugfixes

**Fil:** `src/components/viewer/AssetPlusViewer.tsx`

Ändringar:
- Rensa tidigare temp-markörer innan ny placeras
- Lägg till proper cleanup i useEffect för unmount
- Synkronisera bekräftelse-logik

**Fil:** `src/components/inventory/Inline3dPositionPicker.tsx`

Ändringar:
- Ta bort redundant bekräftelse-UI (använd AssetPlusViewer:s inbyggda)
- Eller: Kommunicera med AssetPlusViewer för att dölja dess overlay

**Fil:** `src/pages/Inventory.tsx`

Ändringar:
- Lägg till cleanup av `.temp-pick-marker` element när viewer stängs

### Fas 3: Synlighet av Inventerade Assets

**Fil:** `src/context/AppContext.tsx`

Ändringar:
- Modifiera `navigatorTreeData` byggnad för att inkludera lokalt skapade assets
- Lägg till refreshData-anrop efter spara i InventoryForm

### Fas 4: Ivion Authentication Fix

**Fil:** `supabase/functions/ivion-poi/index.ts`

Ändringar:
- Lägg till mer detaljerad logging för auth
- Testa alternativa auth-endpoints
- Returnera tydligare felmeddelanden

### Fas 5: Asset+ Synk-övervakning

**Filer:** 
- `src/components/settings/ApiSettingsModal.tsx`
- `src/components/portfolio/AssetsView.tsx`

Ändringar:
- Lägg till en sektion som visar senaste synkförsök och resultat
- Visa tydlig status för varje lokalt asset (synkad/ej synkad)

---

## Tekniska Detaljer

### Cleanup av Temp-markörer

```typescript
// I Inventory.tsx - när viewer stängs
const handleClose3d = () => {
  setViewer3dOpen(false);
  // Rensa alla temp-markörer
  document.querySelectorAll('.temp-pick-marker').forEach(el => el.remove());
};
```

### Collapsible Dropdown för Senast Sparade

```tsx
<Collapsible open={showRecent} onOpenChange={setShowRecent}>
  <CollapsibleTrigger className="flex items-center gap-2 w-full p-2">
    <span>Senast registrerade ({savedItems.length})</span>
    <ChevronDown className={showRecent ? 'rotate-180' : ''} />
  </CollapsibleTrigger>
  <CollapsibleContent>
    <InventoryList items={savedItems} onEdit={handleEdit} />
  </CollapsibleContent>
</Collapsible>
```

### Förhindra Multipla Pins

```typescript
// I AssetPlusViewer.tsx - handlePick
const handlePick = (pickResult: any) => {
  // FÖRST: Ta bort befintlig temp-markör
  if (tempMarkerElement) {
    tempMarkerElement.remove();
    setTempMarkerElement(null);
  }
  // ... resten av logiken
};
```

---

## Förväntat Resultat

1. **Layout:** Formuläret till vänster, viewer till höger, dropdown för senaste items
2. **Annotations:** Endast EN markör åt gången, rensas ordentligt vid stängning
3. **Synlighet:** Lokalt skapade assets visas i Navigator/Portfolio
4. **Ivion:** Bättre felhantering och logging för att diagnostisera auth-problem
5. **Asset+:** Tydlig status för synkronisering

