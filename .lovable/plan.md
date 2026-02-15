

## Synkronisera Insights-diagramfärger med 3D-visning

### Översikt
Koppla ihop diagrammens färger i BuildingInsightsView med 3D-viewern så att klick på "Visa" eller enskilda staplar/segment öppnar modellen i X-Ray-läge med matchande färgkodning.

### Ändring 1: Unika färger per våning i Energy per Floor

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

- Ta bort `<MockBadge />` från Energy per Floor-kortets header (rad 285)
- Byt ut den nuvarande tvåfärgade logiken (rad 181) till en palett med 6+ distinkta färger:
```
const FLOOR_COLORS = [
  'hsl(220, 80%, 55%)',  // Blue
  'hsl(142, 71%, 45%)',  // Green
  'hsl(48, 96%, 53%)',   // Yellow
  'hsl(262, 83%, 58%)',  // Purple
  'hsl(16, 85%, 55%)',   // Orange
  'hsl(340, 75%, 55%)',  // Pink
  'hsl(180, 60%, 45%)',  // Teal
  'hsl(0, 72%, 51%)',    // Red
];
```
- Varje våning tilldelas `FLOOR_COLORS[index % FLOOR_COLORS.length]`

### Ändring 2: Ny navigeringsmekanism med färgkarta via sessionStorage

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

Utöka `navigateTo3D` till att stödja ett nytt "insights color mode":

- **Övergripande Visa (Energy per Floor):** Spara en färgkarta i `sessionStorage` som mappar varje `floorFmGuid -> färg (RGB)`. Sätt URL-param `insightsMode=energy_floors` + `xray=true`.
- **Klick på enskild stapel:** Spara `floorFmGuid -> färg` för bara den våningen. Sätt URL-param `insightsMode=energy_floor` + `entity=fmGuid` + `xray=true`.
- **Övergripande Visa (Asset Categories):** Spara `assetType -> färg` för alla kategorier. Sätt URL-param `insightsMode=asset_categories` + `xray=true`.
- **Klick på enskilt segment (Asset Categories):** Spara `assetType -> färg` för bara den kategorin. Sätt URL-param `insightsMode=asset_category` + `assetType=namn` + `xray=true`.

sessionStorage-nyckeln blir `insights_color_map` med JSON-format:
```json
{
  "mode": "energy_floors",
  "colorMap": { "guid1": [0.34, 0.56, 0.78], "guid2": [0.92, 0.38, 0.21] }
}
```

### Ändring 3: Läsa och applicera insightsMode i UnifiedViewer/AssetPlusViewer

**Fil: `src/pages/UnifiedViewer.tsx`**

- Läs `insightsMode` och `xray` från searchParams
- Skicka vidare som nya props till AssetPlusViewer: `insightsColorMode` och `forceXray`

**Fil: `src/components/viewer/AssetPlusViewer.tsx`**

Lägg till ny prop `insightsColorMode?: string` och `forceXray?: boolean`:

- När `insightsColorMode` är satt och modellen har laddats:
  1. Läs färgkartan från `sessionStorage('insights_color_map')`
  2. Om mode = `energy_floors`: Sätt alla objekt i X-Ray. För varje våning: hitta alla rum (IfcSpace) under den våningen, ta bort X-Ray på dem och sätt `entity.colorize = [r, g, b]` med färgen från kartan
  3. Om mode = `energy_floor`: Isolera den specifika våningen, ta bort X-Ray på dess rum, färglägg dem med stapelns färg
  4. Om mode = `asset_categories`: Sätt alla objekt i X-Ray. För varje asset-kategori: hitta matchande objekt, ta bort X-Ray och färglägg dem med cirkeldiagrammets färg
  5. Om mode = `asset_category`: Samma men bara för den valda kategorin
  6. Rensa sessionStorage efter applicering

Implementeras som en ny `useEffect` som triggas efter `modelLoadState === 'loaded'`, liknande den befintliga `initialVisualization`-logiken.

### Ändring 4: Lägg till klick-hantering på pie-chart segment (Asset Categories)

**Fil: `src/components/insights/BuildingInsightsView.tsx`**

- Ta bort den nuvarande `onClick` på hela Card-elementet (rad 409)
- Lägg till `onClick` på varje `<Cell>` i Asset Categories pie-chartet som navigerar med just den kategorins färg
- Behåll `<ViewerLink>` i headern men byt dess onClick till att navigera med alla kategorier

### Ändring 5: HSL-till-RGB-konvertering

**Fil: `src/lib/visualization-utils.ts`**

Lägg till en hjälpfunktion `hslStringToRgbFloat(hslString): [number, number, number]` som konverterar HSL-strängar (t.ex. `'hsl(220, 80%, 55%)'`) till normaliserade RGB-floats (0-1) för xeokit.

### Sammanfattning av filer som ändras

| Fil | Ändring |
|-----|---------|
| `BuildingInsightsView.tsx` | Unika våningsfärger, ta bort Demo-badge, sessionStorage-färgkarta, Cell-onClick på pie |
| `UnifiedViewer.tsx` | Läs `insightsMode` + `xray` params, skicka vidare till AssetPlusViewer |
| `AssetPlusViewer.tsx` | Ny useEffect: läs färgkarta, applicera X-Ray + färgkodning efter modell-laddning |
| `visualization-utils.ts` | Ny `hslStringToRgbFloat()` hjälpfunktion |

### Flöde

1. Användare klickar "Visa" eller stapel/segment i Insights
2. Färgkarta sparas i sessionStorage
3. navigate() öppnar 3D-viewer med insightsMode-param
4. AssetPlusViewer detekterar insightsMode efter modell-laddning
5. Läser färgkarta, sätter X-Ray på allt, tar bort X-Ray och färglägger matchande objekt
6. Rensar sessionStorage

