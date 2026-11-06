# Connecting YouTube

Posty uploads videos to your YouTube channel, with a title and visibility,
through a Google Cloud project that you own. Vertical videos of 3 minutes or
less become Shorts automatically.

You can use the same Google Cloud project as the
[media bucket](media-bucket.md).

Google renames these pages from time to time. If one isn't where this guide
says, look for the same words nearby.

## 1. Create a project and turn on the API

1. [Create a project](https://console.cloud.google.com/projectcreate), for
   example `posty`, or pick an existing one in the project picker.
2. Open
   [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)
   and click **Enable**.

## 2. Set up the consent screen

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview)
   and click **Get started**.
2. Fill in an app name (`Posty`) and your email. For **Audience**, choose
   **External**. Finish the wizard.
3. Open [Audience](https://console.cloud.google.com/auth/audience) and click
   **Publish app**, so the status reads **In production**.

   Don't skip this. In **Testing**, Google expires the connection after 7
   days and scheduled uploads start failing.

You don't need Google's verification. When you connect, Google warns that
the app isn't verified; that's expected for a personal app.

## 3. Create the OAuth client

1. Open [Clients](https://console.cloud.google.com/auth/clients) and click
   **Create client**.
2. **Application type**: **Web application**. Name it `Posty`.
3. Under **Authorized redirect URIs**, click **Add URI** and paste the URI
   from Posty's Accounts page (YouTube card → **Redirect URI**):

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/youtube/callback
   ```

4. Click **Create** and copy the **Client ID** and **Client secret**.
5. Add them to `.env` and restart with `docker compose up -d`:

   ```
   YOUTUBE_CLIENT_ID=<Client ID>
   YOUTUBE_CLIENT_SECRET=<Client secret>
   ```

## 4. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the YouTube card.
2. Choose your Google account and channel.
3. At **Google hasn't verified this app**, click **Advanced**, then **Go to
   Posty (unsafe)**. It's your own app.
4. Allow both permissions.
5. Upload a short test video as **Private** or **Unlisted**, with a title.

Posty asks for `youtube.upload` and `youtube.readonly`.

## Limits

- Every post needs a video and a title (up to 100 characters).
  Descriptions can be up to 5,000 bytes.
- 100 uploads per day.
- Since 2026-11-02, uploads from unverified projects are no longer forced to
  private. Still, check your first upload's visibility.

## Troubleshooting

- **`redirect_uri_mismatch`**: the URI from step 3 doesn't match. Copy it
  again from the Accounts page.
- **Uploads stop working after a week**: the app is still in **Testing**.
  Publish it (step 2), then click **Reconnect** on the Accounts page.
- **`access_denied` when connecting**: the app is in Testing and your
  account isn't a test user. Publish the app (step 2).
