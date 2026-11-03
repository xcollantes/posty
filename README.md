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

## How it runs

```
docker compose
├── tailscale  sidecar: :443 → UI (tailnet only), :8443 → /media/ (Funnel)
├── app        Next.js UI + API (shares the sidecar's network)
├── worker     publishes due posts, refreshes tokens, collects metrics
└── db         Postgres (also the job queue, no Redis)
```

Instagram and Threads fetch images by URL, so `/media/` (and nothing else)
is exposed publicly through Tailscale Funnel on port 8443. File names are
random UUIDs, and every other path on :8443 returns 404 from Tailscale itself.

## Setup

1. **Tailscale admin console**
   - Enable **MagicDNS** and **HTTPS certificates** (DNS page).
   - Create an auth key: Settings → Keys → *Generate auth key*. Make it
     reusable and tag it `tag:posty`.
   - Allow the tag and Funnel in the access controls (policy file):

     ```json
     "tagOwners": { "tag:posty": ["autogroup:admin"] },
     "nodeAttrs": [{ "target": ["tag:posty"], "attr": ["funnel"] }]
     ```

2. **Configure**

   ```bash
   cp .env.example .env
   openssl rand -base64 48   # paste as APP_KEY
   ```

   Fill in `APP_URL`, `PUBLIC_MEDIA_URL`, `APP_KEY`, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` and `TS_AUTHKEY`. With
   `TS_HOSTNAME=posty` and the tailnet `tail1234.ts.net`:

   ```
   APP_URL=https://posty.tail1234.ts.net
   PUBLIC_MEDIA_URL=https://posty.tail1234.ts.net:8443
   ```

3. **Start**

   ```bash
   docker compose up -d --build
   ```

   Open `APP_URL` from any device on your tailnet and sign in with the
   admin email and password. Funnel's public DNS can take up to 10 minutes
   to appear.

4. **Connect networks**: create a developer app for each network you want
   (see [docs/networks.md](docs/networks.md)), put its keys in `.env`, run
   `docker compose up -d`, then use **Accounts → Connect**. Bluesky and
   Mastodon need no keys.

5. **Queue**: add weekly time slots on the **Queue** page to use "Add to
   queue".

### Check the Funnel exposure

From a machine **outside** your tailnet:

```bash
curl -I https://posty.tail1234.ts.net:8443/media/<a-file-name>   # 200
curl -I https://posty.tail1234.ts.net:8443/login                 # 404
curl -I https://posty.tail1234.ts.net/                           # no answer
```

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
| `lib/publisher.ts`, `worker.ts` | claim due posts, publish, retry, roll up, sweeps         |
| `lib/accounts.ts`               | token storage (AES-GCM) and locked refresh               |
| `components/composer/`          | the post editor                                          |
| `app/(app)/`                    | pages; `app/actions/` server actions                     |
| `tailscale/serve.json`          | Serve/Funnel config for the sidecar                      |

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
