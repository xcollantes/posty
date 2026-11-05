# Connecting Pinterest

Posty creates pins (an image, up to 5 images, or a video) on a board you
choose, through a developer app that you own.

**Before you start:** new apps get **Trial access**, and trial pins are
visible only to you. Public pins need **Standard access**, which Pinterest
reviews (see [step 5](#5-optional-request-standard-access)).

## 1. Use a business account

Pinterest's developer platform only works with business accounts.
Converting is free. Open
[developers.pinterest.com](https://developers.pinterest.com/apps/) while
signed in. If you see **Oops, this is your personal account**, convert your
account to a business account in Pinterest's settings, or sign in with one.
Then verify your email and agree to the Developer Terms.

![Pinterest's developer account checklist: business account, verify, agree
to terms](images/pinterest-account-setup.png)

## 2. Create the app

1. In [My apps](https://developers.pinterest.com/apps/), create a new app.
2. Name it, for example `Posty`, and describe it as a personal scheduler for
   your own account.
3. Submit the form. If the app shows Trial access as pending, wait for
   Pinterest's approval before connecting.

## 3. Add the redirect URI and copy the credentials

1. Open the app from **My apps**.
2. Under **Redirect URIs**, add the URI from Posty's Accounts page
   (Pinterest row → **Redirect URI**) and save:

   ```
   https://posty.<your-tailnet>.ts.net/api/connect/pinterest/callback
   ```

3. Copy the **App id** and **App secret key**.
4. Add them to `.env` and restart with `docker compose up -d`:

   ```
   PINTEREST_CLIENT_ID=<App id>
   PINTEREST_CLIENT_SECRET=<App secret key>
   ```

   Trial apps may also need the sandbox API. If connecting works but
   posting fails, add this line too (this path is untested):

   ```
   PINTEREST_API_BASE=https://api-sandbox.pinterest.com/v5
   ```

## 4. Connect and test

1. In Posty, open **Accounts** and click **Connect** in the Pinterest row.
2. Click **Give access** on Pinterest.
3. In the composer's Pinterest tab, pick a **Board**, and optionally a
   **Title** and **Destination link**. Then publish a test pin.

Created a board after connecting? Click **Refresh** next to the account on
the Accounts page to reload your boards.

Posty asks for `user_accounts:read`, `boards:read`, `boards:write`,
`pins:read` and `pins:write`.

## 5. Optional: request Standard access

To make pins public, request **Standard access** from the app's page. You
need:

- A **demo video** showing how the app uses the API. Record yourself
  connecting Pinterest in Posty and publishing a pin.
- A **public privacy policy URL**. Your Posty host isn't public, so host the
  policy somewhere else, for example a GitHub Pages site.

## Limits

- Every pin needs an image or a video. Video pins fail on Trial access.
- Descriptions up to 800 characters, titles up to 100.
- Tokens are renewed by the worker in the background.

## Troubleshooting

- **Pinterest rejects the redirect URI**: copy it again from the Accounts
  page (step 3).
- **Pins only you can see**: that's Trial access (step 5).
- **The board list is empty or missing a board**: click **Refresh** on the
  Accounts page.
