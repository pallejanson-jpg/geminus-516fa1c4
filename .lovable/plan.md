

# Plan: Set Up PWA for iOS Home Screen Installation

## What This Does
Adds Progressive Web App (PWA) support so the app can be installed directly from Safari on iOS via "Share → Add to Home Screen". No Mac, no Xcode, no App Store needed. The app will launch in full-screen mode with a splash screen and app icon.

## Implementation Steps

### Step 1: Create Web App Manifest
Create `public/manifest.json` with app name, icons, theme color, display mode (`standalone`), and start URL.

### Step 2: Generate PWA Icons
Create appropriately sized icon files (192×192 and 512×512 PNG) in `public/` for Android/PWA, plus Apple touch icon (180×180). We'll generate simple branded icons using the existing favicon as a base or create solid-color icons with the app initials.

### Step 3: Update index.html
Add:
- `<link rel="manifest" href="/manifest.json">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `<meta name="theme-color" content="#0f172a">`
- `<link rel="apple-touch-icon" href="/icon-180.png">`

### Step 4: Register Service Worker
Create `public/sw.js` with a basic cache-first strategy for static assets (CSS, JS, fonts, images) and network-first for API calls. Register it from `src/main.tsx`.

### Step 5: Add Install Prompt (Optional Enhancement)
Add a small banner/button in the app that detects if the app is not yet installed and guides the user to install it (iOS doesn't support `beforeinstallprompt`, so this would be a manual instruction overlay for Safari users).

---

## Technical Notes
- **Service Worker scope**: `/` — caches the app shell for offline launch
- **iOS quirks**: Safari doesn't support all PWA features (no push notifications, no background sync), but standalone mode, icons, and splash screens work well
- **No build plugin needed**: A hand-written `manifest.json` + `sw.js` is sufficient and avoids adding `vite-plugin-pwa` complexity

