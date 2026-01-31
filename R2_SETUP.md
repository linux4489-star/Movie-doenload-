Cloudflare R2 setup (presigned uploads)

This project supports optional Cloudflare R2 (S3-compatible) presigned uploads. If R2 is configured the server will:
- Provide POST /api/presign (owner only) to obtain a presigned PUT URL
- Provide POST /api/register (owner only) to register a published movie in a simple JSON DB
- GET /api/movies returns the registered (published) items
- DELETE /api/movies/:name will remove the object and its DB entry

Environment variables (add to your .env):

R2_ENDPOINT=https://<accountid>.r2.cloudflareresources.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=your-bucket-name
R2_PUBLIC_BASE_URL=https://<accountid>.r2.cloudflareresources.com/<bucket>

Notes:
- The server falls back to the existing disk-based upload (POST /api/upload) if R2_* vars are not provided.
- Ensure your R2 bucket CORS allows PUT from your frontend origin when testing presigned PUT uploads:
  Example CORS rule for R2:
    [
      {
        "AllowedOrigins": ["*"],
        "AllowedMethods": ["GET", "HEAD", "PUT", "POST", "DELETE"],
        "AllowedHeaders": ["*"],
        "MaxAgeSeconds": 3600
      }
    ]
- When deploying, use short-lived presigned URLs and keep your keys secure (set them as environment variables on the host).

How it works (client flow):
1. Client requests POST /api/presign with filename+contentType. Server returns uploadUrl + publicUrl + key.
2. Client performs PUT upload to the uploadUrl (direct to R2) with blob + Content-Type header.
3. Client POSTs to /api/register to add the publicUrl/key to the server's registry.
4. Visitors call GET /api/movies to receive published items.

If you need help wiring Cloudflare R2 specifics (account, bucket names, CORS), tell me the provider and I can help step-by-step.