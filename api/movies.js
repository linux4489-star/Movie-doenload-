const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const streamToString = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const R2_ENDPOINT = process.env.R2_ENDPOINT || null;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || null;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || null;
const R2_BUCKET = process.env.R2_BUCKET || null;

let s3 = null;
if (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
  s3 = new S3Client({ region: 'auto', endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, forcePathStyle: false });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!s3) {
      // fallback: list local uploads folder
      const fs = require('fs');
      const path = require('path');
      const UPLOAD_DIR = path.join(__dirname, '..', 'upload');
      if (!fs.existsSync(UPLOAD_DIR)) return res.json([]);
      const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.(mp4|webm|ogg)$/i.test(f));
      const movies = files.map(name => ({ name, url: `/uploads/${encodeURIComponent(name)}` }));
      return res.json(movies);
    }

    const listCmd = new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'meta/' });
    const listed = await s3.send(listCmd);
    const contents = listed.Contents || [];
    const movies = [];
    for (const obj of contents) {
      try {
        const getCmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: obj.Key });
        const r = await s3.send(getCmd);
        const body = await streamToString(r.Body);
        movies.push(JSON.parse(body));
      } catch (e) { console.warn('Failed to fetch meta', obj.Key, e); }
    }
    return res.json(movies);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unable to list movies' });
  }
};