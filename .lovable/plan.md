

# Plan: Förbättrat Ivion 360° inventeringsflöde

## Sammanfattning av önskade ändringar

Baserat på referensbilden och feedback:
1. Placera registreringsformuläret till vänster, nära Ivions POI-panel
2. FAB-knappen bör visas nära toppen/vänster istället för nedre högra hörnet
3. "Starta inventering i 360°" ska vara tydligare och högst upp
4. Efter sparande ska man komma tillbaka till grundbilden för inventering
5. Automatisk POI-hämtning istället för manuell input

---

## Del 1: Flytta registreringspanelen till vänster

Referensbilden visar formuläret placerat till vänster sida av skärmen, direkt bredvid Ivions sökpanel. Detta skapar ett naturligt arbetsflöde där användaren arbetar med Ivions panel och Lovable's registreringsformulär sida vid sida.

### Ändringar i IvionRegistrationPanel.tsx

```typescript
// Ändra initial position från höger till vänster
const [position, setPosition] = useState({ 
  x: 360, // Till vänster, efter Ivions panel (~320px bred)
  y: 80   // Under header
});
```

Formuläret ska ha samma styling som på referensbilden: mörkt tema, transparent/frostat glas.

---

## Del 2: Flytta FAB-knappen

Istället för nedre högra hörnet, placera FAB-knappen:
- **Alternativ A:** Fast i övre vänstra hörnet (t.ex. under byggnadväljaren)
- **Alternativ B:** Flytande till vänster om Ivions panel
- **Alternativ C:** Integrerad i Lovable-headern uppe till vänster

Rekommenderar **Alternativ A**: En tydlig knapp i Lovable's header-rad som alltid är synlig.

### Ändringar i IvionInventory.tsx

```typescript
{/* Header bar with building selector */}
<div className="absolute top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-b">
  <div className="flex items-center justify-between px-4 py-2">
    {/* Left: Back + Building selector */}
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={handleClose}>
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <Select ...>...</Select>
    </div>
    
    {/* Right: Registration button + saved count */}
    <div className="flex items-center gap-3">
      {savedCount > 0 && <span>...</span>}
      
      {/* NY: Registrera-knapp i headern */}
      {!formOpen && ivionUrl && (
        <Button onClick={() => setFormOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Registrera tillgång
        </Button>
      )}
    </div>
  </div>
</div>

{/* Ta bort den flytande FAB-knappen nere till höger */}
```

---

## Del 3: "Starta inventering i 360°" mer framträdande

På inventeringssidan (desktop) ska 360°-alternativet vara tydligt synligt högst upp.

### Ändringar i Inventory.tsx (desktop-layout)

Lägg till en prominent knapp högst upp i inventeringsformuläret för byggnader med Ivion:

```typescript
{/* Om vald byggnad har Ivion, visa prominent 360°-knapp */}
{selectedBuildingHasIvion && (
  <Button 
    variant="default" 
    className="w-full h-14 mb-4"
    onClick={() => navigate(`/ivion-inventory?building=${selectedBuilding}`)}
  >
    <Camera className="h-5 w-5 mr-2" />
    Starta inventering i 360°
  </Button>
)}
```

---

## Del 4: Återgång till grundbilden efter sparande

När användaren sparar en tillgång i 360°-läget kan de antingen:
- Fortsätta registrera (nuvarande beteende - formuläret återställs)
- Avsluta och gå tillbaka (klicka på tillbakaknappen)

Lägg till alternativ att stänga hela 360°-läget efter sparande:

### Ändringar i IvionRegistrationPanel.tsx

```typescript
// Lägg till "Spara och avsluta" alternativ
<div className="p-4 border-t bg-card/50 flex gap-2">
  <Button
    variant="outline"
    onClick={handleSaveAndContinue}
    className="flex-1"
  >
    Spara & fortsätt
  </Button>
  <Button
    onClick={handleSaveAndClose}
    className="flex-1"
  >
    Spara & avsluta
  </Button>
</div>
```

### Ändringar i IvionInventory.tsx

```typescript
const handleAssetSavedAndClose = () => {
  setSavedCount(prev => prev + 1);
  setFormOpen(false);
  navigate('/inventory'); // Tillbaka till grundbilden
};
```

