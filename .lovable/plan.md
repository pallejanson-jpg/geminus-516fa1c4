

## Fix: 3D-visaren startar inte pa mobil

### Orsak
Mobilmenyn (MobileNav) navigerar till `/viewer`, som laddar den gamla `Mobile3DViewer`-komponenten. Men hela visararkitekturen har flyttats till `/split-viewer` med `UnifiedViewer`. Den gamla `Mobile3DViewer` anvander `allData` fran `AppContext` direkt -- men `allData` kanske inte ar laddad eller sa saknar den `viewer3dFmGuid`.

UnifiedViewer pa `/split-viewer` hanterar redan mobil korrekt via `useIsMobile()` och har all ny funktionalitet (byggnadsvaljare, mode-switcher, etc.).

### Losning
Andra mobilnavigeringen sa att "3D Viewer"-knappen gar till `/split-viewer?mode=3d` istallet for `/viewer`.

### Andringar

**`src/components/layout/MobileNav.tsx`** (rad 129)

Andra navigeringen fran:
```
navigate('/viewer')
```
till:
```
navigate('/split-viewer?mode=3d')
```

Detta sakerstaller att mobilen anvander samma UnifiedViewer-arkitektur som desktop, i linje med principen om desktop-mobil-paritet.

