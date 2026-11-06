# Connecting Instagram

Posty publishes feed posts, carousels, reels and stories through the
**Instagram API with Instagram Login**. You don't need a Facebook Page, only
a Meta developer app that you own.

**Before you start:**

- Set up the [media bucket](media-bucket.md). Meta downloads every image and
  video from a URL, so Instagram can't work without it.
- This is a separate app from the [Facebook](facebook.md) one.

Meta moves menus around. If one isn't where this guide says, look for the
same words nearby.

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
3. For the use case, choose **Other**, then the app type **Business**.
4. On the app's dashboard, find **Instagram** under products and click
   **Set up**.

## 3. Add the redirect URI

1. In the left sidebar, open **Instagram** → **API setup with Instagram
   login**.
2. Under **Set up Instagram business login**, open **Business login
   settings**.
3. In **OAuth redirect URIs**, add the URI from Posty's Accounts page
   (Instagram card → **Redirect URI**):

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/instagram/callback
   ```

4. Click **Save**.

## 4. Add yourself as a tester

While the app is in development, only testers can connect.

1. In the left sidebar, open **App roles** → **Roles**, click **Add
   People**, choose **Instagram Tester** and enter your Instagram username.
2. Accept the invite: in Instagram, open **Settings** → **Apps and
   websites** → **Tester invites** and click **Accept**.

## 5. Copy the credentials into Posty

1. Back on **API setup with Instagram login**, copy the **Instagram app
   ID** and **Instagram app secret**.

   These are **not** the Meta App ID and secret under App settings → Basic.
   Using those is the most common mistake.
2. Add them to `.env` and restart with `docker compose up -d`:

   ```
   INSTAGRAM_CLIENT_ID=<Instagram app ID>
   INSTAGRAM_CLIENT_SECRET=<Instagram app secret>
   ```

## 6. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the Instagram card.
2. Log in to Instagram and allow the permissions.
3. Schedule a test post with one image. In the composer's Instagram tab,
   pick **Feed**, **Reel** or **Story**.

Posty asks for `instagram_business_basic`,
`instagram_business_content_publish`, `instagram_business_manage_comments`
and `instagram_business_manage_insights`.

## Limits

- Every post needs an image or a video.
- Feed images must be between 4:5 (portrait) and 1.91:1 (landscape). Posty
  converts images to JPEG.
- Captions up to 2,200 characters.
- Tokens last 60 days. The worker renews them every week, so you don't
  reconnect.

## Troubleshooting

- **Instagram rejects the redirect URI**: the URI from step 3 doesn't
  match. Copy it again from the Accounts page.
- **"Invalid platform app"**: `.env` has the Meta App ID instead of the
  Instagram app ID (step 5).
- **You can't connect**: accept the tester invite (step 4), and check that
  the account is Business or Creator (step 1).
- **The post fails while Meta fetches the media**: check `GCS_BUCKET` and
  the [media bucket](media-bucket.md) setup.
