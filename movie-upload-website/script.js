// Minimal client-only video uploader with IndexedDB persistence (fallback: in-memory session)

const DB_NAME = 'movie-uploader-db';
const STORE = 'videos';
let db;

function openDB(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if(!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, {keyPath:'id', autoIncrement:true});
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

async function saveToDB(record){
  if(!db) return null;
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}
async function deleteFromDB(id){
  if(!db) return null;
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id).onsuccess = () => resolve();
  });
}
async function getAllFromDB(){
  if(!db) return [];
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

// UI helpers
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const pickBtn = document.getElementById('pick-files');
const gallery = document.getElementById('gallery');
const clearBtn = document.getElementById('clear-storage');
const addUrlBtn = document.getElementById('add-url');
const urlInput = document.getElementById('url-input');
const ownerControls = document.getElementById('owner-controls');
const setOwnerBtn = document.getElementById('set-owner-pass');
const enterOwnerBtn = document.getElementById('enter-owner');
const signOutOwnerBtn = document.getElementById('sign-out-owner');
const modeIndicator = document.getElementById('mode-indicator');
const autoTranscodeCheckbox = document.getElementById('auto-transcode');

let inMemory = []; // fallback if no DB
let isOwner = false;
const OWNER_HASH_KEY = 'movie_owner_hash';
const OWNER_SESSION_KEY = 'movie_owner_session';
let autoTranscode = localStorage.getItem('autoTranscode') !== 'false'; // default true unless explicitly disabled

function createCard(record, owner=false){
  const card = document.createElement('article');
  card.className = 'card';

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.alt = record.name || 'video';
  thumb.src = '';

  const video = document.createElement('video');
  video.controls = true;
  video.preload = 'metadata';
  video.style.display = 'none';

  // Source: blob or remote URL
  if(record.blob){
    const url = URL.createObjectURL(record.blob);
    video.src = url; // used for playback on click
    thumb.src = record.thumbnail || '';
    // If no thumbnail, show video frame on click
    if(!record.thumbnail){
      thumb.alt = 'Click to preview';
      thumb.addEventListener('click', ()=>{ video.style.display='block'; thumb.style.display='none' });
    } else {
      thumb.addEventListener('click', ()=>{ video.style.display='block'; thumb.style.display='none' });
    }
  } else if(record.url){
    video.src = record.url;
    thumb.src = record.thumbnail || record.url;
    thumb.addEventListener('click', ()=>{ video.style.display='block'; thumb.style.display='none' });
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = record.name || (record.url || 'video');
  const created = document.createElement('small');
  created.textContent = new Date(record.createdAt || Date.now()).toLocaleString();
  meta.appendChild(name); meta.appendChild(created);

  card.dataset.created = record.createdAt || '';
  if(record.id) card.dataset.id = record.id;

  card.appendChild(thumb);
  card.appendChild(video);
  card.appendChild(meta);

  // show progress if transcoding
  if(record.transcoding){
    const prog = document.createElement('div'); prog.className = 'progress'; const pInner = document.createElement('i'); prog.appendChild(pInner); if(typeof record._transcodePct === 'number') pInner.style.width = record._transcodePct + '%'; card.appendChild(prog);
  }

  // Error overlay (hidden by default)
  const overlay = document.createElement('div'); overlay.className = 'card-error'; overlay.style.display = 'none';
  overlay.innerHTML = '<div class="card-error-inner"></div><div class="card-error-actions"></div>';
  card.appendChild(overlay);
  const overlayInner = overlay.querySelector('.card-error-inner');
  const overlayActions = overlay.querySelector('.card-error-actions');

  function showError(msg){
    overlayInner.textContent = msg || 'Playback error';
    overlayActions.innerHTML = '';
    const openBtn = document.createElement('button'); openBtn.textContent = 'Open'; openBtn.addEventListener('click', async ()=>{
      const ok = await openInSystemPlayer(record, video);
      if(!ok) alert('No direct source available. Try Transcode or ask owner to download the file.');
    });

    const dlBtn = document.createElement('button'); dlBtn.textContent = 'Download'; dlBtn.addEventListener('click', async ()=>{
      const ok = await downloadRecord(record, video);
      if(!ok) showError('Download failed. Try Transcode or ask owner to download.');
    });
    overlayActions.appendChild(dlBtn);
    const retryBtn = document.createElement('button'); retryBtn.textContent = 'Retry'; retryBtn.addEventListener('click', ()=>{
      overlay.style.display = 'none';
      // re-attach source to attempt recovery
      attachVideoSource(video, record, (m)=>{ if(m) showError(m); else overlay.style.display = 'none'; });
    });
    overlayActions.appendChild(openBtn); overlayActions.appendChild(retryBtn);

    // allow on-demand transcode if source available and not already transcoded
    if((record.blob || record.url) && !record.transcoded){
      const transBtn = document.createElement('button'); transBtn.textContent = 'Transcode'; transBtn.addEventListener('click', async ()=>{
        overlayInner.textContent = 'Transcoding...'; overlayActions.innerHTML='';
        const prog = document.createElement('div'); prog.className='progress'; const pInner = document.createElement('i'); prog.appendChild(pInner); overlayActions.appendChild(prog);
        try{
          const sourceBlob = record.blob || (record.url ? await fetch(record.url).then(r=>r.blob()) : null);
          if(!sourceBlob) throw new Error('No source to transcode');
          const newBlob = await transcodeToMp4(sourceBlob, pct=>{ pInner.style.width = pct + '%' ; record._transcodePct = pct; updateTranscodeProgress(record, pct); });
          record.blob = newBlob; record.type = 'video/mp4'; record.transcoded = true; record.transcoding = false;
          record.thumbnail = await generateThumbnail(newBlob).catch(()=>null);
          await putToDB(record).catch(()=>{});
          attachVideoSource(video, record, (m)=>{ if(m) showError(m); else overlay.style.display='none'; });
          overlay.style.display = 'none';
          renderGallery();
        }catch(err){ showError('Transcode failed: '+err.message); }
      });
      overlayActions.appendChild(transBtn);
    }

    overlay.style.display = 'flex';
  }

  function clearError(){ overlay.style.display = 'none'; overlayInner.textContent = ''; overlayActions.innerHTML = ''; }

  // attach source (supports HLS, blob, regular URLs) with diagnostics
  attachVideoSource(video, record, (msg)=>{ if(msg) showError(msg); else clearError(); });

  // Player tools (Fullscreen, PiP, speed, resolution, open)
  const tools = createPlayerTools(video, record);
  card.appendChild(tools);

  // thumbnail click: show video and attempt to play (user gesture)
  thumb.addEventListener('click', async ()=>{
    thumb.style.display = 'none';
    video.style.display = 'block';
    try{ await video.play(); }catch(e){ console.warn('Play prevented', e); }
  });

  // Only show actions to owner
  if(owner){
    const actions = document.createElement('div');
    actions.className = 'actions';

    const dl = document.createElement('button'); dl.textContent = 'Download';
    dl.addEventListener('click', ()=>{
      if(record.blob){
        const a = document.createElement('a'); a.href = URL.createObjectURL(record.blob); a.download = record.name || 'video'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      } else if(record.url){
        window.open(record.url, '_blank');
      }
    });

    const publish = document.createElement('button'); publish.textContent = record.url ? 'Published' : 'Publish';
    publish.disabled = !!record.url;
    publish.addEventListener('click', async ()=>{
      if(!record.blob){ alert('No local blob to publish'); return; }
      try{
        const fileName = record.name || 'upload.mp4';
        const contentType = record.blob.type || 'application/octet-stream';

        // Request a presigned upload URL (R2/S3) from server
        const presignRes = await fetchWithDiagnostics('/api/presign', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ filename: fileName, contentType }) });
        if(presignRes && (presignRes.status === 401 || presignRes.status === 403 || presignRes.redirected)){
          if(confirm('Server requires owner login to publish. Open server owner login page?')) window.open('/owner/login.html','_blank');
          return;
        }

        // If presign not available (disk-fallback), fall back to original upload endpoint
        if(!presignRes || !presignRes.ok){
          const fd = new FormData();
          fd.append('movie', record.blob, fileName);
          const res = await fetchWithDiagnostics('/api/upload', { method: 'POST', body: fd });
          if(!res || !res.ok) throw new Error('Upload failed: ' + (res ? res.status : 'network'));
          const data = await res.json();
          record.url = data.url; record.name = data.name || record.name; record.server = true;
          await putToDB(record);
          publish.textContent = 'Published'; publish.disabled = true;
          showToast('Published to server');
          renderGallery();
          return;
        }

        const presignData = await presignRes.json();
        const { uploadUrl, publicUrl, key } = presignData;

        // Upload directly to storage using PUT
        const putRes = await fetchWithDiagnostics(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: record.blob });
        if(!putRes || !(putRes.status >= 200 && putRes.status < 300)) throw new Error('Upload to storage failed: ' + (putRes ? putRes.status : 'network'));

        // Register uploaded object in server DB
        const regRes = await fetchWithDiagnostics('/api/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ key, name: fileName, url: publicUrl }) });
        if(!regRes || !regRes.ok) throw new Error('Register failed');

        record.url = publicUrl; record.name = fileName; record.server = true;
        await putToDB(record);
        publish.textContent = 'Published'; publish.disabled = true;
        showToast('Published to server');
        renderGallery();
      }catch(err){ console.error('Publish failed', err); alert('Publish failed: '+ (err.message || 'error')); }
    });

    const del = document.createElement('button'); del.textContent = 'Delete';
    del.addEventListener('click', async ()=>{
      // If this is a server-hosted movie, call API to delete
      try{
        if(record.server || (record.url && record.url.startsWith('/uploads/'))){
          const name = decodeURIComponent((record.url||'').split('/').pop());
          const res = await fetchWithDiagnostics('/api/movies/' + encodeURIComponent(name), { method: 'DELETE' });
          if(!res || !res.ok) throw new Error('Server delete failed');
          showToast('Server file deleted');
        }
      }catch(e){ console.warn('Server delete failed', e); }

      // revoke blob URL if used by this element
      try{ if(video._objectUrl) URL.revokeObjectURL(video._objectUrl); }catch(e){}
      if(record.id) await deleteFromDB(record.id);
      inMemory = inMemory.filter(r => r !== record);
      renderGallery();
    });

    actions.appendChild(dl); actions.appendChild(publish); actions.appendChild(del);
    card.appendChild(actions);
  }

  gallery.prepend(card);
}

