import { api, isConfigured, base64ToBytes, formatSize, esc } from './api.js';

const $ = (s) => document.querySelector(s);
const KEY = 'siparis-admin-pw';

let password = '';
let orders = [];
let statuses = [];
let filter = 'Hepsi';
const fileCache = new Map(); // fileId -> { name, type, bytes }

// ---------- Oturum ----------
function savedPw() { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } }
function savePw(p) { try { p ? sessionStorage.setItem(KEY, p) : sessionStorage.removeItem(KEY); } catch {} }

async function start() {
  if (!isConfigured()) {
    showLogin('Site henüz yapılandırılmadı: config.js içindeki SCRIPT_URL değerini doldur.');
    return;
  }
  const p = savedPw();
  if (p) {
    password = p;
    const ok = await load();
    if (ok) return;
  }
  showLogin();
}

function showLogin(msg) {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  const e = $('#login-error');
  e.hidden = !msg;
  e.textContent = msg || '';
  $('#password').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Kontrol ediliyor…';
  password = $('#password').value;
  const ok = await load(true);
  btn.disabled = false;
  btn.textContent = 'Giriş yap';
  if (ok) savePw(password);
});

$('#logout-btn').addEventListener('click', () => {
  password = '';
  savePw('');
  orders = [];
  $('#password').value = '';
  showLogin();
});

// ---------- Liste ----------
async function load(fromLogin = false) {
  try {
    const res = await api({ action: 'list', password });
    orders = res.orders;
    statuses = res.statuses;
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#list-error').hidden = true;
    render();
    return true;
  } catch (err) {
    if (fromLogin || /Şifre/.test(err.message)) {
      savePw('');
      showLogin(err.message);
    } else {
      const e = $('#list-error');
      e.textContent = err.message;
      e.hidden = false;
    }
    return false;
  }
}

$('#refresh-btn').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.innerHTML = '<span class="spinner dark"></span>Yenileniyor';
  await load();
  b.disabled = false;
  b.textContent = 'Yenile';
});
$('#search').addEventListener('input', render);

const stClass = (s) => 'st-' + String(s).split(' ')[0];
const ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>';
const ICON_TXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 6h14M5 11h14M5 16h9"/></svg>';

function render() {
  // Sayaçlar
  const count = (s) => orders.filter((o) => o.status === s).length;
  const chips = ['Hepsi', ...statuses].map((s) => {
    const n = s === 'Hepsi' ? orders.length : count(s);
    if (s !== 'Hepsi' && !n && filter !== s) return '';
    return `<button type="button" class="chip ${filter === s ? 'on' : ''}" data-s="${esc(s)}">${esc(s)}<b>${n}</b></button>`;
  }).join('');
  $('#counts').innerHTML = chips;

  const q = $('#search').value.trim().toLocaleLowerCase('tr');
  const list = orders.filter((o) =>
    (filter === 'Hepsi' || o.status === filter) &&
    (!q || [o.name, o.email, o.title, o.description, o.id].join(' ').toLocaleLowerCase('tr').includes(q))
  );

  if (!list.length) {
    $('#orders').innerHTML = `<div class="empty card">${orders.length ? 'Bu filtreye uyan sipariş yok.' : 'Henüz sipariş yok. İlk talep geldiğinde burada görünecek.'}</div>`;
    return;
  }
  $('#orders').innerHTML = list.map((o) => {
    const hasModel = o.files.some((f) => f.kind === 'model');
    const imgCount = o.files.filter((f) => f.kind === 'image').length;
    const firstImg = o.files.find((f) => f.kind === 'image');
    const extras = [hasModel ? '3D model' : '', imgCount ? imgCount + ' görsel' : ''].filter(Boolean).join(' · ');
    return `
      <button type="button" class="card order" data-id="${esc(o.id)}">
        <div class="pic" ${firstImg ? `data-thumb="${esc(firstImg.id)}"` : ''}>${hasModel ? ICON_BOX : ICON_TXT}</div>
        <div style="min-width:0">
          <h3>${esc(o.title)}</h3>
          <div class="meta">${esc(o.name)} · ${esc(o.date)}${extras ? ' · ' + extras : ''}</div>
          <div class="desc">${esc(o.description)}</div>
        </div>
        <div class="right"><span class="badge ${stClass(o.status)}">${esc(o.status)}</span></div>
      </button>`;
  }).join('');
  loadThumbs();
}

