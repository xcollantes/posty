# Connecting Instagram

Posty publishes feed posts, carousels, reels and stories through the
**Instagram API with Unified login**. You don't need a Facebook Page, but you
do need a Meta developer app that you own and a business portfolio.

**Before you start:**

- Set up the [media bucket](media-bucket.md). Meta downloads every image and
  video from a URL, so Instagram can't work without it.
- This is a separate app from the [Facebook](facebook.md) one.

Steps were checked against Meta's docs on 2026-11-05. Meta moves menus around.
If one isn't where this guide says, look for the same words nearby.

## 1. Switch to a professional account

The API only works with **Business** or **Creator** accounts. In the
Instagram app, open **Settings** and, under **Account type and tools**,
choose **Switch to professional account**. It's free and you can switch
back.

## 2. Create the Meta app

1. Open the [Apps dashboard](https://developers.facebook.com/apps/) and
   click **Create App**. (First time? Click **Get Started** at
   [developers.facebook.com](https://developers.facebook.com/) to make a
   developer account.)
2. Name it, for example `Posty Instagram`.
3. Choose the use case **Manage messaging & content on Instagram**.
4. Connect the app to a business portfolio, either while creating it or later
   under **App settings** → **Basic**. Without one, the Unified login tab
   doesn't appear.

## 3. Create a login configuration

1. In the left sidebar, open **Use cases** → **Manage messaging & content on
   Instagram** → **Customize**, then the **API setup with Unified login** tab.
2. Select **Create new configuration**.
3. Select **Edit permissions** and make sure these are included:

   | Permission                  | What Posty uses it for      |
   |-----------------------------|-----------------------------|
   | `instagram_basic`           | Find your Instagram account |
   | `instagram_content_publish` | Publish posts               |
   | `instagram_manage_comments` | Post the first comment      |
   | `instagram_manage_insights` | Post analytics              |

   Meta also requires `instagram_manage_messages`. Posty doesn't use it.
4. In the configuration preview, check that the token type is **System-user**
   and the expiration is **Never**.

## 4. Add the redirect URI

1. On the same tab, under **Redirect URL**, enter the URI from Posty's
   Accounts page (Instagram card → **Redirect URI**):

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/instagram/callback
   ```

2. Click **Save**.

Ignore the **Login URL** on that tab. Posty builds its own, and the
dashboard's copy fails with "state mismatch".

## 5. Add yourself as a tester

While the app is in development, only people with a role on the app can
connect.

1. On the same tab, select **Add account** and invite your Instagram account
   as an **Instagram Tester**.
2. Accept the invite: in Instagram on the web, open **Settings** → **Website
   permissions** → **Apps and websites** → **Tester Invites**.

## 6. Copy the credentials into Posty

1. Copy the **configuration ID**. It's the `config_id` value in the Login URL
   from step 4.
2. Under **App settings** → **Basic**, copy the **App ID** and **App secret**.
3. Add them to `.env` and restart with `docker compose up -d`:

   ```
   INSTAGRAM_CLIENT_ID=<App ID>
   INSTAGRAM_CLIENT_SECRET=<App secret>
   INSTAGRAM_CONFIG_ID=<configuration ID>
   ```

## 7. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the Instagram card.
2. Log in with Instagram or Facebook. Instagram login needs your password.
3. Pick the business portfolio and the Instagram account, then allow the
   permissions. Skip the ad account if you're asked for one.
4. Schedule a test post with one image. In the composer's Instagram tab,
   pick **Feed**, **Reel** or **Story**.

## Limits

- Every post needs an image or a video.
- Feed images must be between 4:5 (portrait) and 1.91:1 (landscape). Posty
  converts images to JPEG.
- Captions up to 2,200 characters.
- Tokens belong to the business portfolio and, with expiration set to
  **Never**, don't expire. Posty can't renew a token with an expiry date, so
  you'd reconnect when it ends.
- A token stops working if you remove the app from the portfolio or move the
  Instagram account to another portfolio. Reconnect when the banner appears.
- Accounts connected before Posty moved to Unified login have to be connected
  again.

## Troubleshooting

- **"Set INSTAGRAM_CONFIG_ID in .env"**: add the configuration ID (step 6).
- **"Invalid platform app"**: this comes from the older Instagram Login. Rebuild
  Posty so it runs this version: `docker compose up -d --build`.
- **"State mismatch"**: start from Posty's Accounts page, not the dashboard's
  Login URL.
- **"No accounts were granted"**: pick the Instagram account during login. If
  you did, add `business_management` to the configuration. It isn't in the
  Unified login permission editor, so add the **Facebook Login for Business**
  product and edit the same configuration under **Configurations**.
- **You can't connect**: accept the tester invite (step 5), and check that the
  account is Business or Creator (step 1).
- **The post fails while Meta fetches the media**: check `GCS_BUCKET` and
  the [media bucket](media-bucket.md) setup.
