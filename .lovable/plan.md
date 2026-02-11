

# Fix: `moveToImageId is not a function`

## Rotorsak

Felet `api.moveToImageId is not a function` beror pa att SDK:ns `getApi()` returnerar ett `ApiInterface`-objekt dar `moveToImageId` INTE finns direkt. Metoden finns pa `api.legacyApi` (av typen `IvionInterface`).

```text
ApiInterface (det som getApi() returnerar):
  .about
  .dataset
  .image
  .legacyApi  <-- HAR har moveToImageId(), moveToImage(), etc.
  .view
  .site
  ...

Nuvarande kod (rad 386):
  (api as any).moveToImageId(img.id)  --> TypeError: not a function

Korrekt:
  (api as any).legacyApi.moveToImageId(img.id)
```

## Atgard

### Fil: `src/components/ai-scan/BrowserScanRunner.tsx`

En enkel fix pa rad 386 -- andra fran:
```typescript
await (api as any).moveToImageId(img.id, undefined, undefined);
```
till:
```typescript
await (api as any).legacyApi.moveToImageId(img.id, undefined, undefined);
```

Ingen annan fil behover andras. Detta ar en one-line fix som loser alla 11 navigeringsfel.

