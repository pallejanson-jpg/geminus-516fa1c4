
# Plan: Konsolidera annotation-kontroller till en enda flyout-panel

## Problem

Det finns två separata UI-element för att hantera annotationssynlighet:
1. **Röda dropdownen** (AnnotationToggleMenu) - i övre högra hörnet, visar kategorier som "fire_blanket" med individuella switchar
2. **"Visa annotationer" switch** - i Visning-menyn, slår på/av alla annotationer globalt

Detta är redundant och förvirrande. Användaren vill ha EN plats för att hantera annotationer.

---

## Lösning

Konsolidera all annotation-funktionalitet till Visning-menyn genom att:
1. **Ta bort** `AnnotationToggleMenu` från `AssetPlusViewer.tsx`
2. **Ändra** "Visa annotationer"-raden i `VisualizationToolbar.tsx` från en enkel switch till en klickbar rad som öppnar en flyout-panel (SidePopPanel)
3. **Flytta** kategorilogiken från `AnnotationToggleMenu` till den nya flyout-panelen

---

## Visuell jämförelse

### Före
```text
+-- Övre högra hörnet --+
| [Visning-knapp] [Annotationer (1/1) ▼] |  <- Två knappar, redundant
+------------------------+

I Visning-menyn:
VISA
[ ] 2D/3D
[ ] Visa rum
[x] Visa annotationer  <- Bara on/off
[ ] Rumsvisualisering
```

### Efter
```text
+-- Övre högra hörnet --+
| [Visning-knapp]                        |  <- Bara en knapp
+------------------------+

I Visning-menyn:
VISA
[ ] 2D/3D
[ ] Visa rum
[x] Visa annotationer  [>]  <- Klickbar för att öppna kategori-panel
[ ] Rumsvisualisering

+-- Flyout-panel (SidePopPanel) --+
| Annotationstyper                |
| [Visa alla] [Dölj alla]         |
| ● fire_blanket (1)      [x]     |
| ● other_type (3)        [ ]     |
+---------------------------------+
```

---

## Detaljerade ändringar

### 1. AssetPlusViewer.tsx - Ta bort redundant komponent

**Radera rad 1582-1585:**
```typescript
// REMOVE this:
<AnnotationToggleMenu 
  viewerRef={viewerInstanceRef} 
  buildingFmGuid={fmGuid}
/>
```

**Skicka buildingFmGuid till VisualizationToolbar:**
```typescript
<VisualizationToolbar
  viewerRef={viewerInstanceRef}
  buildingFmGuid={fmGuid}  // <- Lägg till denna
  ...
/>
```

### 2. VisualizationToolbar.tsx - Lägg till annotation flyout

**Lägg till nytt state för submeny:**
```typescript
const [activeSubMenu, setActiveSubMenu] = useState<'models' | 'floors' | 'annotations' | null>(null);
```

**Ändra "Visa annotationer"-raden (rad 658-674) från en enkel switch till klickbar rad:**

```typescript
{/* Annotations - click to open side panel, switch for global toggle */}
<div className="flex items-center justify-between py-1.5 sm:py-2">
  <div className="flex items-center gap-2 sm:gap-3">
    <div className={cn(
      "p-1 sm:p-1.5 rounded-md",
      showAnnotations
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground"
    )}>
      <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
    </div>
    <span className="text-xs sm:text-sm">Visa annotationer</span>
  </div>
  <div className="flex items-center gap-1">
    <Switch checked={showAnnotations} onCheckedChange={handleToggleAnnotations} />
    <Button
      variant={activeSubMenu === 'annotations' ? "secondary" : "ghost"}
      size="sm"
      className="h-6 w-6 p-0"
      onClick={() => setActiveSubMenu(activeSubMenu === 'annotations' ? null : 'annotations')}
    >
      <ChevronRight className={cn(
        "h-3 w-3 transition-transform",
        activeSubMenu === 'annotations' && "rotate-180"
      )} />
    </Button>
  </div>
</div>
```

**Lägg till ny SidePopPanel för annotationstyper (efter floors-panelen):**

```typescript
{/* Side-pop panel for Annotation Categories */}
<SidePopPanel
  isOpen={activeSubMenu === 'annotations'}
  onClose={() => setActiveSubMenu(null)}
  title="Annotationstyper"
  parentPosition={position}
  parentWidth={panelWidth}
>
  <AnnotationCategoryList
    viewerRef={viewerRef}
    buildingFmGuid={buildingFmGuid}
  />
</SidePopPanel>
```

### 3. Skapa ny komponent: AnnotationCategoryList.tsx

Extraherar kategorilogiken från `AnnotationToggleMenu` till en listkomponent för användning i flyout-panelen:

```typescript
interface AnnotationCategoryListProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid?: string;
}

const AnnotationCategoryList: React.FC<AnnotationCategoryListProps> = ({
  viewerRef,
  buildingFmGuid,
}) => {
  const [categories, setCategories] = useState<AnnotationCategory[]>([]);
  const [allVisible, setAllVisible] = useState(true);
  
  // Fetch categories (same logic as AnnotationToggleMenu)
  // ...
  
  return (
    <div className="space-y-2">
      {/* Show/Hide All button */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={handleToggleAll}>
          {allVisible ? 'Dölj alla' : 'Visa alla'}
        </Button>
      </div>
      
      {/* Category list */}
      {categories.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-2">
          Inga annotationer i denna byggnad
        </p>
      ) : (
        categories.map((cat) => (
          <div key={cat.category} className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <div 
                className="w-2.5 h-2.5 rounded-full" 
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-xs">{cat.category}</span>
              <span className="text-[10px] text-muted-foreground">({cat.count})</span>
            </div>
            <Switch
              checked={cat.visible}
              onCheckedChange={() => handleToggleCategory(cat.category)}
              className="scale-75"
            />
          </div>
        ))
      )}
    </div>
  );
};
```

---

## Filändringar

| Fil | Ändring |
|-----|---------|
| `src/components/viewer/AssetPlusViewer.tsx` | Ta bort `<AnnotationToggleMenu>`, skicka `buildingFmGuid` till VisualizationToolbar |
| `src/components/viewer/VisualizationToolbar.tsx` | Lägg till `activeSubMenu: 'annotations'`, ändra annotation-raden till att inkludera flyout-knapp, lägg till ny SidePopPanel |
| `src/components/viewer/AnnotationCategoryList.tsx` | NY FIL - Extraherad kategorilogik för användning i flyout |
| `src/components/viewer/AnnotationToggleMenu.tsx` | KAN RADERAS efter implementation (eller behållas som referens) |

---

## Förväntade resultat

1. **En enda plats** för annotation-kontroll i Visning-menyn
2. **Huvudswitch** slår på/av alla annotationer (snabb åtkomst)
3. **Flyout-panel** ger detaljerad kontroll per kategori
4. **Konsistent UI** - samma mönster som BIM-modeller och Våningsplan använder
5. **Renare gränssnitt** - en knapp mindre i övre högra hörnet