// Listedeki ilk görselleri sırayla yükle (sunucuyu yormamak için tek tek)
let thumbRun = 0;
async function loadThumbs() {
  const run = ++thumbRun;
  for (const el of document.querySelectorAll('[data-thumb]')) {
    if (run !== thumbRun) return;
    try {
      const url = await fileUrl(el.dataset.thumb);
      if (run !== thumbRun) return;
      el.innerHTML = `<img src="${url}" alt="">`;
    } catch {}
  }
}

$('#counts').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  filter = c.dataset.s;
  render();
});
$('#orders').addEventListener('click', (e) => {
  const b = e.target.closest('.order');
  if (b) openDrawer(b.dataset.id);
});

// ---------- Dosyalar ----------
async function getFile(id) {
  if (!fileCache.has(id)) {
    const res = await api({ action: 'file', password, fileId: id });
    fileCache.set(id, { name: res.name, type: res.type, bytes: base64ToBytes(res.data) });
  }
  return fileCache.get(id);
}
const urlCache = new Map();
async function fileUrl(id) {
  if (!urlCache.has(id)) {
    const f = await getFile(id);
    urlCache.set(id, URL.createObjectURL(new Blob([f.bytes], { type: f.type })));
  }
  return urlCache.get(id);
}
async function download(id) {
  const f = await getFile(id);
  const a = document.createElement('a');
  a.href = await fileUrl(id);
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- Ayrıntı paneli ----------
let current = null;

function openDrawer(id) {
  current = orders.find((o) => o.id === id);
  if (!current) return;
  const o = current;
  $('#d-id').textContent = o.id + ' · ' + o.date;

  const rows = [
    ['Ad soyad', esc(o.name)],
    ['E-posta', `<a href="mailto:${esc(o.email)}?subject=${encodeURIComponent('3D baskı talebiniz: ' + o.title)}">${esc(o.email)}</a>`],
    ['Telefon', o.phone ? `<a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : ''],
    ['Malzeme', esc(o.material)],
    ['Renk', esc(o.color)],
    ['Adet', esc(o.quantity)],
    ['İstenen tarih', esc(o.deadline)],
  ].filter((r) => r[1]);

  const imgs = o.files.filter((f) => f.kind === 'image');
  const models = o.files.filter((f) => f.kind === 'model');

  $('#d-body').innerHTML = `
    <div>
      <span class="badge ${stClass(o.status)}" id="d-badge">${esc(o.status)}</span>
      <h2 style="margin-top:10px">${esc(o.title)}</h2>
    </div>
    <dl class="kv">${rows.map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join('')}</dl>
    <div><div class="section-t">Açıklama</div><div class="desc-full">${esc(o.description)}</div></div>
    ${imgs.length ? `<div><div class="section-t">Görseller</div><div class="gallery">${imgs.map((f) =>
      `<a href="#" data-open="${esc(f.id)}" title="${esc(f.name)}"><span class="spinner dark"></span></a>`).join('')}</div></div>` : ''}
    ${models.length ? `<div><div class="section-t">3D model</div>${models.map((f) => `
      <div class="file-row">
        <div><b>${esc(f.name)}</b> <span style="color:var(--muted)">· ${formatSize(f.size || 0)}</span></div>
        <div class="actions">
          ${/\.stl$/i.test(f.name) ? `<button class="btn btn-ghost btn-sm" data-preview="${esc(f.id)}" type="button">3D önizle</button>` : ''}
          <button class="btn btn-primary btn-sm" data-dl="${esc(f.id)}" type="button">İndir</button>
        </div>
      </div>
      <div class="viewer" id="v-${esc(f.id)}" hidden style="border-radius:12px;margin-top:10px;border:1px solid var(--line)"></div>`).join('')}</div>` : ''}
    ${o.folderUrl ? `<div><a href="${esc(o.folderUrl)}" target="_blank" rel="noopener">Drive klasöründe aç ↗</a></div>` : ''}
    <div class="manage">
      <div class="section-t" style="margin:0">Takip</div>
      <div class="field">
        <label for="d-status">Durum</label>
        <select id="d-status">${statuses.map((s) => `<option ${s === o.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label for="d-note">Notum <span class="opt">(sadece sen görürsün)</span></label>
        <textarea id="d-note" placeholder="Fiyat, filament, baskı süresi…">${esc(o.note)}</textarea>
      </div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="d-save" type="button">Kaydet</button>
        <a class="btn btn-ghost btn-sm" href="mailto:${esc(o.email)}?subject=${encodeURIComponent('3D baskı talebiniz: ' + o.title)}">Müşteriye yaz</a>
        <span id="d-msg" class="saved"></span>
      </div>
    </div>`;

  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-bg').classList.add('open');
  $('#drawer').scrollTop = 0;

  // Görselleri yükle
  document.querySelectorAll('[data-open]').forEach(async (a) => {
    try {
      const url = await fileUrl(a.dataset.open);
      a.innerHTML = `<img src="${url}" alt="">`;
      a.href = url;
      a.target = '_blank';
      a.removeAttribute('data-open');
    } catch (err) {
      a.innerHTML = '<span style="font-size:12px;color:var(--err);padding:8px;text-align:center">Yüklenemedi</span>';
    }
  });
}

$('#d-body').addEventListener('click', async (e) => {
  const dl = e.target.closest('[data-dl]');
  const pv = e.target.closest('[data-preview]');
  const btn = dl || pv;
  if (!btn) return;
  const old = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner ${dl ? '' : 'dark'}"></span>${old}`;
  try {
    if (dl) {
      await download(dl.dataset.dl);
    } else {
      const id = pv.dataset.preview;
      const box = document.getElementById('v-' + id);
      box.hidden = false;
      const f = await getFile(id);
      const { showSTL } = await import('./stl-viewer.js');
      const info = showSTL(box, f.bytes.slice().buffer);
      btn.remove();
      const s = info.size;
      box.insertAdjacentHTML('afterend', `<div style="font-size:13px;color:var(--muted);margin-top:6px">Ölçüler: ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm · ${Math.round(info.triangles).toLocaleString('tr')} üçgen</div>`);
      return;
    }
  } catch (err) {
    alertInline(err.message);
  }
  if (btn.isConnected) { btn.disabled = false; btn.textContent = old; }
});

$('#d-body').addEventListener('click', async (e) => {
  if (!e.target.closest('#d-save') || !current) return;
  const b = $('#d-save');
  b.disabled = true;
  b.innerHTML = '<span class="spinner"></span>Kaydediliyor';
  try {
    const res = await api({ action: 'update', password, id: current.id, status: $('#d-status').value, note: $('#d-note').value });
    Object.assign(current, { status: res.order.status, note: res.order.note });
    $('#d-badge').className = 'badge ' + stClass(current.status);
    $('#d-badge').textContent = current.status;
    $('#d-msg').textContent = 'Kaydedildi ✓';
    setTimeout(() => { const m = $('#d-msg'); if (m) m.textContent = ''; }, 2500);
    render();
  } catch (err) {
    alertInline(err.message);
  }
  b.disabled = false;
  b.textContent = 'Kaydet';
});

function alertInline(msg) {
  const m = $('#d-msg');
  if (m) { m.style.color = 'var(--err)'; m.textContent = msg; setTimeout(() => { m.textContent = ''; m.style.color = ''; }, 5000); }
}

async function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-bg').classList.remove('open');
  const viewers = document.querySelectorAll('#d-body .viewer');
  if (viewers.length) {
    try {
      const { disposeViewer } = await import('./stl-viewer.js');
      viewers.forEach(disposeViewer);
    } catch {}
  }
  current = null;
}
$('#close-btn').addEventListener('click', closeDrawer);
$('#drawer-bg').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) closeDrawer(); });

start();
