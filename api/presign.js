const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const R2_ENDPOINT = process.env.R2_ENDPOINT || null;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || null;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || null;
const R2_BUCKET = process.env.R2_BUCKET || null;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || null;
const OWNER_HASH = process.env.OWNER_HASH || null;

let s3 = null;
if (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
  s3 = new S3Client({ region: 'auto', endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, forcePathStyle: false });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // simple owner auth using x-owner-hash header (client stores SHA-256 hash)
  const provided = (req.headers['x-owner-hash'] || '');
  if (!OWNER_HASH || provided !== OWNER_HASH) return res.status(401).json({ error: 'Unauthorized' });

  if (!s3) return res.status(501).json({ error: 'R2 not configured' });

  const { filename, contentType } = req.body || {};
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const safe = filename.replace(/[^a-zA-Z0-9.\-_/]/g, '_');
  const key = `uploads/${Date.now()}-${safe}`;
  try {
    const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType || 'application/octet-stream' });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
    const publicUrl = R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${key}` : `${(R2_ENDPOINT||'').replace(/\/$/,'')}/${R2_BUCKET}/${key}`;
    return res.json({ uploadUrl, publicUrl, key });
  } catch (err) {
    console.error('Presign failed', err);
    return res.status(500).json({ error: 'Presign failed' });
  }
};