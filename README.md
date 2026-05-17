# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

## Running locally on your own Node server

The app is a Vite + React SPA. The backend (database, auth, edge functions) lives in Lovable Cloud and is reached via `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`.

### 1. Dev server

```sh
bun install        # or: npm install
bun run dev        # http://localhost:5173
```

`.env` (project root):

```
VITE_SUPABASE_URL=https://diqfthpfncdojlnqnicq.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key>
VITE_SUPABASE_PROJECT_ID=diqfthpfncdojlnqnicq
```

### 2. Production build served by Node

```sh
bun run build              # outputs /dist
npx serve dist -l 3000     # or your own Express static server
```

Make sure your server falls back to `index.html` for unknown routes (SPA routing).

### 3. Google login when running locally

Google sign-in now uses Supabase's OAuth provider directly (not the Lovable-managed broker), so `http://localhost` works once configured:

1. **Google Cloud Console** → create OAuth Client (Web). Authorized redirect URIs:
   - `https://diqfthpfncdojlnqnicq.supabase.co/auth/v1/callback`
   - `http://localhost:5173` (and any other local origin you use)
2. **Lovable Cloud → Users → Auth Settings → Google**: paste Client ID + Client Secret (this disables the managed Google credentials in favor of yours).
3. **Auth Settings → URL Configuration**: add `http://localhost:5173` to Site URL / Additional Redirect URLs.
4. If sign-in misbehaves locally, unregister the service worker (DevTools → Application → Service Workers) — it can cache stale OAuth responses.

No secrets need to be copied to your local machine; all `*_API_KEY` / `*_PASSWORD` values stay as edge-function secrets in Lovable Cloud.

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
