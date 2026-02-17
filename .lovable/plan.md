

## Plan: Progress-indikator for IFC-konvertering

### Bakgrund

Idag visas konverteringsstatus som en liten Badge med texten "Server..." eller statusnamnet. Nar IFC-konverteringen kors (som kan ta 1-5 minuter for stora modeller) far anvandaren ingen detaljerad feedback om hur langt processen har kommit.

### Andringar

#### 1. Utoka `TranslationStatus` med numerisk progress

**Fil:** `src/services/acc-xkt-converter.ts`

Lagg till `progressPercent` (0-100) i `TranslationStatus`-interfacet. Uppdatera alla stallen dar status satts under konverteringen:
- `runFullPipeline` steg 1-4: Satt progressPercent for varje fas (0-20 for translation, 20-40 for download, 40-95 for konvertering, 95-100 for sparning)
- `convertGlbToXkt`: Lagg till en `onProgress`-callback som rapporterar ungefar var i konverteringsprocessen vi ar (parsing, finalize, write)
- `tryServerConversion`: Samma procentstruktur

#### 2. Skapa en `ConversionProgressOverlay`-komponent

**Ny fil:** `src/components/settings/ConversionProgressOverlay.tsx`

En liten overlay/panel som visas i ApiSettingsModal under aktivt konverteringsjobb:
- Visar en `Progress`-bar (ateranvander befintlig `src/components/ui/progress.tsx`)
- Visar aktuellt steg i text (t.ex. "Vantar pa Autodesk...", "Laddar ner IFC...", "Konverterar IFC till XKT...")
- Visar filnamn och forlopd tid
- Animerad ikon nar processen gar (Loader2 spinner)
- Dold nar inget jobb ar aktivt

#### 3. Integrera overlayen i ApiSettingsModal

**Fil:** `src/components/settings/ApiSettingsModal.tsx`

- Importera och rendera `ConversionProgressOverlay` ovanfor fillistningen i ACC-fliken
- Skicka in aktuell `translationStatuses` -- overlayen visar info for det jobb som ar aktivt
- Behall befintliga badges for individuella filer men visa den detaljerade progressen i overlayen

### Tekniska detaljer

**Uppdaterat TranslationStatus-interface:**
```typescript
export interface TranslationStatus {
  status: 'idle' | 'pending' | 'inprogress' | 'success' | 'failed' 
        | 'downloading' | 'converting' | 'complete' | 'server-converting';
  progress?: string;
  progressPercent?: number;  // 0-100, ny
  step?: string;             // kort stegbeskrivning, ny
  message?: string;
  error?: string;
  derivativeCount?: number;
  downloadUrl?: string;
}
```

**Progress-steg i pipelinen:**

| Fas | Procent | Steg-text |
|-----|---------|-----------|
| Starta oversattning | 0-5% | "Startar oversattning..." |
| Vanta pa Autodesk | 5-20% | "Vantar pa Autodesk..." |
| Ladda ner IFC | 20-35% | "Laddar ner IFC-fil..." |
| Parsa IFC (WASM) | 35-75% | "Konverterar IFC-geometri..." |
| Finalisera XKT | 75-90% | "Bygger XKT-modell..." |
| Spara i cache | 90-100% | "Sparar 3D-modell..." |

**ConversionProgressOverlay layout:**
```text
+--------------------------------------------------+
| [spinner] Konverterar: Stadshuset.rvt             |
| [==============--------] 62%                      |
| Konverterar IFC-geometri... (2m 15s)              |
+--------------------------------------------------+
```

### Filer som andras

| Fil | Andring |
|-----|---------|
| `src/services/acc-xkt-converter.ts` | Lagg till `progressPercent` och `step` i TranslationStatus, satt varden i varje pipeline-steg |
| `src/components/settings/ConversionProgressOverlay.tsx` | Ny komponent med Progress-bar och steg-info |
| `src/components/settings/ApiSettingsModal.tsx` | Rendera ConversionProgressOverlay i ACC-fliken |

