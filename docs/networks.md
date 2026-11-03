# Connecting networks

Every OAuth network needs a developer app with your **redirect URI**:

```
https://<TS_HOSTNAME>.<tailnet>.ts.net/api/connect/<network>/callback
```

The Accounts page shows the exact URI under each network. Redirects happen
in your browser, so a tailnet-only host works. Put each app's keys in `.env`
as `<NETWORK>_CLIENT_ID` and `<NETWORK>_CLIENT_SECRET`, then run
`docker compose up -d` to restart.

API facts below were checked against official docs on 2026-11-03.

## Facebook Pages

1. On developers.facebook.com, create an app with the use case **Manage
   everything on your Page**. Keep it in **Development** mode: as the app
   admin you can use it without App Review.
2. Under Facebook Login → Settings, add the redirect URI. Under App Domains
   use the full host (`posty.<tailnet>.ts.net`), never just `ts.net`.
3. `.env`: `FACEBOOK_CLIENT_ID` = App ID, `FACEBOOK_CLIENT_SECRET` = App
   secret.
4. Connect, and grant the Pages you want. Each Page becomes its own account
   with a token that doesn't expire.

Notes:

- Scopes: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`,
  `pages_manage_engagement`, `business_management`, `read_insights`.
- Limit: 30 API-published Reels per Page per day.

## Instagram

Posty uses **Instagram API with Instagram Login**, so no Facebook Page is
needed.

1. The account must be **Business** or **Creator**.
2. Create a Meta app (use case **Other**, type **Business**) and add the
   **Instagram** product. Under *API setup with Instagram login* → Business
   login settings, add the redirect URI.
3. Under App roles, add your account as an **Instagram Tester**, then accept
   the invite in the Instagram app (Settings → Apps and websites → Tester
   invites).
4. `.env`: `INSTAGRAM_CLIENT_ID` and `INSTAGRAM_CLIENT_SECRET` must be the
   **Instagram** app ID and secret, which differ from the Meta app ID.

Notes:

- Images are fetched from `PUBLIC_MEDIA_URL`, so Funnel must work. Posty
  converts images to JPEG.
- Feed images must be between 4:5 and 1.91:1.
- Tokens last 60 days; the worker extends them weekly.
- **First test:** publish one image post early. Nobody has confirmed that
  Meta fetches media from port 8443. If it doesn't, run a second Tailscale
  node (for example `posty-media`) with Funnel on 443 serving only
  `/media/`, and point `PUBLIC_MEDIA_URL` at it.

## Threads

1. Create a **separate** Meta app with the use case **Access the Threads
   API**. Add the redirect URI under Settings.
2. Under App roles, add your profile as a **Threads Tester** and accept it
   in Threads (Settings → Account → Website permissions → Invites).
3. `.env`: `THREADS_CLIENT_ID` and `THREADS_CLIENT_SECRET`, the Threads app
   ID and secret from the use case settings.

Notes:

- Limits: 500 characters, at most 5 links, 250 posts per day.
- Tokens are extended weekly.

## X

1. In the developer console (console.x.com), create an app with **OAuth
   2.0**, type **Web App** (confidential client), and add the redirect URI.
2. Buy API credits. X is pay-per-use: about $0.015 per post and **$0.20 per
   post containing a link**. The composer warns about links.
3. `.env`: `X_CLIENT_ID` and `X_CLIENT_SECRET` are the OAuth 2.0 client ID
   and secret, not the API key.

Notes:

- Scopes: `tweet.read tweet.write users.read media.write offline.access`.
- Threads (self-replies) work. Replying to other people is restricted on
  self-serve tiers.
- Metrics reads are billed too, so they stay off unless `X_METRICS=1`.

## LinkedIn

1. Create an app at linkedin.com/developers. It must be linked to a
   LinkedIn Company Page; a placeholder Page works.
2. Under Products, add **Sign In with LinkedIn using OpenID Connect** and
   **Share on LinkedIn**.
3. Under Auth, add the redirect URI.
4. `.env`: `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.

Notes:

- Posts go to your **personal profile**. Company Pages and analytics need
  the Community Management API, which LinkedIn only grants to registered
  organizations.
- Tokens last 60 days and **can't be refreshed** by personal apps. Reconnect
  when the banner appears; it's usually one click.
- First comments may return 403 depending on the scopes LinkedIn grants.
  The post itself is still published.

## Pinterest

1. Use a **Business** account (converting is free). Create an app at
   developers.pinterest.com and add the redirect URI.
2. `.env`: `PINTEREST_CLIENT_ID` and `PINTEREST_CLIENT_SECRET`.

Notes:

- **Trial access**: pins are visible only to you, and video pins fail.
  Trial apps may need `PINTEREST_API_BASE=https://api-sandbox.pinterest.com/v5`.
  This path is untested.
- **Standard access**: you have to record a demo video, and the app needs a
  public privacy-policy URL. Your tailnet host isn't public, so host the
  policy somewhere else (for example a GitHub Pages site).
- After connecting, pick a board in the composer's Pinterest tab. Use
  **Refresh** on the Accounts page to reload boards.

## YouTube

1. In Google Cloud Console, create a project and enable **YouTube Data API
   v3**.
2. On the OAuth consent screen, add yourself and set the publishing status
   to **In production**. In "Testing", refresh tokens expire after 7 days
   and scheduled uploads start failing. The "unverified app" warning is
   fine for personal use.
3. Create an OAuth client of type **Web application** with the redirect
   URI.
4. `.env`: `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.

Notes:

- Limit: 100 uploads per day.
- Since 2026-11-02, uploads from unverified projects are no longer locked to
  private. Check your first upload's visibility.
- Vertical videos of 3 minutes or less become Shorts automatically.

## TikTok

1. Create an app at developers.tiktok.com with **Login Kit** and **Content
   Posting API** (scopes `user.info.basic`, `user.info.profile`,
   `video.upload`, `video.publish`). Add the redirect URI.
2. `.env`: `TIKTOK_CLIENT_ID` is the client key, `TIKTOK_CLIENT_SECRET` the
   client secret.

Notes:

- TikTok's audit excludes personal-use apps. Without an audit:
  - **Inbox mode** (the default) sends the video to your TikTok inbox, and
    you publish it from the app with any visibility.
  - **Direct mode** only posts as "Only me", and your account must be
    private.
- Photo posts aren't supported: they need a TikTok-verified domain.

## Bluesky

No developer app is needed. In Bluesky, go to Settings → Privacy and
security → **App passwords**, create one, and enter it with your handle on
the Accounts page. For a self-hosted PDS, fill in its URL.

## Mastodon

No keys are needed. Enter your instance (for example `mastodon.social`) on
the Accounts page. Posty registers itself with that instance and redirects
you to authorize.

Notes:

- Character and media limits are read from your instance.
- Retries use an `Idempotency-Key`, so they can never double-post.