---

## Del 5: Automatisk POI-hämtning

### Problem
"Hämta position från POI" kräver att användaren manuellt anger POI-ID. Ivion API-autentiseringen misslyckas (403), så automatisk hämtning fungerar inte.

### Lösning A: Utan fungerande Ivion API
Om Ivion-credentials inte fungerar, kan vi:
1. Ta bort POI-hämtningssektionen (mindre förvirring)
2. Låta användaren manuellt ange koordinater om de kopierar från Ivion

### Lösning B: Med fungerande Ivion API (om credentials fixas)
"Hämta senaste POI" automatiskt när panelen öppnas:

```typescript
// I IvionRegistrationPanel, useEffect vid öppning
useEffect(() => {
  if (ivionSiteId) {
    // Försök hämta senaste POI automatiskt
    fetchLatestPoi();
  }
}, [ivionSiteId]);

const fetchLatestPoi = async () => {
  setIsFetchingPoi(true);
  try {
    const { data, error } = await supabase.functions.invoke('ivion-poi', {
      body: { action: 'get-latest-poi', siteId: ivionSiteId }
    });
    
    if (!error && data?.location) {
      setFetchedCoords(data.location);
      setFetchedPoiId(data.id);
      // Auto-fill name
      if (data.titles) {
        setName(data.titles['sv'] || data.titles['en'] || '');
      }
      toast.success('Senaste POI hämtad automatiskt!');
    }
  } catch (err) {
    // Silently fail - user can still register without coordinates
    console.log('Auto-fetch POI failed:', err);
  } finally {
    setIsFetchingPoi(false);
  }
};
```

### Rekommendation
Eftersom Ivion API-autentiseringen inte fungerar just nu, föreslår jag:
1. Göm "Hämta position från POI" sektionen tillfälligt (eller gör den kollapsbar)
2. Låt användaren registrera tillgångar utan koordinater
3. Lägg till en knapp "Synka koordinater senare" för framtida användning

---

## Filer att ändra

| Fil | Ändringar |
|-----|-----------|
| `src/pages/IvionInventory.tsx` | Flytta FAB till header, lägg till "Spara & avsluta" callback |
| `src/components/inventory/IvionRegistrationPanel.tsx` | Flytta panelen till vänster, lägg till "Spara & avsluta", automatisk POI-hämtning |
| `src/pages/Inventory.tsx` | Lägg till prominent "Starta i 360°" knapp högst upp |
| `src/components/inventory/InventoryForm.tsx` | Förbättra 360°-knappens placering |

---

## Visuell layout efter ändringar

```text
┌─────────────────────────────────────────────────────────────────────┐
│ [←] [Byggnad: Småviken ▼]              [Registrera tillgång] [2 sparade] │ ← Header
├─────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐ ┌───────────────┐                                  │
│ │ Ivion        │ │ ⁞⁞ Registrera │                                  │
│ │ Sökpanel     │ │ tillgång      │                                  │
│ │              │ │               │                                  │
│ │ sdafsadfsadf │ │ Namn *        │                                  │
│ │ 31401 Stock..│ │ [............]│            360° VY               │
│ │              │ │               │                                  │
│ │ [Share][Edit]│ │ Kategori *    │                                  │
│ │ [Route]      │ │ [Välj...]     │                                  │
│ │              │ │               │                                  │
│ └──────────────┘ │ Symbol *      │                                  │
│                  │ [Välj...]     │                                  │
│                  │               │                                  │
│                  │ [Spara & forts│                                  │
│                  │ [Spara & avsl]│                                  │
│                  └───────────────┘                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Teknisk notering om FAB i Ivion

NavVis Ivion är en extern tjänst hostade på swg.iv.navvis.com. Vi kan INTE:
- Injicera kod i deras iframe (cross-origin begränsning)
- Lägga till anpassade knappar i Ivions UI
- Lyssna på deras "onPoiSave" events utan admin-access

Därför måste FAB/registreringsknappen ligga i Lovable's eget overlay (headern) ovanpå iframen, inte i Ivion's UI.

Om ni har admin-access till NavVis-kontot finns möjlighet att skapa en "Custom Plugin" som skickar postMessage till parent-fönstret, men detta kräver konfiguration på NavVis-sidan.

