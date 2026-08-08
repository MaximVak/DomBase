# DomBase

DomBase is a mobile-friendly household command center for tasks, schedules,
members, pinned notes, inventory, and shared spending.

## Run Locally

Install dependencies once:

```bash
npm install
```

Start the local development website:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

Build-check the app:

```bash
npm run build
```

Run smoke tests:

```bash
npm test
```

## Local-First Hosting Plan

For now, DomBase is meant to run from your machine. Keep using
`http://127.0.0.1:5173` while building.

When you are ready for your own domain later, choose a hosting provider such as
Vercel, Netlify, Cloudflare Pages, a VPS, or a home server with a reverse proxy.
Then point your domain DNS to that provider instead of using a ChatGPT Sites URL.

## Project Structure

- `app/page.tsx`: main DomBase app screen and seed data
- `app/globals.css`: responsive layout and visual system
- `app/layout.tsx`: app metadata
- `public/og.png`: DomBase social preview image
- `tests/rendered-html.test.mjs`: server-render smoke tests

