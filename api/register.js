const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const R2_ENDPOINT = process.env.R2_ENDPOINT || null;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || null;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || null;
const R2_BUCKET = process.env.R2_BUCKET || null;
const OWNER_HASH = process.env.OWNER_HASH || null;

let s3 = null;
if (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
  s3 = new S3Client({ region: 'auto', endpoint: R2_ENDPOINT, credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }, forcePathStyle: false });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const provided = (req.headers['x-owner-hash'] || '');
  if (!OWNER_HASH || provided !== OWNER_HASH) return res.status(401).json({ error: 'Unauthorized' });

  if (!s3) return res.status(501).json({ error: 'R2 not configured' });

  const { key, name, url } = req.body || {};
  if (!key || !url) return res.status(400).json({ error: 'key and url required' });

  const metaKey = `meta/${key.replace(/[^a-zA-Z0-9.\-_/]/g,'_')}.json`;
  const payload = JSON.stringify({ key, name: name || key.split('/').pop(), url, created_at: new Date().toISOString() });
  try {
    const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: metaKey, Body: payload, ContentType: 'application/json' });
    await s3.send(cmd);
    return res.json({ success: true, key, name, url });
  } catch (err) {
    console.error('Register failed', err);
    return res.status(500).json({ error: 'Register failed' });
  }
};