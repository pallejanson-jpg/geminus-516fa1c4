
# Plan: Förbättrad UniversalPropertiesDialog & Hero Image Upload

## Sammanfattning

Användaren vill göra tre förbättringar:
1. **Göra dialogen resizable** - Lägg till en resize-handle i nedre högra hörnet (desktop)
2. **Ta bort dubbel redigeraknapp** - Behåll endast "Redigera"-knappen längst ner, ta bort "Redigerbar"-badge vid sektioner
3. **Hero image upload** - Ny funktion i Building Settings för att ladda upp herobild, placerad under Map Position

---

## Del 1: Resizable Dialog

### Problem
Dialogen har fast storlek (`max-w-[400px]`) och kan inte justeras av användaren.

### Lösning
Lägg till en resize-handle i nedre högra hörnet som tillåter användaren att dra för att ändra storlek.

**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`

```typescript
// Lägg till resize state
const [size, setSize] = useState({ width: 400, height: 500 });
const [isResizing, setIsResizing] = useState(false);
const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

// Resize handlers
const handleResizeStart = (e: React.MouseEvent) => {
  e.preventDefault();
  setIsResizing(true);
  setResizeStart({
    x: e.clientX,
    y: e.clientY,
    width: size.width,
    height: size.height,
  });
};

useEffect(() => {
  if (!isResizing) return;

  const handleMouseMove = (e: MouseEvent) => {
    const newWidth = Math.max(320, Math.min(800, resizeStart.width + (e.clientX - resizeStart.x)));
    const newHeight = Math.max(300, Math.min(window.innerHeight - 100, resizeStart.height + (e.clientY - resizeStart.y)));
    setSize({ width: newWidth, height: newHeight });
  };

  const handleMouseUp = () => setIsResizing(false);

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  return () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };
}, [isResizing, resizeStart]);

// I huvudkomponenten, lägg till resize handle:
<div
  className="hidden sm:block absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
  onMouseDown={handleResizeStart}
>
  {/* Resize grip icon */}
  <svg className="w-3 h-3 absolute bottom-1 right-1 text-muted-foreground" viewBox="0 0 10 10">
    <path d="M0 10 L10 0 M4 10 L10 4 M7 10 L10 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
</div>

// Uppdatera container style:
style={{ 
  left: position.x, 
  top: position.y,
  width: size.width,
  height: isCollapsed ? 'auto' : size.height,
}}
```

---

## Del 2: Ta bort dubbel redigeraknapp

### Problem
Det finns en "Redigerbar"-badge vid "Lokala inställningar"-sektionen (rad 446-451) OCH en "Redigera"-knapp längst ner i dialogen (rad 495-498).

### Lösning
Ta bort "Redigerbar"-badge från sektionshuvudet och behåll endast "Redigera"-knappen i footer.

**Fil:** `src/components/common/UniversalPropertiesDialog.tsx`

Ta bort rad 446-451:
```diff
- {hasEditable && (
-   <Badge variant="outline" className="text-[10px]">
-     <Pencil className="h-2.5 w-2.5 mr-1" />
-     Redigerbar
-   </Badge>
- )}
```

---

## Del 3: Hero Image Upload för Byggnader

### Databasändring
Lägg till `hero_image_url`-kolumn i `building_settings`-tabellen:

```sql
ALTER TABLE public.building_settings 
ADD COLUMN hero_image_url TEXT DEFAULT NULL;
```

### Hook-uppdatering
**Fil:** `src/hooks/useBuildingSettings.ts`

```typescript
interface BuildingSettings {
  fmGuid: string;
  isFavorite: boolean;
  ivionSiteId: string | null;
  latitude: number | null;
  longitude: number | null;
  heroImageUrl: string | null; // NY
}

