# Nomen Frontend

Vite + React SPA with Supabase auth.

## Local Development

```bash
npm install
npm run dev
```

Set environment variables in `frontend/.env`:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Build (Single-File Output)

```bash
npm run build:single
```

The single-page HTML is written to `frontend/dist/index.html`.
