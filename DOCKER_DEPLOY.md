Docker deployment (Render / Railway / DigitalOcean)

This project includes a simple Dockerfile to run the backend as an always-on Node server (suitable for Render, Railway, DigitalOcean App, etc.).

Environment variables used:
- OWNER_PASS (existing owner login for the Express server)
- (Optional) R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL - to enable R2

Build and run locally:
  docker build -t movie-backend:latest .
  docker run -p 4000:4000 -e OWNER_PASS=ownerpass -e R2_BUCKET=your-bucket -e R2_ACCESS_KEY_ID=... -e R2_SECRET_ACCESS_KEY=... movie-backend:latest

Notes:
- When using R2 in production, ensure CORS is configured to allow uploads.
- When deploying to services like Render, use their environment variable settings to provide R2 credentials and OWNER_HASH (for serverless functions) or OWNER_PASS for the regular server.
