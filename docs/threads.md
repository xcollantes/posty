# Connecting Threads

Posty publishes posts, images, videos and multi-post threads to your Threads
profile through a Meta developer app that you own.

**Before you start:**

- Set up the [media bucket](media-bucket.md) if you'll post images or
  video. Meta downloads media from a URL. Text-only posts work without it.
- Use a **separate** app from the [Facebook](facebook.md) and
  [Instagram](instagram.md) ones.

Meta moves menus around. If one isn't where this guide says, look for the
same words nearby.

## 1. Create the app

1. Open the [Apps dashboard](https://developers.facebook.com/apps/) and
   click **Create App**.
2. Name it, for example `Posty Threads`.
3. For the use case, choose **Access the Threads API**, and only that one.
4. Finish the wizard and open the app's dashboard.

## 2. Add the redirect URI

1. In the left sidebar, open **Use cases**, then **Customize** on **Access
   the Threads API**, then **Settings**.
2. In **Redirect Callback URLs**, add the URI from Posty's Accounts page
   (Threads card → **Redirect URI**):

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/threads/callback
   ```

3. Fill in **Uninstall Callback URL** and **Delete Callback URL** too if the
   page requires them. Posty doesn't use them, so the same URI works.
4. Click **Save**.

## 3. Add the permissions

Still in **Customize**, open **Permissions** and add:

| Permission                | What Posty uses it for    |
|---------------------------|---------------------------|
| `threads_basic`           | Read your profile         |
| `threads_content_publish` | Publish posts and threads |
| `threads_manage_replies`  | Post the first comment    |
| `threads_manage_insights` | Views, likes and replies  |

## 4. Add yourself as a tester

1. In the left sidebar, open **App roles** → **Roles**, click **Add
   People**, choose **Threads Tester** and enter your Threads username.
2. Accept the invite: in Threads, open **Settings** → **Account** →
   **Website permissions** → **Invites** and click **Accept**.

## 5. Copy the credentials into Posty

1. On the **Settings** page from step 2, copy the **Threads app ID** and
   **Threads app secret**. They differ from the Meta App ID.
2. Add them to `.env` and restart with `docker compose up -d`:

   ```
   THREADS_CLIENT_ID=<Threads app ID>
   THREADS_CLIENT_SECRET=<Threads app secret>
   ```

## 6. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the Threads card.
2. Log in to Threads and allow the permissions.
3. Publish a short text post. For a thread, click **Add another post to the
   thread** in the composer.

## Limits

- 500 characters per post, at most 5 links.
- 250 posts per day.
- Tokens are renewed by the worker every week.

## Troubleshooting

- **Threads rejects the redirect URI**: copy it again from the Accounts
  page (step 2).
- **You can't connect**: accept the tester invite (step 4).
- **Images or videos fail**: check `GCS_BUCKET` and the
  [media bucket](media-bucket.md) setup.
