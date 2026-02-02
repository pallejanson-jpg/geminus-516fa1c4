
# Plan: Gör alla sektioner i Settings till Collapse/Expand

## Sammanfattning
Ändra alla sektioner i App & API Settings-modalen till att använda konsekvent collapse/expand-mönster med Radix Accordion-komponenten. Alla sektioner ska vara **ihopvecklade som standard** för ett renare gränssnitt.

## Ändringar per flik

### 1. Viewer-fliken (ViewerThemeSettings.tsx)
**Nuvarande:** Teman visas som kort med "Redigera/Ta bort"-knappar
**Nytt:** Varje tema blir ett eget AccordionItem som kan veckas ut

```text
┌─────────────────────────────────────────────────┐
│ [▶] Standard (System)                           │
│ [▶] Arkitektvy (System)                         │  
│ [▶] Påls tema                              [🗑] │
│     └── (utfälld: färgpaletter, redigering)     │
│ [+ Nytt tema]                                   │
└─────────────────────────────────────────────────┘
```

Ändringar:
- Wrap temalistan i `<Accordion type="single" collapsible>`
- Varje tema blir `<AccordionItem>` med preview-swatches i triggern
- Redigeringsformulär (färgmappningar, opacity-slider) visas inuti `<AccordionContent>`

### 2. Viewer-fliken (RoomLabelSettings.tsx)
**Nuvarande:** Etikettkonfigurationer som kort
**Nytt:** Varje konfiguration blir ihopveckningsbar

```text
┌─────────────────────────────────────────────────┐
│ [▶] Rumsnamn (Standard)                         │
│ [▶] Namn och nummer                             │
│ [▶] Namn och area                          [🗑] │
│     └── (utfälld: fält, höjd, klickåtgärd)      │
│ [+ Ny konfiguration]                            │
└─────────────────────────────────────────────────┘
```

### 3. Apps-fliken (ApiSettingsModal.tsx)
**Nuvarande:** Varje app (Insights, FMA Plus, Asset+, etc.) är en öppen `<div>` med border
**Nytt:** Varje app blir ett ihopvecklat AccordionItem

```text
┌─────────────────────────────────────────────────┐
│ [▶] Insights                    [New Tab ⬜]    │
│ [▶] FMA Plus                    [In App ⬜]    │
│ [▶] Asset+                      [New Tab ⬜]    │
│ [▶] IoT                                         │
│ [▶] Original Archive                            │
│ [▶] Radar                                       │
│     └── (utfälld: URL, username, password)      │
└─────────────────────────────────────────────────┘
```

### 4. API's-fliken
**Nuvarande:** Använder HTML `<details>` element
**Nytt:** Byt till Accordion för konsekvent stil och animation

```text
┌─────────────────────────────────────────────────┐
│ [▶] Asset+                      [Konfigurerad] │
│ [▶] FM Access                   [Konfigurerad] │
│ [▶] Ivion (360+)                               │
│ [▶] Senslinc                                   │
└─────────────────────────────────────────────────┘
```

### 5. Sync-fliken
**Nuvarande:** Öppna kort för varje synkkategori
**Nytt:** Ihopvecklade sektioner

```text
┌─────────────────────────────────────────────────┐
│ [▶] Asset+ Synkronisering    [Kontrollera ⟳]   │
│     ├─ [▶] Byggnad/Plan/Rum        [I synk ✓]  │
│     ├─ [▶] Alla Tillgångar         [Ej synkad] │
│     └─ [▶] XKT-filer               [I synk ✓]  │
│ [▶] FM Access                  [Kommer snart]  │
│ [▶] Senslinc                   [Kommer snart]  │
│ [▶] Ivion                      [Kommer snart]  │
│ [▶] Congeria Dokument                          │
└─────────────────────────────────────────────────┘
```

### 6. Symboler-fliken (SymbolSettings.tsx)
**Nuvarande:** Lista med symbolkort
**Nytt:** Ihopvecklade symboler

### 7. Röst-fliken (VoiceSettings.tsx)
**Nuvarande:** Öppna sektioner
**Nytt:** Grupperade i Accordion

### 8. Gunnar-fliken (GunnarSettings.tsx)
**Nuvarande:** Öppna sektioner
**Nytt:** Grupperade i Accordion

---

## Teknisk implementation

### Fil: src/components/settings/ViewerThemeSettings.tsx
Ändra temalistan från Cards till Accordion:

```tsx
// Innan
{themes.map((theme) => (
  <Card key={theme.id}>...</Card>
))}

// Efter
<Accordion type="single" collapsible className="space-y-2">
  {themes.map((theme) => (
    <AccordionItem key={theme.id} value={theme.id} className="border rounded-lg">
      <AccordionTrigger className="px-4 py-3 hover:no-underline">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4" />
          <span>{theme.name}</span>
          {theme.is_system && <Badge variant="secondary">System</Badge>}
          {/* Color swatches preview */}
          <div className="flex gap-0.5 ml-2">
            {Object.values(theme.color_mappings).slice(0, 5).map((m, i) => (
              <div key={i} className="w-3 h-3 rounded" style={{backgroundColor: m.color}} />
            ))}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {/* Edit form: color pickers, sliders, save/delete buttons */}
      </AccordionContent>
    </AccordionItem>
  ))}
</Accordion>
```

### Fil: src/components/settings/RoomLabelSettings.tsx
Samma pattern - varje config blir AccordionItem.

### Fil: src/components/settings/ApiSettingsModal.tsx

**Apps-fliken (~rad 1066):**
```tsx
// Byt ut:
{Object.entries(DEFAULT_APP_CONFIGS).map(([key, defaultCfg]) => (
  <div className="border rounded-lg p-4">...</div>
))}

// Till:
<Accordion type="multiple" className="space-y-2">
  {Object.entries(DEFAULT_APP_CONFIGS).map(([key, defaultCfg]) => (
    <AccordionItem key={key} value={key} className="border rounded-lg">
      <AccordionTrigger className="px-4 py-3 hover:no-underline">
        <div className="flex items-center gap-2">
          <IconComp className="h-5 w-5 text-primary" />
          <span>{cfg.label}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {/* URL, username, password inputs */}
      </AccordionContent>
    </AccordionItem>
  ))}
</Accordion>
```

**API's-fliken (~rad 1162):**
```tsx
// Byt ut <details> till:
<Accordion type="multiple" className="space-y-2">
  <AccordionItem value="assetplus" className="border rounded-lg">
    <AccordionTrigger>Asset+</AccordionTrigger>
    <AccordionContent>...</AccordionContent>
  </AccordionItem>
  {/* FM Access, Ivion, Senslinc */}
</Accordion>
```

**Sync-fliken (~rad 1400):**
```tsx
<Accordion type="multiple" className="space-y-2">
  <AccordionItem value="assetplus-sync">
    <AccordionTrigger>
      <div className="flex items-center gap-2">
        <Box className="h-5 w-5 text-primary" />
        Asset+ Synkronisering
        <Badge>...</Badge>
      </div>
    </AccordionTrigger>
    <AccordionContent>
      {/* Nested accordion for Structure/Assets/XKT */}
      <Accordion type="multiple" className="space-y-2">
        <AccordionItem value="structure">...</AccordionItem>
        <AccordionItem value="assets">...</AccordionItem>
        <AccordionItem value="xkt">...</AccordionItem>
      </Accordion>
    </AccordionContent>
  </AccordionItem>
  {/* FM Access, Senslinc, Ivion, Congeria */}
</Accordion>
```

---

## Styling-principer

1. **Konsekvent trigger-stil:**
   - Ikon + Rubrik till vänster
   - Status-badge till höger (före pilen)
   - `hover:no-underline` för cleaner look

2. **Animerad expansion:**
   - Radix Accordion har inbyggd smooth animation
   - `data-[state=open]:rotate-180` på chevron

3. **Ihopvecklade som standard:**
   - `<Accordion type="multiple">` utan `defaultValue`
   - Eller `<Accordion type="single" collapsible>` för en-i-taget

4. **Touch-vänligt:**
   - Minst 44px touch target på triggers
   - `py-3 px-4` för god klickyta

---

## Filer som ändras

| Fil | Förändring |
|-----|------------|
| `src/components/settings/ViewerThemeSettings.tsx` | Tema-lista → Accordion |
| `src/components/settings/RoomLabelSettings.tsx` | Config-lista → Accordion |
| `src/components/settings/ApiSettingsModal.tsx` | Apps, API's, Sync → Accordion |
| `src/components/settings/SymbolSettings.tsx` | Symbol-lista → Accordion |
| `src/components/settings/VoiceSettings.tsx` | Sektioner → Accordion |
| `src/components/settings/GunnarSettings.tsx` | Sektioner → Accordion |

---

## Förväntad effekt

- **Renare UI:** Alla sektioner kollapade ger kompakt översikt
- **Konsekvent UX:** Samma interaktionsmönster överallt
- **Bättre prestanda:** Mindre DOM renderas initialt
- **Tillgänglighet:** Radix Accordion har inbyggd a11y (keyboard nav, ARIA)