async function handleFiles(files){
  if(!isOwner){ alert('Only owner can upload files'); return; }
  for(const file of files){
    if(!file.type.startsWith('video')) continue;
    const record = {name: file.name, type: file.type, createdAt: Date.now()};
    // Create blob copy
    const blob = file.slice(0, file.size, file.type);

    // Quick capability check
    const test = document.createElement('video'); const can = test.canPlayType(blob.type);
    if(!can){
      const big = file.size > 200 * 1024 * 1024;
      if(autoTranscode){
        // owner-only enforced earlier during upload
        record.blob = null; record.transcoding = true; record._transcodePct = 0;
        const id = await saveToDB(record).catch(()=>null); if(id) record.id = id; else inMemory.push(record);
        renderGallery();
        showToast(`Auto-transcoding "${file.name}" started${big ? ' (large file, may be slow)' : ''}`);
        try{
          const newBlob = await transcodeToMp4(blob, pct=>{ updateTranscodeProgress(record, pct); });
          record.blob = newBlob; record.type = 'video/mp4'; record.transcoded = true; record.transcoding = false;
          record.thumbnail = await generateThumbnail(newBlob).catch(()=>null);
          await putToDB(record).catch(()=>null);
        }catch(err){
          console.error('Transcode failed', err);
          record.transcoding = false; record.transcodeError = err.message;
          // fallback: save original so at least it is stored
          record.blob = blob;
          record.thumbnail = await generateThumbnail(blob).catch(()=>null);
          await putToDB(record).catch(()=>null);
          showToast('Transcode failed: ' + (err.message || 'unknown'));
        }
      } else {
        const proceed = confirm(`The file "${file.name}" may not play in this browser. Transcode to MP4 (H.264)? This is done in-browser and may be slow.${big ? ' (Large file: server-side recommended)' : ''}`);
        if(proceed){
          record.blob = null; record.transcoding = true; record._transcodePct = 0;
          const id = await saveToDB(record).catch(()=>null); if(id) record.id = id; else inMemory.push(record);
          renderGallery();
          try{
            const newBlob = await transcodeToMp4(blob, pct=>{ updateTranscodeProgress(record, pct); });
            record.blob = newBlob; record.type = 'video/mp4'; record.transcoded = true; record.transcoding = false;
            record.thumbnail = await generateThumbnail(newBlob).catch(()=>null);
            await putToDB(record).catch(()=>null);
          }catch(err){
            console.error('Transcode failed', err);
            record.transcoding = false; record.transcodeError = err.message;
            await putToDB(record).catch(()=>null);
          }
        } else {
          record.blob = blob;
          record.thumbnail = await generateThumbnail(blob).catch(()=>null);
          const id = await saveToDB(record).catch(()=>null); if(id) record.id = id; else inMemory.push(record);
        }
      }
    } else {
      record.blob = blob;
      record.thumbnail = await generateThumbnail(blob).catch(()=>null);
      const id = await saveToDB(record).catch(()=>null); if(id) record.id = id; else inMemory.push(record);
    }
  }
  renderGallery();
} 

