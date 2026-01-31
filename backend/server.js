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

// Owner upload
app.post('/owner/upload', isOwner, upload.single('movie'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');
  return res.redirect('/owner/upload.html?success=1');
});

// API: list movies
app.get('/api/movies', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.(mp4|webm|ogg)$/i.test(f));
    const movies = files.map(name => ({ name, url: `/uploads/${encodeURIComponent(name)}` }));
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: 'Unable to read uploads' });
  }
});

// Fallback
app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
