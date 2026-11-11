# DomBase

Shared workforce scheduling, team management and time tracking with React,
TypeScript, vinext/Vite, Cloudflare Workers, D1, R2 and Drizzle.

## Local development

Requires Node >=22.13 and pnpm.

```sh
pnpm install
pnpm run db:migrate:local
pnpm run auth:configure:local
pnpm dev
```

Owner/manager dashboards use email and password. Employee clock-in uses a
separately registered kiosk and employee PIN. There is no shared default login.
Initial setup links are issued privately and recipients choose their passwords.

Optional fictional local demo:

```sh
pnpm run demo:seed:local -- --week YYYY-MM-DD
```

Choose a Monday; seeding refuses existing workforce data and never resets edits.
Local and hosted databases are separate. Deploying code does not upload local data.

## Checks

```sh
pnpm test
pnpm lint
```

The test command builds the app and runs isolated native D1/R2 and HTTP checks.
Repository-wide lint/types may require additional platform declarations; use the
actual command results when assessing a change.

## Hosted configuration

Copy `wrangler.staging.example.jsonc` to the ignored `wrangler.staging.jsonc`
and configure your own account/database bindings. Keep actual deployment IDs,
Owner identities, secrets and operational notes private. Initial Owner tooling
reads a private email-to-display-name JSON object from
`.wrangler/secrets/staging-owners.json` or `DOMBASE_STAGING_OWNERS`.
No real deployment identity is included in the public source.

After configuring your account and private resources:

```sh
pnpm run build:staging
pnpm run staging:deploy
```

Use separate development/staging secrets. Never commit environment files, setup
links, passwords, employee PINs, database exports, recovery keys or runtime state.
Daily hosted backup automation, real invitation delivery, hardware acceptance
and independent release approval must be configured and verified separately.
