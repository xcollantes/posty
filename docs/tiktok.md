# Connecting TikTok

Posty sends videos to TikTok through a developer app that you own.

**Before you start:** TikTok audits apps before they can post publicly, and
it doesn't audit personal-use apps. So Posty has two modes:

- **Inbox** (the default): the video lands in your TikTok inbox. Open the
  TikTok app, finish the post and publish it with any visibility.
- **Direct**: Posty publishes the video itself, but only as **Only me**, and
  your TikTok account must be private.

Photo posts aren't supported: they need a domain verified with TikTok.

## 1. Create the app

1. Sign in at [TikTok for Developers](https://developers.tiktok.com/apps/)
   with your TikTok account and create a new app, for example `Posty`.
2. Add two products: **Login Kit** and **Content Posting API**.
3. Under **Scopes**, make sure these are added: `user.info.basic`,
   `user.info.profile`, `video.upload` and `video.publish`.

## 2. Add the redirect URI

In the **Login Kit** settings, add the URI from Posty's Accounts page
(TikTok card → **Redirect URI**) under **Redirect URI** for **Web**:

```
https://posty.<your-tailnet>.ts.net/api/connect/tiktok/callback
```

## 3. Copy the credentials into Posty

1. On the app's page, copy the **Client key** and **Client secret**.
2. Add them to `.env` and restart with `docker compose up -d`:

   ```
   TIKTOK_CLIENT_ID=<Client key>
   TIKTOK_CLIENT_SECRET=<Client secret>
   ```

## 4. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the TikTok card.
2. Sign in to TikTok and allow access.
3. Schedule a short test video. In the composer's TikTok tab, keep
   **Mode** on **Send to TikTok inbox (finish in app)**.
4. When it's sent, open the TikTok app, find the video in your inbox, and
   post it.

## Limits

- Every post needs a video. Captions up to 2,200 characters.
- Direct mode only posts as **Only me** until the app passes TikTok's
  audit.
- Tokens are renewed by the worker in the background.

## Troubleshooting

- **TikTok rejects the redirect URI**: copy it again from the Accounts page
  (step 2).
- **A scope error when connecting**: add the missing scope (step 1).
- **Direct posts fail**: make your TikTok account private, or switch the
  post to inbox mode.
