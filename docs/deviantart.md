# Connecting DeviantArt

Posty publishes one image per post as a deviation, through a developer app
that you own. The post's text becomes the description.

**Before you start:** your DeviantArt email address must be verified.

## 1. Register the app

1. Sign in to DeviantArt and open the
   [registration page](https://www.deviantart.com/developers/register). You
   can manage your apps later in
   [Studio](https://www.deviantart.com/studio/apps).
2. Name it, for example `Posty`.
3. Choose the **confidential** client type and the **Authorization Code**
   grant.
4. Under **OAuth2 Redirect URI Whitelist**, add the URI from Posty's Accounts
   page (DeviantArt row → **Redirect URI**). It must match exactly:

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/deviantart/callback
   ```

5. Leave the **Original URLs Whitelist** empty. Posty doesn't use it.

## 2. Copy the credentials

Add the app's **client_id** and **client_secret** to `.env`, then restart with
`docker compose up -d`:

```
DEVIANTART_CLIENT_ID=<client_id>
DEVIANTART_CLIENT_SECRET=<client_secret>
```

## 3. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the DeviantArt row.
2. Approve access on DeviantArt.
3. In the composer's DeviantArt tab, enter a **Title**, and optionally
   **Tags**, a **Mature content** level and the **AI-generated** label. Then
   publish a test post.

Posty asks for the `basic`, `user`, `browse`, `stash` and `publish` scopes.

## Publishing accepts DeviantArt's policies

Every publish tells DeviantArt that you accept its
[Submission Policy](https://www.deviantart.com/about/policy/submission/) and
Terms of Service (`agree_submission` and `agree_tos`). Read both before you
connect an account. Don't publish through Posty if you don't accept them.

## Limits

- Every post needs exactly one JPEG, PNG or GIF. Text-only posts, several
  images and video aren't supported.
- A title is required, up to 50 characters.
- Descriptions are capped at 5,000 characters in Posty.
- Tags can use only letters, numbers and underscores.
- Access tokens last an hour and are renewed automatically. Refresh tokens
  last 3 months, and the worker renews them in the background. If one lapses,
  the Accounts page asks you to reconnect.
- To add a second account, switch accounts on DeviantArt in this browser
  first.

API details were checked against DeviantArt's docs on 2026-11-06, but no real
post has been made yet. The title and description limits aren't confirmed by
those docs, so publish a test post before relying on this.

## Troubleshooting

- **DeviantArt rejects the redirect URI**: copy it again from the Accounts
  page (step 1). Only an exact match works.
- **`unverified_account`**: verify your email address on DeviantArt, then try
  again.
- **The post failed and an unused item appeared in Sta.sh**: the upload worked
  but publishing didn't. Delete the item if you don't want it.
