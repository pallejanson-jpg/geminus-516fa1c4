

## Problem

Du är på startsidan (`/index`) när du chattar med Gunnar. När AI:n returnerar viewer-kommandon (highlight, colorize, filter) dispatchar den events som `AI_VIEWER_COMMAND` och `AI_VIEWER_FOCUS_EVENT` — men dessa events lyssnas bara på av 3D-viewern (`NativeViewerShell`). Eftersom viewern inte är laddad på startsidan, händer ingenting visuellt. Toasten "Visar sensordata för 50 objekt" visas, men det finns ingen viewer att visa det i.

## Lösning: Auto-navigera till viewern vid viewer-actions

När AI:n returnerar en viewer-action (highlight/filter/colorize) och användaren **inte redan är i viewern**, ska appen automatiskt navigera till viewern med rätt byggnad och spara viewer-kommandot så det kan tillämpas när viewern är redo.

### Ändringar

#### 1. `src/components/chat/GunnarChat.tsx` — Navigera till viewer vid behov
- I `executeViewerAction`: kontrollera om `window.location.pathname` redan är `/viewer`
- Om inte:
  - Spara viewer-kommandot i `sessionStorage` (t.ex. `pending_ai_viewer_command`)
  - Använda `window.location.href` eller React Router för att navigera till `/viewer?building={buildingFmGuid}` (hämta byggnads-GUID från chattkontexten)
  - Visa toast: "Öppnar 3D-viewern..."
- Om redan i viewern: kör som vanligt (dispatch event direkt)

#### 2. `src/components/viewer/NativeViewerShell.tsx` — Läs sparade kommandon vid uppstart
- I `handleViewerReady` (redan befintlig callback):
  - Kolla `sessionStorage.getItem('pending_ai_viewer_command')`
  - Om det finns: parsa JSON och dispatcha `AI_VIEWER_COMMAND` efter en kort fördröjning (vänta på att modellen laddat)
  - Ta bort från sessionStorage efter dispatch

#### 3. `src/components/chat/GunnarButton.tsx` — Sluta minimera chatten
- Ta bort/ändra raden som auto-minimerar chatten vid `AI_VIEWER_FOCUS_EVENT` på mobil (rad 97-108)
- Alternativ: minimera bara om viewern faktiskt är synlig (kolla pathname)

### Filer
- **Edit:** `src/components/chat/GunnarChat.tsx`
- **Edit:** `src/components/viewer/NativeViewerShell.tsx`
- **Edit:** `src/components/chat/GunnarButton.tsx`

