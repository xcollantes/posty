# Posty

A self-hosted social media scheduler in the spirit of Buffer and Mixpost. It
publishes to Facebook Pages, Instagram, Threads, X, LinkedIn, Pinterest,
YouTube, TikTok, Bluesky and Mastodon. It runs in Docker and is reachable only
over your Tailscale tailnet.

## Features

- **Composer**: one post to many accounts, with live previews and
  per-network character counters (X weighted counting, Bluesky graphemes).
  - Per-account customization of text and media.
  - Threads for X, Threads, Bluesky and Mastodon.
  - First comment.
  - Bold, italic and monospace through Unicode styling (networks only accept
    plain text), an emoji picker, and hashtag/template snippets.
- **Media**: drag-and-drop upload (images and video up to 1 GB), a media
  library, alt text, and reordering. Media is validated per network (counts,
  types, Instagram aspect ratio, video-only networks).
- **Scheduling**: post now, schedule for a date and time, save drafts, or add
  to a Buffer-style queue of weekly time slots.
- **Calendar**: month, week and day views. Drag a post to reschedule it;
  click an empty slot to write a post for that time.
- **Posts**: Scheduled, Drafts, Published and Failed tabs with search,
  account and tag filters, duplicate, retry and links to live posts.
- **Network options**: Instagram feed/reel/story, Facebook post/reel/story,
  Pinterest board/title/link, YouTube title/visibility, TikTok inbox or
  direct post, Mastodon visibility and content warning.
- **Tags** (colored on the calendar), **analytics** (daily metrics where the
  network allows it), **multiple users**, and **failure notifications**
  through a Slack- or Discord-compatible webhook.
