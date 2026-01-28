
# Plan: Viewer Themes och Scrollbar-fix

## Sammanfattning
Implementera en funktion för "Viewer themes" (visnings-teman) där användaren kan välja mellan fördefinierade färgteman för 3D-viewern. Temana ska konfigureras i en ny sektion under Settings och visas som en dropdown-lista i Visnings-menyn. Dessutom åtgärdas scrollbarens synlighet i mobilt läge.

---

## Problem att lösa
1. **Scrollbar i mobilt läge**: Visningsmenyn är inte scrollbar på mobila enheter, vilket gör att användare inte kan nå verktygen längst ner.
2. **Viewer themes**: Användaren vill kunna skapa och välja egna färgteman (likt Arkitektvy) för 3D-viewern.

---

## Lösning

### Del 1: Fix för mobil scroll i VisualizationToolbar
- Ändra panelens höjdlogik för mobila enheter
- Säkerställ att `max-height` och `overflow` tillåter scroll på mobil
- Justera panelens position för att ge mer utrymme på mobil

### Del 2: Viewer Themes-system

#### A. Databasstruktur
Skapa en ny tabell `viewer_themes` för att lagra användardefinierade teman:

```text
┌────────────────────────────────────────────────────────────┐
│ viewer_themes                                               │
├────────────────────────────────────────────────────────────┤
│ id              (uuid, PK)                                  │
│ name            (text, NOT NULL) - Temanamn                │
│ is_system       (boolean) - Sant för inbyggda teman        │
│ color_mappings  (jsonb) - IFC-typ till färg-mappningar     │
│ edge_settings   (jsonb) - Kantinställningar                │
│ space_opacity   (numeric) - Transparens för rum            │
│ created_at      (timestamp)                                 │
│ updated_at      (timestamp)                                 │
└────────────────────────────────────────────────────────────┘
```

#### B. Nya komponenter
1. **ViewerThemeSettings.tsx** - Inställningssida i Settings-modalen
   - Lista alla sparade teman
   - Skapa/redigera/ta bort teman
   - Färgväljare för varje IFC-kategori
   - Förhandsvisning av temafärger

2. **ViewerThemeSelector.tsx** - Dropdown i VisualizationToolbar
   - Listar tillgängliga teman
   - "Arkitektvy" och "Standard" som fördefinierade val
   - Applicerar valt tema direkt på modellen

#### C. Hook-uppdateringar
Utöka `useArchitectViewMode.ts` till ett generellt `useViewerTheme.ts`:
- Läs tema-konfiguration från databas eller fördefinierade presets
- Applicera färger baserat på valt tema
- Återställ till standard när "Standard" väljs

---

## Tekniska detaljer

### Datastruktur för color_mappings (JSON)
```json
{
  "ifcwall": { "color": "#AFAA87", "edges": true },
  "ifcwallstandardcase": { "color": "#C2BEA2", "edges": true },
  "ifcdoor": { "color": "#5B776B", "edges": true },
  "ifcwindow": { "color": "#647D8A", "edges": true },
  "ifcslab": { "color": "#999B97", "edges": false },
  "ifcspace": { "color": "#E5E4E3", "opacity": 0.25 },
  "default": { "color": "#EEEEEE", "edges": false }
}
```

### Fördefinierade teman
1. **Standard** - Återställer till systemets originalfärger (ingen tema-applicering)
2. **Arkitektvy** - Befintliga arkitekt-färger (migreras till nytt system)

### RLS-policy
Publik läs- och skrivåtkomst (samma mönster som annotation_symbols).

---

## Filer som skapas
| Fil | Beskrivning |
|-----|-------------|
| `src/components/settings/ViewerThemeSettings.tsx` | Settings-komponent för att hantera teman |
| `src/components/viewer/ViewerThemeSelector.tsx` | Dropdown-komponent för att välja tema |
| `src/hooks/useViewerTheme.ts` | Hook för att applicera teman på 3D-modellen |

## Filer som ändras
| Fil | Ändring |
|-----|---------|
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till ViewerThemeSelector, fixa mobil scroll |
| `src/components/settings/ApiSettingsModal.tsx` | Lägg till "Viewer themes"-flik |

---

## UI-flöde

### I Visningsmenyn (VisualizationToolbar)
```text
┌─────────────────────────────┐
│ Visning                  ✕ │
├─────────────────────────────┤
│ BIM-modeller            ›  │
│ Våningsplan             ›  │
├─────────────────────────────┤
│ VISA                        │
│ ┌─────────────────────────┐ │
│ │ 🎨 Viewer-tema    [▼]   │ │  <-- NY DROPDOWN
│ │    ┌─────────────────┐  │ │
│ │    │ Standard ✓      │  │ │
│ │    │ Arkitektvy      │  │ │
│ │    │ Mitt tema 1     │  │ │
│ │    │ Mitt tema 2     │  │ │
│ │    └─────────────────┘  │ │
│ └─────────────────────────┘ │
│ 🏛 Arkitektvy        [  ]   │  <-- BEHÅLLS FÖR SNABBÅTKOMST
│ 🎨 Bakgrundsfärg            │
│   [○][○][○][○][○]           │
│ ...                         │
└─────────────────────────────┘
```

### I Settings (ny flik)
```text
┌─────────────────────────────────────────────────────────┐
│ Inställningar                                        ✕ │
├─────────────────────────────────────────────────────────┤
│ [Apps] [API:s] [Synk] [Symboler] [Röst] [Viewer themes]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Konfigurera färgteman för 3D-viewern     [+ Nytt tema] │
│                                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🎨 Arkitektvy                          [System]     │ │
│ │    12 färgmappningar                    [✏️] [🗑️]  │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ 🎨 Mitt tema                                        │ │
│ │    8 färgmappningar                     [✏️] [🗑️]  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ [Redigera tema]                                         │
│ Namn: [Mitt tema                        ]               │
│                                                         │
│ Färgmappningar:                                         │
│ ┌──────────────────┬──────────┬────────┐               │
│ │ IFC-typ          │ Färg     │ Kanter │               │
│ ├──────────────────┼──────────┼────────┤               │
│ │ Väggar (Fasad)   │ [🔴]     │ [✓]    │               │
│ │ Väggar (Invändiga)│ [🟠]    │ [✓]    │               │
│ │ Dörrar           │ [🟢]     │ [✓]    │               │
│ │ Fönster          │ [🔵]     │ [✓]    │               │
│ │ Tak/Golv         │ [⚪]     │ [ ]    │               │
│ │ Rum              │ [⬜] 25% │ [ ]    │               │
│ │ ...              │          │        │               │
│ └──────────────────┴──────────┴────────┘               │
│                                                         │
│                              [Avbryt] [Spara tema]      │
└─────────────────────────────────────────────────────────┘
```

---

## Implementeringsordning
1. Fixa mobil scroll i VisualizationToolbar
2. Skapa databas-tabell `viewer_themes`
3. Skapa `useViewerTheme.ts` hook
4. Skapa `ViewerThemeSettings.tsx` komponent
5. Lägg till "Viewer themes"-flik i ApiSettingsModal
6. Skapa `ViewerThemeSelector.tsx` dropdown
7. Integrera dropdown i VisualizationToolbar
8. Migrera Arkitektvy till nytt system
9. Lägg till "Standard" tema som återställer originalfärger
