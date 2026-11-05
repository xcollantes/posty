# Media bucket for Instagram, Threads and Facebook video

Instagram, Threads and Facebook video don't accept uploads: Meta downloads
each file from a URL you give it. Posty's host isn't public, so at publish
time the worker copies the file to a private Google Cloud Storage bucket and
hands Meta a signed URL that expires after an hour. A lifecycle rule deletes
the copies after a day.

Skip this page if you don't post to those three. Facebook photos are
uploaded directly and don't need it.

You need a Google Cloud project and the
[`gcloud` CLI](https://cloud.google.com/sdk/docs/install), signed in with
`gcloud auth login`.

## 1. Create the bucket and a key

Run this from the Posty folder. Set `PROJECT` to your project ID.

```bash
PROJECT=my-project
BUCKET=posty-media-$(openssl rand -hex 4)
SA=posty-media@$PROJECT.iam.gserviceaccount.com

# A private bucket that deletes files after one day
gcloud storage buckets create gs://$BUCKET --project=$PROJECT \
  --location=us-west1 --uniform-bucket-level-access \
  --public-access-prevention
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}' \
  > lifecycle.json
gcloud storage buckets update gs://$BUCKET --lifecycle-file=lifecycle.json

# A service account that can only touch this bucket
gcloud iam service-accounts create posty-media --project=$PROJECT
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=serviceAccount:$SA --role=roles/storage.objectAdmin

# Its key, readable by the containers (they run as uid 1000)
mkdir -p secrets
gcloud iam service-accounts keys create secrets/gcs-key.json \
  --iam-account=$SA
sudo chown 1000 secrets/gcs-key.json && chmod 600 secrets/gcs-key.json

echo "GCS_BUCKET=$BUCKET"
```

## 2. Tell Posty

1. Add the last line printed above to `.env`:

   ```
   GCS_BUCKET=posty-media-1a2b3c4d
   ```

   Leave `GOOGLE_APPLICATION_CREDENTIALS` as it is in `.env.example`.
2. Restart with `docker compose up -d`.

## 3. Check it

1. Publish a post with an image to Instagram.
   `docker compose logs worker` shows `published` and the post's URL.
2. `gcloud storage ls gs://$BUCKET` lists the copied file.
3. Its plain URL, `https://storage.googleapis.com/<bucket>/<file>`, returns
   **403**. Only the signed URL works, and only for an hour.
