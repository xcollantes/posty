# Connecting X

Posty publishes posts, images, video and threads to your X account through a
developer app that you own.

**Before you start:** the X API is **pay-per-use**. Each post costs about
$0.015, and a post containing a link costs about **$0.20**. The composer
warns you when a post has a link.

The console changes often. If a setting isn't where this guide says, look
for the same words nearby.

## 1. Create the app

1. Sign in to the [X developer console](https://console.x.com) with the X
   account you'll post from.
2. Create a new app, for example `Posty`.
3. Buy API credits in the console's billing section. Posts fail without
   them.

## 2. Turn on OAuth 2.0

1. Open the app's **User authentication settings** and click **Set up** (or
   **Edit**).
2. **App permissions**: **Read and write**.
3. **Type of app**: **Web App** (a confidential client).
4. **Callback URI / Redirect URL**: the URI from Posty's Accounts page
   (X row → **Redirect URI**):

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/x/callback
   ```

5. **Website URL**: any public page of yours, for example your GitHub
   profile. X requires it but Posty doesn't use it.
6. Save.

## 3. Copy the credentials into Posty

1. Under **Keys and tokens**, find **OAuth 2.0 Client ID and Client
   Secret** and copy both.

   Use these, **not** the API Key and Secret (those are OAuth 1.0a).
2. Add them to `.env` and restart with `docker compose up -d`:

   ```
   X_CLIENT_ID=<OAuth 2.0 Client ID>
   X_CLIENT_SECRET=<OAuth 2.0 Client Secret>
   ```

## 4. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the X row.
2. Click **Authorize app** on X.
3. Publish a short test post without a link.

Posty asks for `tweet.read tweet.write users.read media.write
offline.access`. `offline.access` lets the worker renew the token in the
background.

## Limits

- 280 characters (25,000 with an X Premium subscription), up to 4 images.
- Threads of your own posts work. Replying to other people's posts is
  restricted on self-serve plans.
- Reading metrics is billed too, so it's off. Set `X_METRICS=1` in `.env` to
  fetch daily metrics.

## Troubleshooting

- **X rejects the redirect URI**: copy it again from the Accounts page
  (step 2).
- **Connect fails right away**: `.env` has the API Key instead of the OAuth
  2.0 Client ID (step 3), or the app type isn't Web App.
- **Posts fail with a credits or payment error**: buy API credits (step 1).
- **"Reconnect needed" on the account**: X revoked the token. Click
  **Reconnect** on the Accounts page.
