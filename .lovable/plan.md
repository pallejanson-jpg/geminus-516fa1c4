

# Geminus AI & Panel — Absolut ingen navigation ut ur standalone

## Problem

I `executeAction` i `GunnarChat.tsx` finns flera actions som inte fångas av `isStandaloneAi`-checken:

- **`selectInTree`**: Anropar `setActiveApp('navigator')` + `closeAfterAction()` — i standalone PWA leder detta till en trasig vy (navigator finns inte)
- **`showFloor`**, **`highlight`**, **`flyTo`**, **`switchTo2D`**, **`switchTo3D`**: Dispatchar events som ingen lyssnar på — inget händer, men bör ge feedback
- **`selectBuilding`**: Anropar `setSelectedFacility` (AppContext) — fungerar i huvudappen men inte i standalone

Dessutom: i **plugin-standalone-läge** (`/plugin` som PWA) sätts `isEmbeddedPanel = true`, men `setViewer3dFmGuid` + events har ingen mottagare → viewer-actions misslyckas tyst.

## Åtgärd

### 1. Bredda standalone-skyddet i `GunnarChat.tsx`

Skapa en ny flag: `isStandaloneContext` som är `true` för BÅDE `/ai` standalone OCH `/plugin` standalone (utan viewer):

```typescript
const isStandalonePlugin = !!embedded && !!context?.contextMetadata?.standalone;
const isStandaloneContext = isStandaloneAi || isStandalonePlugin;
```

I `executeAction`, lägg till `isStandaloneContext`-check för ALLA actions som kräver viewer eller full app:

| Action | Standalone-beteende |
|--------|-------------------|
| `selectInTree` | Toast: "Den här funktionen finns i Geminus-appen" |
| `showFloor` | Toast |
| `highlight` | Toast |
| `flyTo` | Toast |
| `switchTo2D/3D` | Toast |
| `openViewer` | Toast (redan implementerat) |
| `showFloorIn3D` | Toast |
| `isolateModel` | Toast |
| `showDrawing` | Toast |
| `openViewer3D` | Toast |
| `selectBuilding` | Fungerar — uppdaterar kontext lokalt (ingen navigation) |

### 2. Skicka `standalone`-flagga från `GeminusPluginMenu.tsx`

`gunnarContext` ska inkludera `contextMetadata.standalone` från PluginPage:

```typescript
const gunnarContext: GunnarContext = {
  activeApp: ...,
  currentBuilding: ...,
  contextMetadata: { standalone: contextMetadata?.standalone },
};
```

### 3. `selectBuilding` i standalone

Istället för `setSelectedFacility` (AppContext som inte fungerar fullt i standalone), uppdatera kontexten lokalt genom att skicka ett meddelande till chatten direkt — detta fungerar redan via `sendMessage`.

## Filer att ändra

| Fil | Ändring |
|-----|---------|
| `src/components/chat/GunnarChat.tsx` | Ny `isStandaloneContext`-flag, toast-skydd på ALLA viewer/app-actions |
| `src/components/viewer/GeminusPluginMenu.tsx` | Skicka `standalone`-flagga i `gunnarContext.contextMetadata` |

## Resultat

- **`/ai` som PWA**: Alla actions som kräver viewer → toast. Aldrig navigation. Aldrig Safari.
- **`/plugin` som PWA**: Samma skydd. Aldrig navigation ut.
- **Panel inbäddad i huvudappen**: `standalone` är `false` → viewer-actions fungerar som vanligt via events.

