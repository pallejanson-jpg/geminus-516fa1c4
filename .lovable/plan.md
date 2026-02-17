

## Plan: Kopiera web-ifc WASM-filer till public/lib/xeokit/

WASM-filerna som behövs för IFC-till-XKT-konverteringen finns redan installerade i projektet under `node_modules/web-ifc/`. De behöver kopieras till `public/lib/xeokit/` så att browsern kan ladda dem vid runtime.

### Vad som görs

Tre filer kopieras från `node_modules/web-ifc/` till `public/lib/xeokit/`:

| Fil | Syfte |
|-----|-------|
| `web-ifc.wasm` | Huvudmodulen - parser för IFC-filer |
| `web-ifc-mt.wasm` | Multi-threaded variant (används om browsern stödjer SharedArrayBuffer) |
| `web-ifc-mt.worker.js` | Worker-fil för multi-threaded läge |

Koden i `acc-xkt-converter.ts` refererar redan till `wasmPath: '/lib/xeokit/'`, så inga kodändringar behövs - bara filerna på plats.

### Teknisk detalj

Filerna läses från `node_modules/web-ifc/` och skrivs till `public/lib/xeokit/`. Dessa är binärfiler (WASM) respektive en JavaScript worker-fil. Efter detta steg ska IFC-till-XKT-konverteringen fungera i browsern.

### Risker

- WASM-filerna är relativt stora (ca 3-5 MB). Detta påverkar inte sidladdning eftersom de bara laddas on-demand vid IFC-konvertering.
- `web-ifc` är markerad som "alpha" av xeokit-teamet - vissa komplexa IFC-modeller kan ge problem. Men för standard Revit-export via Autodesk bör det fungera.