async function generateThumbnail(blob){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(blob);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.src = url; vid.muted = true; vid.playsInline = true;

    function cleanup(){ URL.revokeObjectURL(url); vid.remove(); }

    vid.addEventListener('loadeddata', ()=>{
      // try to capture a frame at 1s or 0
      const seekTo = Math.min(1, Math.floor(vid.duration/2));
      vid.currentTime = seekTo;
    });
    vid.addEventListener('seeked', ()=>{
      try{
        const c = document.createElement('canvas');
        c.width = vid.videoWidth || 320; c.height = vid.videoHeight || 180;
        const ctx = c.getContext('2d');
        ctx.drawImage(vid, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/jpeg', 0.7);
        cleanup(); resolve(data);
      }catch(e){ cleanup(); reject(e); }
    });
    vid.onerror = e => { cleanup(); reject(e); };
  });
}

// ----- Player helpers: HLS support, attaching sources, resolution & enhanced controls -----
function isHlsUrl(url){
  return typeof url === 'string' && url.split('?')[0].toLowerCase().endsWith('.m3u8');
}

function attachVideoSource(video, record, onError){
  // Clean previous HLS instance or blob URL
  try{ if(video._hls){ video._hls.destroy(); } }catch(e){}
  if(video._objectUrl){ try{ URL.revokeObjectURL(video._objectUrl);}catch(e){} video._objectUrl = null; }

  if(record.url && isHlsUrl(record.url)){
    // HLS: use hls.js if available and supported, otherwise rely on native HLS (Safari)
    if(window.Hls && Hls.isSupported()){
      const hls = new Hls();
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error('HLS error', data);
        const msg = `HLS error (${data.type} / ${data.details}) ${data.fatal?'- fatal':''}`;
        if(typeof onError === 'function') onError(msg);
        if(data.fatal){
          // try basic recovery for recoverable errors, otherwise destroy
          if(data.type === Hls.ErrorTypes.NETWORK_ERROR){ hls.startLoad(); }
          else if(data.type === Hls.ErrorTypes.MEDIA_ERROR){ hls.recoverMediaError(); }
          else { hls.destroy(); }
        }
      });
      hls.loadSource(record.url);
      hls.attachMedia(video);
      video._hls = hls;
    }else{
      video.src = record.url; // Safari may play native HLS
    }
  }else if(record.blob){
    const url = URL.createObjectURL(record.blob);
    video.src = url; video._objectUrl = url;
  }else if(record.url){
    video.src = record.url;
  }

  // Video element error diagnostics
  video.addEventListener('error', ()=>{
    let err = video.error;
    let msg = 'Playback error';
    if(err){
      const codes = {1:'MEDIA_ERR_ABORTED',2:'MEDIA_ERR_NETWORK',3:'MEDIA_ERR_DECODE',4:'MEDIA_ERR_SRC_NOT_SUPPORTED'};
      msg = codes[err.code] ? `${codes[err.code]} (${err.code})` : `Media error (${err.code})`;
      console.error('Video element error', err);
    }
    if(typeof onError === 'function') onError(msg);
  });

  // loadedmetadata indicates source is usable
  video.addEventListener('loadedmetadata', ()=>{ if(typeof onError === 'function') onError(null); });
}

