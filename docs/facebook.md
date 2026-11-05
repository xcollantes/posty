# Connecting Facebook Pages

Posty posts to Facebook **Pages**, not personal profiles, through a Meta
developer app that you own. You create the app once, copy its ID and secret
into `.env`, and then connect as many Pages as you manage.

Instagram uses a separate app with Instagram Login, so don't add any
Instagram use case here. See [Instagram](networks.md#instagram).

Dashboard paths were checked on 2026-11-04. Meta moves menus around; if one
isn't where this guide says, look for the same words nearby.

## 1. Create a developer account

1. Go to [developers.facebook.com](https://developers.facebook.com/) and
   click **Get Started** in the top-right corner.
2. Finish the sign-up with the Facebook account that manages your Pages.
   That account becomes the app's admin, which is what lets it use the app
   without App Review.

## 2. Create the app

1. Open the [Apps dashboard](https://developers.facebook.com/apps/) and
   click **Create App**.
2. Enter an app name (for example `Posty`) and your contact email.
3. Filter the use cases by **Content management** and select **Manage
   everything on your Page**. Select only this one.
4. If asked for a business portfolio, select yours, or choose not to
   connect one yet.
5. Review the details and open the app's dashboard.

## 3. Add the redirect URI

1. In the left sidebar, open **Facebook Login for Business** →
   **Settings**.
2. In **Valid OAuth Redirect URIs**, add:

   ```
   https://<TS_HOSTNAME>.<tailnet>.ts.net/api/connect/facebook/callback
   ```

   Posty's **Accounts** page shows the exact URI: open **Redirect URI** in
   the Facebook Page row. Copy it from there, since it must match character
   for character.
3. Click **Save changes**.

A tailnet-only host works here: the redirect happens in your browser, and
Meta never calls Posty directly.

## 4. Fill in the app settings

1. In the left sidebar, open **App settings** → **Basic**.
2. **App Domains**: your full Posty host, for example
   `posty.tail1234.ts.net`. Never just `ts.net`.
3. **Privacy Policy URL**: required to publish the app in step 8. Your
   tailnet host isn't public, so host the policy somewhere else, for
   example on a GitHub Pages site.
4. Click **Save changes**.

## 5. Copy the credentials into Posty

1. On the same **App settings** → **Basic** page, copy the **App ID**.
   Click **Show** next to **App secret** and copy it too.
2. Add both to `.env`:

   ```
   FACEBOOK_CLIENT_ID=<App ID>
   FACEBOOK_CLIENT_SECRET=<App secret>
   ```

3. Restart with `docker compose up -d`.

Until both are set, the Facebook Page row on the Accounts page says "Add
FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET to .env, then restart."

Posty calls Graph API v26.0 explicitly, so the app's default API version
under **App settings** → **Advanced** doesn't matter.

## 6. Add the permissions

1. In the left sidebar, open **Use cases** and click **Customize** on
   **Manage everything on your Page**. (Some dashboard versions list
   permissions under **Publish** instead.)
2. Add each permission below. Some are already added by default.

| Permission                | What Posty uses it for                        |
|---------------------------|-----------------------------------------------|
| `pages_show_list`         | List the Pages you manage when you connect    |
| `pages_manage_posts`      | Publish posts, photos, videos, reels, stories |
| `pages_read_engagement`   | Read Page details, likes, comments and shares |
| `pages_manage_engagement` | Post the first comment                        |
| `read_insights`           | Page analytics                                |
| `business_management`     | See Pages owned through a business portfolio  |

Posty asks for all six when you connect. If one is missing from the app,
Facebook's login dialog fails with **Invalid Scopes** and names it.

Mixpost's guide also adds `pages_manage_metadata` and an Instagram use
case. Posty uses neither, so skip them.

## 7. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the Facebook Page
   row.
2. Facebook asks which Pages to share. Select the Pages you want to post
   to, then approve the permissions.
3. Back in Posty, each Page appears as its own account. Page tokens don't
   expire, so there is nothing to renew.
4. Publish a short test post to one Page.

Until you finish step 8, only you can see that post.

## 8. Publish the app

While the app is **unpublished**, anything it posts is visible only to
people with a role on the app. Your Page's followers see nothing.

1. In the left sidebar, open **Publish** and click **Publish**.
2. If the page lists missing items, fill them in under **App settings** →
   **Basic**, then try again.
3. Open your test post in a logged-out browser window. It should now be
   visible.

You don't need App Review. Meta requires it only for apps used by people
without a role on them, and you are the app's admin. If another Posty user
connects their own Pages through this app, add them under **App roles**
first.

## Limits

- 30 API-published Reels per Page per day.
- Meta fetches videos, reels and video stories by URL, so set `GCS_BUCKET`
  first (see the [README](../README.md#setup)). Photos are uploaded
  directly and don't need it.

## Troubleshooting

- **"URL Blocked: This redirect failed because the redirect URI is not
  whitelisted"**: the URI from step 3 doesn't match. Copy it again from
  the Accounts page.
- **"Invalid Scopes"**: add the permissions it names (step 6).
- **"No Facebook Pages you can post to were granted to Posty"**: connect
  again and select your Pages in Facebook's dialog. Your Facebook account
  needs a role on the Page that can create content.
- **Followers don't see your posts**: publish the app (step 8).
- **"Reconnect needed" on an account**: Meta revoked the token, for example
  after a password change or after you removed the app in Facebook's
  settings. Click **Reconnect**.
