# Connecting networks

Bluesky and Mastodon connect from Posty's **Accounts** page in a minute.
Every other network needs a developer app that you create once and own.
Pick a guide:

| Network                       | You need                                      |
|-------------------------------|-----------------------------------------------|
| [Facebook Pages](facebook.md) | a Facebook Page you manage                    |
| [Instagram](instagram.md)     | a Business or Creator account                 |
| [Threads](threads.md)         | a Threads profile                             |
| [X](x.md)                     | prepaid API credits                           |
| [LinkedIn](linkedin.md)       | a LinkedIn Company Page (a placeholder works) |
| [Pinterest](pinterest.md)     | a Pinterest business account                  |
| [YouTube](youtube.md)         | a Google Cloud project                        |
| [TikTok](tiktok.md)           | a TikTok account                              |
| [Bluesky](#bluesky)           | an app password                               |
| [Mastodon](#mastodon)         | your instance's name                          |

Instagram, Threads and Facebook video also need the
[media bucket](media-bucket.md).

## How every developer app works

1. **Create the app** in the network's developer portal.
2. **Add Posty's redirect URI.** After you approve access, the network sends
   you back to this address. Find it on Posty's **Accounts** page: open
   **Redirect URI** in the network's row and copy it.

   ![The Redirect URI under the Facebook Page row on the Accounts
   page](images/posty-redirect-uri.png)

   It looks like this, and must match character for character:

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/<network>/callback
   ```

   The redirect happens in your browser, so a host only your tailnet can
   reach works fine.
3. **Copy the app's ID and secret into `.env`** as `<NETWORK>_CLIENT_ID` and
   `<NETWORK>_CLIENT_SECRET`, then restart:

   ```bash
   docker compose up -d
   ```

   Until both are set, the network's row on the Accounts page says which
   keys to add.
4. **Click Connect** on the Accounts page and approve access.

API details in these guides were checked against each network's docs on
2026-11-03.

## Multiple accounts

Every network can have several accounts: click Connect again for each one.

- **YouTube, Instagram, TikTok, Mastodon**: Posty asks the network to show
  its login or account picker each time, so you can pick another account.
- **X, LinkedIn, Pinterest, Threads**: these use whichever account this
  browser is signed in to. Switch accounts (or sign out) on that site
  first. If you get the same account back, the Accounts page says so.
- **Facebook**: one connect adds every Page you grant. To add Pages later,
  Connect again and select them in the dialog.
- **Bluesky**: enter the other handle and its app password.
- In Meta **Development** mode, every extra Instagram or Threads account
  needs its own tester role on the app, the same way you added your first
  one ([Instagram](instagram.md), [Threads](threads.md)).

## Bluesky

No developer app needed.

1. In Bluesky, open **Settings → Privacy and security → App passwords**
   ([direct link](https://bsky.app/settings/app-passwords)) and click
   **Add App Password**. Name it `Posty`.
2. In Posty, open **Accounts**. In the Bluesky row, enter your handle (for
   example `you.bsky.social`) and the app password, then click
   **Connect**.

Use an app password, never your main password. On a self-hosted PDS, also
fill in its URL.

## Mastodon

No keys needed.

1. In Posty, open **Accounts**. In the Mastodon row, enter your instance,
   for example `mastodon.social`, and click **Connect**.
2. Posty registers itself with your instance and sends you there. Sign in
   and click **Authorize**.

Character and media limits are read from your instance. Retries send an
`Idempotency-Key`, so a retry never double-posts.