// Try to open a direct playable source in a new tab.
// Handles blobs (creates temporary object URL), HLS URLs, and video element currentSrc.
function openDirectSource(record, video){
  try{
    // Blob stored in record
    if(record && record.blob){
      const url = URL.createObjectURL(record.blob);
      window.open(url, '_blank');
      // Revoke after short delay to allow the browser to fetch
      setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 5000);
      return true;
    }
    // Direct URL
    if(record && record.url){ window.open(record.url, '_blank'); return true; }
    // Video element's currentSrc
    if(video && video.currentSrc){ window.open(video.currentSrc, '_blank'); return true; }
    return false;
  }catch(e){ console.error('openDirectSource error', e); return false; }
}

// Try to open the video in the system player or share it to an external app.
// Strategy: try Web Share API with file first, then fall back to opening the source URL/object URL.
async function openInSystemPlayer(record, video){
  try{
    // Prefer the Web Share API for a native app picker (mobile)
    if(record && record.blob && navigator.canShare && navigator.canShare({ files: [new File([record.blob], record.name || 'video', { type: record.type })] } )){
      try{
        await navigator.share({ files: [new File([record.blob], record.name || 'video', { type: record.type })], title: record.name || 'video' });
        return true;
      }catch(e){ console.warn('navigator.share failed', e); }
    }

    // If Web Share not available or failed, try to open a direct source
    const ok = openDirectSource(record, video);
    if(ok) return true;

    // As a last resort, if video has a currentSrc, try to navigate to it (may open system player)
    if(video && video.currentSrc){ window.location.href = video.currentSrc; return true; }
    return false;
  }catch(e){ console.error('openInSystemPlayer error', e); return false; }
}

