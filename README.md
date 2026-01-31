# Movie Streaming Backend (Owner Upload)

Simple Node + Express backend for uploading and serving movies.

- Owner login: POST /owner/login (password from `OWNER_PASS` in .env)
- Upload: POST /owner/upload (multipart form field `movie`)
- List: GET /api/movies
- Watch: /watch.html?file=<filename>

Usage:
1. Copy `.env.example` to `.env` and set `OWNER_PASS`.
2. Run `npm install` inside `backend`.
3. Start: `npm start` or `npm run dev` (requires nodemon).

Uploaded files are saved to the `upload/` folder and served at `/uploads/<filename>`.