- **MCP endpoint**: let Claude Code draft, schedule and queue posts,
  including from your phone through Remote Control. See
  [Use from Claude](#use-from-claude-mcp).

## How it runs

```
docker compose
├── tailscale  sidecar: :443 → UI (tailnet only)
├── app        Next.js UI + API (shares the sidecar's network)
├── worker     publishes due posts, refreshes tokens, collects metrics
└── db         Postgres (also the job queue, no Redis)
```

Nothing on the host is public. Instagram, Threads and Facebook video fetch
media by URL, so at publish time the worker copies the file to a private
Google Cloud Storage bucket and hands Meta a signed URL that expires after
an hour. A bucket lifecycle rule deletes the copies after a day.

## Setup

1. **Tailscale admin console**
   - Enable **MagicDNS** and **HTTPS certificates** (DNS page).
   - Create an auth key: Settings → Keys → *Generate auth key*. Make it
     reusable and tag it `tag:posty`.
   - Allow the tag in the access controls (policy file):

     ```json
     "tagOwners": { "tag:posty": ["autogroup:admin"] }
     ```

2. **Google Cloud Storage** (only for Instagram, Threads and Facebook
   video; skip it otherwise). With the `gcloud` CLI:

   ```bash
   PROJECT=my-project
   BUCKET=posty-media-$(openssl rand -hex 4)
   SA=posty-media@$PROJECT.iam.gserviceaccount.com

   gcloud storage buckets create gs://$BUCKET --project=$PROJECT \
     --location=us-west1 --uniform-bucket-level-access \
     --public-access-prevention
   echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' \
     > lifecycle.json
   gcloud storage buckets update gs://$BUCKET --lifecycle-file=lifecycle.json

   gcloud iam service-accounts create posty-media --project=$PROJECT
   gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
     --member=serviceAccount:$SA --role=roles/storage.objectAdmin

   mkdir -p secrets
   gcloud iam service-accounts keys create secrets/gcs-key.json \
     --iam-account=$SA
   sudo chown 1000 secrets/gcs-key.json && chmod 600 secrets/gcs-key.json
   ```

   The containers run as uid 1000, so the key must be readable by it. Put
   the bucket name in `GCS_BUCKET`.

3. **Configure**

   ```bash
   cp .env.example .env
   openssl rand -base64 48   # paste as APP_KEY
   ```

   Fill in `APP_URL`, `APP_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `POSTGRES_PASSWORD`, `TS_AUTHKEY` and, from step 2, `GCS_BUCKET`. With
   `TS_HOSTNAME=posty` and the tailnet `tail1234.ts.net`:

   ```
   APP_URL=https://posty.tail1234.ts.net
   ```

4. **Start**

   ```bash
   docker compose up -d --build
   ```

   Open `APP_URL` from any device on your tailnet and sign in with the
   admin email and password.

5. **Connect networks**: create a developer app for each network you want
   (see [docs/networks.md](docs/networks.md)), put its keys in `.env`, run
   `docker compose up -d`, then use **Accounts → Connect**. Bluesky and
   Mastodon need no keys.

6. **Queue**: add weekly time slots on the **Queue** page to use "Add to
   queue".

### Check nothing is public

From a machine **outside** your tailnet, `curl -I
https://posty.tail1234.ts.net/` gets no answer. After an Instagram post,
the worker log shows the upload; the plain object URL
`https://storage.googleapis.com/<bucket>/<file>` returns 403.

## Use from Claude (MCP)

Posty serves an [MCP](https://modelcontextprotocol.io) endpoint at
`/api/mcp`, so Claude Code (or any MCP client on your tailnet) can list
accounts, media and posts, and save drafts, scheduled posts and queued
posts. It can't post immediately, delete or retry; use the UI for those.
Posts are made as the `ADMIN_EMAIL` user.

1. Put a token in `.env`, then run `docker compose up -d`:

   ```bash
   openssl rand -base64 32   # paste as MCP_TOKEN
   ```

2. On a machine on your tailnet, add the server to Claude Code:

   ```bash
   claude mcp add --transport http --scope user posty \
     https://posty.tail1234.ts.net/api/mcp \
     --header "Authorization: Bearer <MCP_TOKEN>"
   ```

3. **From your phone**: on that machine, run `claude remote-control` (or
   set `"remoteControlAtStartup": true` in `~/.claude/settings.json`). In
   the Claude app, open **Code**, pick the session and ask, for example,
   "queue a Bluesky post saying …". Claude runs on your machine, so it
   reaches posty over the tailnet. The machine has to stay awake.

Custom connectors in the Claude chat app and Claude Code cloud sessions
connect from Anthropic's servers, which aren't on your tailnet, so they
can't reach posty.

## Operations

- **Backups**: the `pgdata` volume holds the database and the `media`
  volume holds uploads. Back up both. `APP_KEY` decrypts the stored tokens,
  so keep it with the backups.
- **Logs**: `docker compose logs -f worker` shows every publish attempt.
- **Failures**: a post that fails is never re-posted blindly. Only errors
  that happen before anything goes live (429/5xx) are retried, at most 3
  times. A worker crash mid-publish marks the post *failed* so you can check
  the network before retrying. A post that comes due more than an hour
  while the worker is down is marked *failed* instead of going out late;
  use Retry to send it.
- **Tokens**: the worker refreshes Instagram, Threads, Pinterest, X and
  TikTok tokens in the background. LinkedIn tokens can't be refreshed by
  personal apps, so a banner asks you to reconnect every 60 days.

## Development

```bash
docker compose -f compose.dev.yml up -d      # Postgres on localhost:5432
cp .env.example .env                         # set APP_URL=http://localhost:3000,
                                             # DATABASE_URL, MEDIA_DIR=./data/media
npm install
npm run db:migrate                           # migrations + first admin
npm run dev                                  # UI on :3000
npm run worker                               # publisher (separate terminal)
npm test                                     # unit + DB integration tests
npm run typecheck && npm run lint
```

After editing `lib/db/schema.ts`, run `npm run db:generate` to create a
migration.

### Layout

| Path                            | What                                                     |
|---------------------------------|----------------------------------------------------------|
| `lib/networks/catalog.ts`       | client-safe limits, counters, composer options           |
| `lib/networks/<id>.ts`          | one file per network: connect, publish, refresh, metrics |
| `lib/gcs.ts`                    | signed GCS URLs for media Meta fetches by URL            |
| `lib/publisher.ts`, `worker.ts` | claim due posts, publish, retry, roll up, sweeps         |
| `lib/accounts.ts`               | token storage (AES-GCM) and locked refresh               |
| `lib/posts.ts`                  | save a post (shared by the composer and MCP)             |
| `lib/mcp.ts`, `app/api/mcp/`    | MCP tools and endpoint for LLM clients                   |
| `components/composer/`          | the post editor                                          |
| `app/(app)/`                    | pages; `app/actions/` server actions                     |
| `tailscale/serve.json`          | Serve config for the sidecar                             |

## Known limits

- **X** API access is pay-per-use, and posts containing links cost more.
- **LinkedIn** posts to your personal profile only. Company Pages need the
  Community Management API, which is only granted to organizations.
- **TikTok** won't audit a personal-use app, so direct posts stay private.
  Use inbox mode and finish the post in the TikTok app.
- **Pinterest** pins are visible only to you until the app gets Standard
  access.
- **Video** isn't transcoded. Upload files that already meet each network's
  specs.
- **Untested against live APIs**: the network code follows each network's
  docs (checked 2026-11-03) and is covered by mocked tests. Test each
  network with a real account before relying on it.