// Download helper: robustly trigger a download for blobs or remote URLs (falls back to opening source)
async function downloadRecord(record, video){
  try{
    if(record && record.blob){
      const url = URL.createObjectURL(record.blob);
      const a = document.createElement('a'); a.href = url; a.download = record.name || 'video'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 5000);
      showToast('Download started');
      return true;
    }

    if(record && record.url){
      // Try to fetch first (CORS may block). If fetch fails, fallback to opening the URL.
      try{
        const res = await fetchWithDiagnostics(record.url, { mode: 'cors' });
        if(!res || !res.ok) throw new Error('Fetch failed: ' + (res ? res.status : 'network'));
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const name = record.name || (new URL(record.url)).pathname.split('/').pop() || 'video';
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 5000);
        showToast('Download started');
        return true;
      }catch(err){
        console.warn('Fetch for download failed', err);
        // fallback: open the URL so user can long-press/save in mobile
        try{ window.open(record.url, '_blank'); showToast('Opened source — long-press to save on mobile'); return true; }catch(e){}
      }
    }

    if(video && video.currentSrc){
      try{ window.open(video.currentSrc, '_blank'); showToast('Opened source — long-press to save on mobile'); return true; }catch(e){}
    }

    return false;
  }catch(e){ console.error('downloadRecord error', e); return false; }
}

function formatResolution(w,h){
  if(!w || !h) return '';
  const height = Math.round(h);
  if(height >= 2160) return '4K';
  if(height >= 1440) return 'QHD';
  if(height >= 1080) return '1080p (HD)';
  if(height >= 720) return '720p (HD)';
  return `${height}p`;
}

function createPlayerTools(video, record){
  const tools = document.createElement('div'); tools.className = 'player-tools';

  const playBtn = document.createElement('button'); playBtn.textContent = 'Play'; playBtn.className='small play-btn';
  playBtn.addEventListener('click', async ()=>{
    try{
      if(video.paused || video.ended){ await video.play(); playBtn.textContent = 'Pause'; }
      else { video.pause(); playBtn.textContent = 'Play'; }
    }catch(e){ console.warn('Play action blocked', e); }
  });

  const full = document.createElement('button'); full.textContent = 'Fullscreen'; full.className='small';
  full.addEventListener('click', ()=>{
    if(video.requestFullscreen) video.requestFullscreen();
    else if(video.webkitRequestFullscreen) video.webkitRequestFullscreen();
  });

  const pip = document.createElement('button'); pip.textContent = 'Picture-in-Picture'; pip.className='small';
  if('pictureInPictureEnabled' in document){
    pip.addEventListener('click', async ()=>{
      try{ if(document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture(); }
      catch(e){ alert('Picture-in-Picture not available'); }
    });
  } else { pip.disabled = true; }

  const speed = document.createElement('select');
  [0.5,0.75,1,1.25,1.5,2].forEach(v=>{ const o = document.createElement('option'); o.value=v; o.textContent = v+'x'; if(v===1) o.selected = true; speed.appendChild(o); });
  speed.addEventListener('change', ()=> video.playbackRate = Number(speed.value));

  // Resolution display
  const res = document.createElement('div'); res.className = 'player-res';
  res.textContent = '';

  // Open in new tab (useful to open in external players)
  const downloadBtn = document.createElement('button'); downloadBtn.textContent = 'Download'; downloadBtn.className='small';
  downloadBtn.addEventListener('click', async ()=>{
    const ok = await downloadRecord(record, video);
    if(!ok) alert('Cannot download: check CORS for remote URLs or try Transcode/owner download');
  });

  const openBtn = document.createElement('button'); openBtn.textContent = 'Open'; openBtn.className='small';
  openBtn.addEventListener('click', async ()=>{
    const ok = await openInSystemPlayer(record, video);
    if(!ok) alert('No direct source available. For uploaded files, owner may download; otherwise try Transcode or check CORS.');
  });

  // Open in system app / share (mobile native player)
  const openAppBtn = document.createElement('button'); openAppBtn.textContent = 'Open App'; openAppBtn.className='small';
  openAppBtn.addEventListener('click', async ()=>{
    const ok = await openInSystemPlayer(record, video);
    if(!ok) alert('Cannot open in system player. Try Download or Transcode.');
  });

  tools.appendChild(downloadBtn); tools.appendChild(openBtn);
  tools.appendChild(openAppBtn);

  tools.appendChild(full); tools.appendChild(pip); tools.appendChild(speed); tools.appendChild(openBtn); tools.appendChild(res);

  // Update resolution on metadata
  video.addEventListener('loadedmetadata', ()=>{
    res.textContent = formatResolution(video.videoWidth, video.videoHeight);
  });

  return tools;
}

// ----- In-browser transcoding with ffmpeg.wasm -----
let ffmpeg = null;
let ffmpegReady = false;
let ffmpegLoading = false;
async function ensureFFmpeg(onProgress){
  if(ffmpegReady) return ffmpeg;
  if(ffmpegLoading){
    return new Promise((resolve)=>{ const t = setInterval(()=>{ if(ffmpegReady){ clearInterval(t); resolve(ffmpeg); } },200); });
  }
  ffmpegLoading = true;
  try{
    const createFn = window.createFFmpeg || (window.FFmpeg && window.FFmpeg.createFFmpeg);
    const fetchFileFn = window.fetchFile || (window.FFmpeg && window.FFmpeg.fetchFile);
    if(!createFn) throw new Error('FFmpeg not available');
    ffmpeg = createFn({ log: false });
    ffmpeg.setProgress(({ ratio })=>{ if(onProgress) onProgress(Math.round(ratio*100)); });
    await ffmpeg.load();
    ffmpeg._fetchFile = fetchFileFn;
    ffmpegReady = true;
    return ffmpeg;
  }finally{ ffmpegLoading = false; }
}

async function transcodeToMp4(inputBlob, onProgress){
  await ensureFFmpeg(onProgress);
  const ext = (inputBlob.name && inputBlob.name.split('.').pop()) || 'bin';
  const inName = `in.${ext}`;
  const outName = 'out.mp4';
  const data = await ffmpeg._fetchFile(inputBlob);
  ffmpeg.FS('writeFile', inName, data);
  const args = ['-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'faststart', outName];
  await ffmpeg.run(...args);
  const outData = ffmpeg.FS('readFile', outName);
  try{ ffmpeg.FS('unlink', inName); ffmpeg.FS('unlink', outName); }catch(e){}
  return new Blob([outData.buffer], { type: 'video/mp4' });
}

async function putToDB(record){
  if(!db) return null;
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(record);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = e => reject(e.target.error);
  });
}

