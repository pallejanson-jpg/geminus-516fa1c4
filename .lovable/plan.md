

## Visa alla appar i mobilmenyn

### Problem
Mobilmenyn (`MobileNav`) har en **hårdkodad** lista med bara 8 knappar och tar bara 1 app från `DEFAULT_APP_CONFIGS`. Sidomenyn (`LeftSidebar`) visar alla 9 appar dynamiskt via `sidebarOrder`. Appar som Felanmälan, Insights, FMA+, Asset+, IoT+, OA+ och 360+ saknas helt i mobilmenyn.

### Losning
Skriv om `MobileNav` sa att den anvander samma dynamiska `sidebarOrder` och `SIDEBAR_ITEM_META` som `LeftSidebar`. Alla appar visas i ett scrollbart grid med avdelare pa samma stallen som i sidomenyn.

### Andringar

**`src/components/layout/MobileNav.tsx`**
- Ta bort alla hardkodade knappar (Home, Portfolio, Navigator, Map, 3D Viewer, Inventering, AI Skanning, etc.)
- Importera `getSidebarOrder` fran `AppMenuSettings` och `SIDEBAR_ITEM_META` (eller definiera en lokal kopia)
- Rendera dynamiskt:
  1. **Rad 1 (alltid synlig):** Home, Portfolio, Navigator, Map -- dessa ar "core navigation" som inte ar appar i sidomenyn
  2. **Rad 2:** 3D Viewer-knapp (navigerar till `/viewer`)
  3. **Avdelare**
  4. **Alla appar fran `sidebarOrder`:** renderas i ett `grid-cols-4` grid med samma ikoner, farger och etiketter som sidomenyn. Avdelare renderas dar `hasDividerAfter === true`
- Gor panelen scrollbar (`overflow-y-auto`, `max-h-[70dvh]`) sa att alla appar syns aven pa sma skarmar
- Behall samma glasmorfism-stil, slide-up-animation och tap-outside-to-close

### Resultat
- Alla 9 appar + core navigation syns i mobilmenyn
- Ordningen foljer `sidebarOrder` (samma som desktop-sidomenyn)
- Avdelare visas pa samma stallen
- Scrollbart om innehallet ar for langt for skarmen

### Tekniska detaljer

Strukturen i den nya MobileNav:

```text
+----------------------------------+
|                        [X]       |
+----------------------------------+
| Home  | Portfolio | Nav  | Map   |   <- Core navigation (alltid)
+----------------------------------+
| 3D Viewer                        |   <- Snabblank
+------ avdelare ------------------+
| Inventering | AI Scan | Felanm.  | Insights |   <- Fran sidebarOrder
+------ avdelare (om hasDividerAfter) --------+
| FMA+  | Asset+ | IoT+ | OA+     |
| 360+  |        |       |        |
+----------------------------------+
```

- Importera `getSidebarOrder`, `SIDEBAR_ITEM_META`-mappningen, och lyssna pa `SIDEBAR_SETTINGS_CHANGED_EVENT` for live-uppdateringar
- Anvand `handleItemClick` fran LeftSidebar for att hantera bade `internal` och `config` (external/internal openMode) appar korrekt
- Max-hojd `max-h-[70dvh]` med `overflow-y-auto` for scrollning pa sma skarmar

