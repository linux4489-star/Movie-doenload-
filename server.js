require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 4000;
const OWNER_PASS = process.env.OWNER_PASS || 'ownerpass';
const UPLOAD_DIR = path.join(__dirname, 'upload');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ secret: 'change-this-secret', resave: false, saveUninitialized: true }));

// Static public site
app.use('/', express.static(path.join(__dirname, 'public')));
// Serve uploaded movies
app.use('/uploads', express.static(UPLOAD_DIR));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-\_]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB

function isOwner(req, res, next) {
  if (req.session && req.session.isOwner) return next();
  return res.redirect('/owner/login.html');
}

// Owner login
app.post('/owner/login', (req, res) => {
  const { password } = req.body;
  if (password === OWNER_PASS) {
    req.session.isOwner = true;
    return res.redirect('/owner/upload.html');
  }
  return res.redirect('/owner/login.html?error=1');
});

// Owner upload (HTML form)
app.post('/owner/upload', isOwner, upload.single('movie'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  return res.redirect('/owner/upload.html?success=1');
});

// API: upload movie (JSON response) - owner only (disk fallback)
app.post('/api/upload', isOwner, upload.single('movie'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const name = req.file.filename;
  const url = `/uploads/${encodeURIComponent(name)}`;
  res.json({ name, url });
});

// Optional R2 / S3 integration (presign + register)
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const R2_ENDPOINT = process.env.R2_ENDPOINT || null;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || null;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || null;
const R2_BUCKET = process.env.R2_BUCKET || null;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL || null; // e.g. https://<account>.r2.cloudflareresources.com/<bucket>

let s3 = null;
if (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    forcePathStyle: false
  });
  console.log('R2 client configured');
} else {
  console.log('R2 not configured; using local disk fallback');
}

const DB_FILE = path.join(__dirname, 'movies.json');
function readDB(){
  try{ if(!fs.existsSync(DB_FILE)) return []; return JSON.parse(fs.readFileSync(DB_FILE,'utf8')||'[]'); }catch(e){ return []; }
}
function writeDB(arr){ fs.writeFileSync(DB_FILE, JSON.stringify(arr,null,2)); }
function addMovieEntry(entry){ const arr = readDB(); arr.push(entry); writeDB(arr); }
function removeMovieByKey(key){ const arr = readDB().filter(e=>e.key !== key); writeDB(arr); }

// API: presign upload (owner only)
app.post('/api/presign', isOwner, async (req, res) => {
  if(!s3) return res.status(501).json({ error: 'R2 not configured' });
  const { filename, contentType } = req.body || {};
  if(!filename) return res.status(400).json({ error: 'filename required' });
  const safe = filename.replace(/[^a-zA-Z0-9.\-_/]/g, '_');
  const key = `uploads/${Date.now()}-${safe}`;
  try{
    const cmd = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType || 'application/octet-stream' });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
    const publicUrl = R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL.replace(/\/$/,'')}/${key}` : `${(R2_ENDPOINT||'').replace(/\/$/,'')}/${R2_BUCKET}/${key}`;
    return res.json({ uploadUrl, publicUrl, key });
  }catch(err){ console.error('Presign failed', err); return res.status(500).json({ error: 'Presign failed' }); }
});

// API: register uploaded movie (owner only)
app.post('/api/register', isOwner, (req, res) => {
  const { key, name, url } = req.body || {};
  if(!key || !url) return res.status(400).json({ error: 'key and url required' });
  const entry = { key, name: name || key.split('/').pop(), url, created_at: new Date().toISOString() };
  addMovieEntry(entry);
  res.json({ success: true, ...entry });
});

// API: list movies (R2-backed or disk fallback)
app.get('/api/movies', (req, res) => {
  try {
    if(s3){
      const movies = readDB();
      return res.json(movies);
    }
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.(mp4|webm|ogg)$/i.test(f));
    const movies = files.map(name => ({ name, url: `/uploads/${encodeURIComponent(name)}` }));
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: 'Unable to read uploads' });
  }
});

// API: delete movie (owner only)
app.delete('/api/movies/:name', isOwner, async (req, res) => {
  try {
    const name = req.params.name;

    if(s3){
      // name is expected to be the object key or file name; try to find entry in DB
      const movies = readDB();
      const entry = movies.find(e => e.name === name || e.key === name || e.key.endsWith('/' + name));
      if(!entry) return res.status(404).json({ error: 'Not found' });
      const key = entry.key;
      const cmd = new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key });
      await s3.send(cmd);
      removeMovieByKey(key);
      return res.json({ success: true });
    }

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
});

// Fallback
app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