// Uppdatera fetch, save, och lägg till:
const updateHeroImage = useCallback(async (url: string | null) => {
  await saveSettings({ heroImageUrl: url });
}, [saveSettings]);
```

### UI-uppdatering
**Fil:** `src/components/portfolio/FacilityLandingPage.tsx`

Lägg till Hero Image-sektion i Building Settings (efter Map Position, rad ~378):

```tsx
{/* Hero Image Settings */}
<div className="border-t pt-4">
  <Label className="text-xs flex items-center gap-2 mb-3">
    <Image size={12} />
    Hero Image
  </Label>
  
  {settings?.heroImageUrl ? (
    <div className="relative rounded-lg overflow-hidden border mb-2">
      <img 
        src={settings.heroImageUrl} 
        alt="Building hero" 
        className="w-full h-32 object-cover"
      />
      <Button
        variant="destructive"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7"
        onClick={() => updateHeroImage(null)}
        disabled={isSaving}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  ) : (
    <div className="flex gap-2 mb-2">
      <Button
        variant="outline"
        className="flex-1 h-16 flex-col gap-1"
        onClick={() => heroInputRef.current?.click()}
        disabled={isUploadingHero}
      >
        {isUploadingHero ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <>
            <Upload className="h-5 w-5" />
            <span className="text-xs">Ladda upp bild</span>
          </>
        )}
      </Button>
    </div>
  )}
  
  <p className="text-[10px] text-muted-foreground">
    Visas som bakgrundsbild på byggnadens landningssida
  </p>
  
  <input
    ref={heroInputRef}
    type="file"
    accept="image/*"
    className="hidden"
    onChange={handleHeroImageUpload}
  />
</div>
```

Uppdatera också `heroImage`-variabeln (rad 188) för att använda sparad bild:
```tsx
const heroImage = settings?.heroImageUrl || facility.image || (isSpace 
  ? 'https://images.unsplash.com/photo-1611048264355-27a69db69042?q=80&w=1600' 
  : 'https://images.unsplash.com/photo-1515263487990-61b07816b324?q=80&w=1600'
);
```

---

## Filer som Påverkas

| Fil | Ändringar |
|-----|-----------|
| `src/components/common/UniversalPropertiesDialog.tsx` | Resize-funktionalitet, ta bort "Redigerbar"-badge |
| `src/hooks/useBuildingSettings.ts` | Lägg till `heroImageUrl` i interface och funktioner |
| `src/components/portfolio/FacilityLandingPage.tsx` | Hero image upload-sektion, använd sparad bild |
| **Databasmigrering** | Lägg till `hero_image_url`-kolumn |

---

## Visuell Översikt

```text
┌─────────────────────────────────────────────────┐
│ ⋮⋮ Centralstationen  [Building]     [^] [×]   │
├─────────────────────────────────────────────────┤
│ 🔍 Sök egenskaper...                           │
├─────────────────────────────────────────────────┤
│ ▼ System                              (4)      │  ← Ingen "Redigerbar"-badge
│   FM GUID: 755950d9-f235...                    │
│   Kategori: Building                           │
│                                                │
│ ▼ Lokala inställningar                (4)      │  ← Ingen "Redigerbar"-badge
│   Visningsnamn: Centralstationen               │
│   Favorit: Ja                                  │
│                                                │
│ ▼ Användardefinierade                 (36)     │
│   ...                                          │
├─────────────────────────────────────────────────┤
│                              [✏️ Redigera]     │  ← Enda redigeraknappen
│                                          ⟋     │  ← Resize handle
└─────────────────────────────────────────────────┘

Building Settings Panel:
┌─────────────────────────────────────────────────┐
│ ⚙️ Building Settings                            │
├─────────────────────────────────────────────────┤
│ Ivion Site ID: [____________] [Save]           │
│ Show on Home Page: [⭐ In Favorites]            │
├─────────────────────────────────────────────────┤
│ 🌍 Map Position                                │
│ ┌───────────────────────────────────┐          │
│ │        [Interactive Map]          │          │
│ └───────────────────────────────────┘          │
│ 59.3359, 18.0126                    [Spara]    │
├─────────────────────────────────────────────────┤
│ 🖼️ Hero Image                        ← NY      │
│ ┌───────────────────────────────────┐          │
│ │     [Upload bild] / Preview       │          │
│ └───────────────────────────────────┘          │
│ Visas som bakgrundsbild på landningssidan      │
└─────────────────────────────────────────────────┘
```

---

## Tekniska Detaljer

### Resize-logik
- Min bredd: 320px, Max bredd: 800px
- Min höjd: 300px, Max höjd: viewport - 100px
- Endast synlig på desktop (`hidden sm:block`)
- Använder standard SE-resize cursor

### Hero Image Upload
- Återanvänd samma logik som `ImageUpload.tsx`
- Lagras i `inventory-images` bucket med sökvägen `heroes/{fm_guid}.{ext}`
- Uppdaterar `building_settings.hero_image_url` via hook

### Databasmigrering
Migration behövs för att lägga till kolumnen - detta kommer hanteras automatiskt.