function updateTranscodeProgress(record, pct){
  record._transcodePct = pct;
  const el = gallery.querySelector(`.card[data-created="${record.createdAt}"]`);
  if(el){ const p = el.querySelector('.progress i'); if(p) p.style.width = pct + '%'; }
}

// ---------------------------------------------------------------------------

// Drag & drop (owner-only upload)
['dragenter','dragover'].forEach(ev=> dropZone.addEventListener(ev,e=>{ e.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev=> dropZone.addEventListener(ev,e=>{ e.preventDefault(); dropZone.classList.remove('dragover'); }));

dropZone.addEventListener('drop', e=>{ const files = e.dataTransfer.files; handleFiles(files); });
pickBtn.addEventListener('click', ()=> { if(!isOwner){ alert('Only owner can upload'); return;} fileInput.click(); });
fileInput.addEventListener('change', e=> handleFiles(e.target.files));

// Add by URL (owner-only)
addUrlBtn.addEventListener('click', async ()=>{
  if(!isOwner){ alert('Only owner can add by URL'); return; }
  const url = urlInput.value.trim(); if(!url) return;
  try{
    const res = await fetch(url, {mode:'cors'});
    const blob = await res.blob();
    if(!blob.type.startsWith('video')) throw new Error('URL does not point to a video');
    const record = {name: url.split('/').pop().split('?')[0], type: blob.type, createdAt: Date.now(), blob};
    record.thumbnail = await generateThumbnail(blob).catch(()=>null);
    const id = await saveToDB(record).catch(()=>null); if(id) record.id = id; else inMemory.push(record);
    urlInput.value='';
    renderGallery();
  }catch(err){
    // fallback: add URL-only entry (no persistence)
    const record = {name: url, url, createdAt: Date.now()}; inMemory.push(record); renderGallery();
  }
});

// Allow Enter key to submit URL (convenience for owner)
urlInput.addEventListener('keydown', e => {
  if(e.key === 'Enter'){
    e.preventDefault();
    addUrlBtn.click();
  }
});

clearBtn.addEventListener('click', async ()=>{
  if(!isOwner){ alert('Only owner can clear storage'); return; }
  if(db){ const tx = db.transaction(STORE,'readwrite'); tx.objectStore(STORE).clear(); }
  inMemory = []; renderGallery();
});

// Owner password management (simple client-side password stored as SHA-256 hash in localStorage)
async function hashString(s){
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function setOwnerPassword(){
  const p1 = prompt('Enter new owner password (will be stored locally in your browser)');
  if(!p1) return;
  const p2 = prompt('Confirm password'); if(p1 !== p2){ alert('Passwords do not match'); return; }
  const h = await hashString(p1);
  localStorage.setItem(OWNER_HASH_KEY, h);
  alert('Owner password set');
}

async function enterOwnerMode(){
  const stored = localStorage.getItem(OWNER_HASH_KEY);
  if(!stored){ alert('No owner password set. Set one first.'); return; }
  const p = prompt('Enter owner password'); if(!p) return;
  const h = await hashString(p);
  if(h === stored){
    isOwner = true; sessionStorage.setItem(OWNER_SESSION_KEY, '1'); updateUIForMode(); renderGallery();
  }else alert('Incorrect password');
}

function exitOwnerMode(){
  isOwner = false; sessionStorage.removeItem(OWNER_SESSION_KEY); updateUIForMode(); renderGallery();
}

function updateUIForMode(){
  if(isOwner){ ownerControls.classList.remove('hidden'); signOutOwnerBtn.hidden = false; enterOwnerBtn.hidden = true; setOwnerBtn.hidden = false; modeIndicator.textContent = 'Owner'; modeIndicator.className = 'mode-owner'; }
  else { ownerControls.classList.add('hidden'); signOutOwnerBtn.hidden = true; enterOwnerBtn.hidden = false; setOwnerBtn.hidden = false; modeIndicator.textContent = 'Guest'; modeIndicator.className = 'mode-guest'; }
}

async function renderGallery(){
  gallery.innerHTML = '';
  const items = await getAllFromDB();
  const all = items.concat(inMemory);
  // Render local items
  all.forEach(r => createCard(r, isOwner));
  // Fetch public movies from server and render them as read-only entries
  try{
    const res = await fetchWithDiagnostics('/api/movies');
    if(res && res.ok){
      const list = await res.json();
      list.forEach(m => {
        // Avoid duplicates: if we already have a local record with same URL, skip
        const exists = all.find(a => a.url && a.url === m.url);
        if(!exists){ createCard({ name: m.name, url: m.url, createdAt: 0, server: true }, isOwner); }
      });
    }
  }catch(e){ console.warn('Failed to fetch public movies', e); }
}

// Load existing and restore owner session
(async ()=>{
  await openDB();
  if(sessionStorage.getItem(OWNER_SESSION_KEY)) isOwner = true;
  updateUIForMode();
  await renderGallery();
  // Check clipboard on load (best-effort). This may be blocked without permissions.
  checkClipboardOnLoad().catch(()=>{});
})();

// --- Diagnostics: fetch wrapper + UI ---
const diagPanel = (function(){
  const el = document.createElement('div'); el.className = 'diagnostics';
  el.innerHTML = `<div class="row"><strong>Diagnostics</strong><button class="close">Close</button></div><div class="meta">No issues yet</div><pre class="body"></pre>`;
  document.body.appendChild(el);
  el.querySelector('.close').addEventListener('click', ()=> el.style.display = 'none');
  return el;
})();

function showDiagnostics(info){
  try{
    const meta = diagPanel.querySelector('.meta');
    const body = diagPanel.querySelector('.body');
    meta.textContent = `${info.method || 'GET'} ${info.url} — ${info.status || 'ERROR'}`;
    let details = '';
    if(info.statusText) details += `StatusText: ${info.statusText}\n`;
    if(info.status) details += `Status: ${info.status}\n`;
    if(info.headers) details += `Headers:\n${info.headers}\n`;
    if(info.body) details += `Body:\n${info.body}\n`;
    details += `\nTime: ${new Date().toLocaleString()}`;
    body.textContent = details;
    diagPanel.style.display = 'block';
  }catch(e){ console.error('showDiagnostics failed', e); }
}

async function fetchWithDiagnostics(url, opts){
  const info = { url, method: opts && opts.method ? opts.method : 'GET' };
  try{
    const res = await fetch(url, opts);
    info.status = res.status; info.statusText = res.statusText;
    // headers summary
    try{ info.headers = Array.from(res.headers.entries()).slice(0,10).map(h=>h.join(': ')).join('\n'); }catch(e){}
    if(!res.ok){
      // try to read body text
      let t = '';
      try{ t = await res.text(); info.body = t; }catch(e){ info.body = '<unreadable>'; }
      showDiagnostics(info);
      return res; // caller can still read
    }
    return res;
  }catch(err){
    info.status = 'NETWORK_ERROR'; info.statusText = err.message; info.body = (err && err.stack) ? err.stack : String(err);
    showDiagnostics(info);
    throw err;
  }
}

// Wire diagnostics button
const openDiagBtn = document.getElementById('open-diagnostics');
if(openDiagBtn){ openDiagBtn.addEventListener('click', ()=> { diagPanel.style.display = diagPanel.style.display === 'block' ? 'none' : 'block'; }); }


// Wire owner buttons
setOwnerBtn.addEventListener('click', setOwnerPassword);
enterOwnerBtn.addEventListener('click', enterOwnerMode);
signOutOwnerBtn.addEventListener('click', exitOwnerMode);

// initialize auto-transcode checkbox
try{ if(autoTranscodeCheckbox){ autoTranscodeCheckbox.checked = autoTranscode; autoTranscodeCheckbox.addEventListener('change', ()=>{ autoTranscode = !!autoTranscodeCheckbox.checked; localStorage.setItem('autoTranscode', autoTranscode ? 'true' : 'false'); showToast(`Auto-transcode ${autoTranscode ? 'enabled' : 'disabled'}`); }); } }catch(e){console.warn('Auto-transcode init failed', e);} 

// Simple accessibility: allow drop zone keyboard activation
dropZone.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' ') fileInput.click(); });

