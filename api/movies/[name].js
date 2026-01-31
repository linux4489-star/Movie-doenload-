const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

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
  const name = req.query.name || req.query.slug || req.query[0] || req.query;
  if (req.method === 'DELETE') {
    const provided = (req.headers['x-owner-hash'] || '');
    if (!OWNER_HASH || provided !== OWNER_HASH) return res.status(401).json({ error: 'Unauthorized' });

    try {
      if (s3) {
        // name might be a key or a filename ending; try to find and delete corresponding meta and object
        const DeleteObjectCommand = require('@aws-sdk/client-s3').DeleteObjectCommand;
        // Attempt to delete object key directly if provided
        await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: name }));
        // Also remove meta entry if exists
        const metaKey = `meta/${name.replace(/[^a-zA-Z0-9.\-_/]/g,'_')}.json`;
        try{ await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: metaKey })); }catch(e){}
        return res.json({ success: true });
      }

      // disk fallback
      const fs = require('fs');
      const path = require('path');
      const UPLOAD_DIR = path.join(__dirname, '..', 'upload');
      const filePath = path.join(UPLOAD_DIR, name);
      if (fs.existsSync(filePath)){
        fs.unlinkSync(filePath);
        return res.json({ success: true });
      }
      return res.status(404).json({ error: 'Not found' });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Unable to delete' });
    }
  }
  return res.status(405).json({ error: 'Method not allowed' });
};