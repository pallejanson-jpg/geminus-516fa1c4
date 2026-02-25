


## Plan: Fix Småviken 3D Loading, 2D Stability, and Issue Visibility — ✅ IMPLEMENTED

### Changes Applied

#### A. ✅ Fix `additionalDefaultPredicate` matching (AssetPlusViewer.tsx)
- Whitelist now includes `model_id`, `file_name`, stripped `.xkt`, and all lowercased variants
- Predicate normalizes incoming modelId (lowercase + strip .xkt)
- Diagnostic logging for first 8 predicate calls
- Cache interceptor also uses normalized matching

#### B. ✅ Fix 2D mode stability (UnifiedViewer.tsx)
- SDK-fail effect now only forces 3D for `vt`, `split`, `360` modes
- 2D mode is no longer affected

#### C. ✅ Separate marker containers (AssetPlusViewer.tsx)
- Issues use dedicated `#issue-markers-container` with own manager
- Sensors use dedicated `#sensor-markers-container` with own manager
- Local annotations only clear their own `#local-annotations-container`
- No cross-deletion between marker types

#### D. ✅ Issues default OFF with lazy-load (AssetPlusViewer.tsx)
- Removed auto-load of issues from `handleAllModelsLoaded`
- ISSUE_ANNOTATIONS_TOGGLE_EVENT handler does lazy-load on first enable
- issueAnnotationsLoadedRef tracks load state
