# Connecting LinkedIn

Posty publishes text, images and video to your **personal LinkedIn
profile** through a developer app that you own.

Company Pages aren't supported: they need LinkedIn's Community Management
API, which is only granted to registered organizations.

## 1. Create the app

1. Open [LinkedIn Developers](https://www.linkedin.com/developers/apps) and
   click **Create app**.
2. Fill in the form:
   - **App name**: for example `Posty`.
   - **LinkedIn Page**: every app must be linked to a Company Page. Pick
     one you admin, or create a placeholder Page from the link on the form.
   - **App logo**: any square image.
3. Accept the terms and click **Create app**.

## 2. Add the products

1. Open the **Products** tab.
2. Click **Request access** on **Share on LinkedIn**, and again on **Sign In
   with LinkedIn using OpenID Connect**. Both are approved right away.

When you're done, both are under **Added products**:

![The Products tab with Share on LinkedIn and Sign In with LinkedIn using
OpenID Connect added](images/linkedin-products.png)

## 3. Add the redirect URI and copy the credentials

1. Open the **Auth** tab.
2. Under **OAuth 2.0 settings**, click the pencil next to **Authorized
   redirect URLs for your app** and add the URI from Posty's Accounts page
   (LinkedIn row → **Redirect URI**):

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/linkedin/callback
   ```

3. Click **Update**.
4. Under **Application credentials**, copy the **Client ID**, and the
   **Primary Client Secret** (click the eye icon to reveal it).

![The Auth tab: Client ID, Primary Client Secret and the Posty redirect
URL](images/linkedin-auth.png)

5. Add them to `.env` and restart with `docker compose up -d`:

   ```
   LINKEDIN_CLIENT_ID=<Client ID>
   LINKEDIN_CLIENT_SECRET=<Primary Client Secret>
   ```

## 4. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the LinkedIn row.
2. Sign in to LinkedIn and click **Allow**.
3. Publish a short test post.

Posty asks for `openid profile w_member_social`.

## Limits

- 3,000 characters.
- **Tokens last 60 days and can't be renewed** by personal apps. When one is
  close to expiring, a banner at the top of Posty says so. Click
  **Reconnect** on the Accounts page; it's usually one click.
- First comments may fail with 403, depending on the scopes LinkedIn grants.
  The post itself is still published.
- No analytics: they need the Community Management API.

## Troubleshooting

- **LinkedIn rejects the redirect URI**: copy it again from the Accounts
  page (step 3).
- **`unauthorized_scope_error`**: one of the two products from step 2 is
  missing.
