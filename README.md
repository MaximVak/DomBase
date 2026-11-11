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


## Automatic hosted backups

The optional private backup Worker uses native D1/R2 bindings and the app's
scheduled event. It saves one completed encrypted backup per Pacific calendar day
after 2AM, retries failed attempts after 15 minutes and retains every completed
backup. It has no public Worker/preview URL, no live restore endpoint and no
platform API token. Database/file data and matching application keys are encrypted
with a fresh AES-GCM key; only a public RSA encryption key is deployed. Keep the
separate private recovery file outside the development machine.

After configuring your private staging account/database and enabling R2:

```sh
pnpm run backup:configure:staging
pnpm run backup:deploy:staging
pnpm run build:staging
pnpm run staging:deploy
pnpm run backup:status:staging
pnpm run backup:verify:staging -- --day YYYY-MM-DD
```

Configuration creates a separate non-public backup bucket and private recovery
file; it refuses to replace a missing recovery key when the bucket already exists.
The app's Owner menu links to `/backups` for success/failure/staleness status.
Managers, employees and registered kiosks cannot view it. Email alerts and automatic
backup deletion are disabled. Keep real configuration/recovery material out of Git.

Verification downloads only the chosen encrypted daily archive, checks its files,
restores into a fresh isolated local database/bucket, verifies exact data/files and
private-field decryption, and invalidates old access only in that restored copy.
It never overwrites the working database or promotes a restored copy. Preserve
application source separately for deliberate incident recovery/cutover.