// Quick URL validator
function isValidUrl(s){ try{ const u = new URL(s); return ['http:','https:'].includes(u.protocol); }catch(e){ return false; } }

// Show a small prompt in the top-right for clipboard-added URLs
function showClipboardPrompt(url){
  try{
    const el = document.createElement('div'); el.className = 'clipboard-prompt';
    const u = document.createElement('div'); u.className = 'url'; u.textContent = url.length>60? url.slice(0,60)+'…' : url;
    const actions = document.createElement('div'); actions.className = 'actions';
    const addBtn = document.createElement('button'); addBtn.textContent = 'Add';
    addBtn.addEventListener('click', async ()=>{
      if(!isOwner){
        const enter = confirm('Enter Owner Mode to add this URL?');
        if(enter){ await enterOwnerMode(); }
      }
      if(isOwner){ urlInput.value = url; addUrlBtn.click(); showToast('Adding URL from clipboard'); el.remove(); }
    });
    const enterBtn = document.createElement('button'); enterBtn.textContent = 'Enter Owner'; enterBtn.addEventListener('click', async ()=>{ await enterOwnerMode(); el.remove(); });
    const dismiss = document.createElement('button'); dismiss.textContent = 'Dismiss'; dismiss.addEventListener('click', ()=> el.remove());
    actions.appendChild(addBtn); actions.appendChild(enterBtn); actions.appendChild(dismiss);
    el.appendChild(u); el.appendChild(actions); document.body.appendChild(el);
    // Auto-remove after 20s
    setTimeout(()=>{ try{ el.remove(); }catch(e){} }, 20000);
  }catch(e){ console.warn('Clipboard prompt failed', e); }
}

