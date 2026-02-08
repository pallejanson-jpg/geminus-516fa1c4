
# Fix 3D Viewer: Wrong Parameter Order in assetplusviewer() Call

## Root Cause

The `assetplusviewer()` initialization call in `AssetPlusViewer.tsx` passes parameters in the **wrong order** starting from position 9.

The official API signature (from `docs/3D_viewer_package.md`):

```text
assetplusviewer(
  1. baseUrl,                              // String
  2. apiKey,                               // String
  3. getAccessTokenCallback,               // Function
  4. selectionChangedCallback,             // Function
  5. selectedFmGuidsChangedCallback,       // Function
  6. allModelsLoadedCallback,              // Function
  7. isItemIdEditableCallback,             // Function (or undefined)
  8. isFmGuidEditableCallback,             // Function
  9. additionalDefaultPredicate,           // Function - DECIDES WHICH MODELS TO LOAD
  10. externalCustomObjectContextMenuItems, // Array (or undefined)
  11. horizontalAngle,                     // Number (or undefined)
  12. verticalAngle,                       // Number (or undefined)
  13. annotationTopOffset,                 // Number (or undefined)
  14. annotationLeftOffset                 // Number (or undefined)
)
```

What our code currently passes (lines 2525-2583):

```text
  1. baseUrl                               -- correct
  2. apiKey                                 -- correct
  3. getAccessTokenCallback                 -- correct
  4. selectionChangedCallback               -- correct
  5. selectedFmGuidsChangedCallback         -- correct
  6. handleAllModelsLoaded                  -- correct
  7. undefined (isItemIdEditableCallback)   -- correct
  8. isFmGuidEditableCallback               -- correct
  9. defaultHeightAboveAABB (NUMBER!)       -- WRONG: expects model filter FUNCTION
  10. defaultMinimumHeightAboveBase (NUMBER) -- WRONG: expects context menu items ARRAY
  11. lookAtSpaceAndInstanceFlyToDuration    -- mapped to horizontalAngle (unrelated)
  12. document.getElementById(...)           -- WRONG: expects verticalAngle NUMBER
```

Parameter 9 (`additionalDefaultPredicate`) is the critical one. The Asset+ docs say: "Allows custom logic to determine which additional models should be loaded into the viewer." When a non-function value (a number) is passed, the viewer's internal model loading logic likely treats it as falsy/invalid and loads **no models at all**.

The official example uses: `(model) => (model?.name || "").toLowerCase().startsWith("a")` -- loading all models whose name starts with "a". A common pattern to load ALL models is `() => true`.

## Fix

Correct the parameter order in the `assetplusviewer()` call, and remove the `targetElement` parameter (which does not exist in the API -- the viewer always mounts to `#AssetPlusViewer`).

### Changes to `src/components/viewer/AssetPlusViewer.tsx`:

At the viewer initialization call (around line 2525-2583), change parameters 9-12 from:

```text
defaultHeightAboveAABB,
defaultMinimumHeightAboveBase,
lookAtSpaceAndInstanceFlyToDuration,
document.getElementById('AssetPlusViewer'),
```

To:

```text
undefined,    // additionalDefaultPredicate -- undefined = load all models (default behavior)
undefined,    // externalCustomObjectContextMenuItems
undefined,    // horizontalAngle (use default)
undefined,    // verticalAngle (use default)
```

The `defaultHeightAboveAABB`, `defaultMinimumHeightAboveBase`, and `lookAtSpaceAndInstanceFlyToDuration` values are not part of the `assetplusviewer()` constructor. If they are needed, they should be applied after initialization using the viewer's API methods (e.g., `viewer.setViewerAngles()`).

The `document.getElementById('AssetPlusViewer')` target element is also not a parameter -- the Asset+ library always mounts to the DOM element with id `AssetPlusViewer`.

### File Summary

| File | Changes |
|---|---|
| `src/components/viewer/AssetPlusViewer.tsx` | Fix parameters 9-12 of `assetplusviewer()` call to match the official API signature |

### Risk Assessment

Low risk -- this aligns the code with the documented API. The current parameter mismatch is clearly the cause of "viewer starts but nothing loads" since the model filter function receives a number instead of a callable predicate.
