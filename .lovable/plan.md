
# Plan: Lägg till "My Views" sektion på startsidan

## Översikt

Lägga till en ny sektion "My Views" under "My Favorites" på startsidan som visar användarens sparade 3D-vyer med förhandsbilder och snabb åtkomst.

## Implementation

### Del 1: Skapa hook för att hämta sparade vyer

Skapa en ny hook `useSavedViews` som hämtar alla sparade vyer från databasen:

```typescript
// src/hooks/useSavedViews.ts
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SavedView {
  id: string;
  name: string;
  description: string | null;
  building_fm_guid: string;
  building_name: string | null;
  screenshot_url: string | null;
  view_mode: string | null;
  created_at: string | null;
  // ... camera och visibility data
}

export function useSavedViews() {
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchViews = async () => {
      const { data, error } = await supabase
        .from('saved_views')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setSavedViews(data);
      }
      setIsLoading(false);
    };

    fetchViews();
  }, []);

  return { savedViews, isLoading, refetch: fetchViews };
}
```

### Del 2: Uppdatera HomeLanding med "My Views" sektion

Lägga till ny Card-sektion under "My Favorites":

```typescript
// I HomeLanding.tsx

// Ny import
import { useSavedViews } from '@/hooks/useSavedViews';
import { Camera, Eye } from 'lucide-react';

// I komponenten
const { savedViews, isLoading: isLoadingViews } = useSavedViews();

// Navigering till 3D viewer med vy
const handleViewClick = (view: SavedView) => {
  // Navigera till 3D viewer och ladda vyn
  navigate(`/viewer?viewId=${view.id}`);
};
```

### Del 3: UI för "My Views" sektion

```text
┌────────────────────────────────────────────────────────┐
│  My Favorites                                          │
│  Quick access to your most used buildings              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│  │ 📷      │ │ 📷      │ │ 📷      │  ← Favoriter     │
│  │ Kv A    │ │ Kv B    │ │ Kv C    │                  │
│  └─────────┘ └─────────┘ └─────────┘                  │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  My Views                                              │
│  Your saved 3D views                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│  │ 📸 Prev │ │ 📸 Prev │ │ 📸 Prev │  ← Sparade vyer  │
│  │ Plan 3  │ │ Brandsk │ │ Entré   │                  │
│  │ Kv A    │ │ Kv B    │ │ Kv A    │                  │
│  │ 3D      │ │ 2D      │ │ 3D      │                  │
│  └─────────┘ └─────────┘ └─────────┘                  │
└────────────────────────────────────────────────────────┘
```

Vykortet visar:
- Screenshot som förhandsvisning (eller placeholder-ikon)
- Vyns namn
- Byggnadsnamn (subtitle)
- Badge för 2D/3D läge

---

## Filer som skapas/ändras

| Fil | Ändring |
|-----|---------|
| `src/hooks/useSavedViews.ts` | **NY** - Hook för att hämta sparade vyer |
| `src/components/home/HomeLanding.tsx` | Lägg till "My Views" sektion |

---

## Tekniska detaljer

### Navigering till sparad vy

När användaren klickar på en vy navigeras till `/viewer?viewId=<id>`. ViewerPage behöver då läsa query-parametern och ladda vyn automatiskt.

Alternativt kan vi lagra view-id i context och låta BuildingSelector/AssetPlusViewer hantera laddningen.

### Tom-state

Om inga sparade vyer finns visas en förklarande text med instruktioner:
- "Inga sparade vyer"
- "Öppna 3D-visaren och klicka på kamera-ikonen för att spara en vy"

---

## Testning

1. **Skapa några sparade vyer** → Öppna 3D, spara vyer med screenshots
2. **Gå till startsidan** → "My Views" ska visas under "My Favorites"
3. **Klicka på en vy** → Ska navigera till 3D-viewer och ladda vyn
4. **Ingen vy finns** → Ska visa tom-state med instruktioner