// Try to read clipboard on page load
async function checkClipboardOnLoad(){
  if(!('clipboard' in navigator) || !navigator.clipboard.readText) return;
  try{
    // Query permission first where supported
    if(navigator.permissions){
      try{
        const p = await navigator.permissions.query({ name: 'clipboard-read' });
        if(p.state === 'denied') return; // cannot read
      }catch(e){/*ignore*/}
    }
    const text = await navigator.clipboard.readText();
    if(!text) return;
    const m = text.match(/https?:\/\/[\S]+/i);
    if(!m) return;
    const url = m[0].replace(/[)\"'<>]/g,'');
    if(!isValidUrl(url)) return;
    showClipboardPrompt(url);
  }catch(e){
    // Reading clipboard may be blocked without user gesture; no-op
    console.warn('Clipboard read failed', e);
  }
}

// Small toast helper for non-blocking messages
function showToast(msg, duration=3000){ try{
  const t = document.createElement('div'); t.className='toast'; t.textContent = msg; document.body.appendChild(t);
  requestAnimationFrame(()=> t.classList.add('visible'));
  setTimeout(()=>{ t.classList.remove('visible'); setTimeout(()=>t.remove(),300); }, duration);
}catch(e){ console.warn('Toast error', e); }}

// Auto-add on paste: detect URL in clipboard and add if owner is signed in
document.addEventListener('paste', async (e)=>{
  try{
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if(!text) return;
    const m = text.match(/https?:\/\/[\S]+/i);
    if(!m) return;
    const url = m[0].replace(/[)\"'<>]/g,'');
    if(!isOwner){ showToast('URL pasted — enter Owner Mode to add videos'); return; }
    urlInput.value = url;
    showToast('URL detected — adding...');
    addUrlBtn.click();
  }catch(err){ console.error('Paste handler error', err); }
});

// Note: browser codec support varies. If a video fails to play, try converting to MP4 (H.264) or WebM.
