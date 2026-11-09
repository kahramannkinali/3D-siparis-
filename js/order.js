import { api, isConfigured, fileToBase64, formatSize, esc } from './api.js';

const C = window.SITE_CONFIG || {};
const MAX_IMAGES = 3;
const MAX_IMAGE_MB = 15;   // tek görsel (sıkıştırmadan önce)
const MAX_MODEL_MB = 25;
const MODEL_EXT = ['stl', '3mf', 'obj', 'step', 'stp'];

const $ = (s) => document.querySelector(s);
const form = $('#order-form');
const errBox = $('#form-error');
const submitBtn = $('#submit-btn');

let images = [];   // { file, url }
let model = null;  // File

// ---------- Sayfa metinleri ----------
document.querySelectorAll('[data-shop-name]').forEach((el) => (el.textContent = C.SHOP_NAME || el.textContent));
if (C.SHOP_NAME) document.title = C.SHOP_NAME + ' — 3D Baskı Siparişi';
if (C.TAGLINE) $('[data-tagline]').textContent = C.TAGLINE;
$('#year').textContent = new Date().getFullYear();
const contact = [];
if (C.CONTACT_EMAIL) contact.push(`<a href="mailto:${esc(C.CONTACT_EMAIL)}">${esc(C.CONTACT_EMAIL)}</a>`);
if (C.INSTAGRAM) contact.push(`<a href="${esc(C.INSTAGRAM)}" target="_blank" rel="noopener">Instagram</a>`);
$('#contact').innerHTML = contact.join(' · ');
$('#material').innerHTML = (C.MATERIALS || ['Fark etmez']).map((m) => `<option>${esc(m)}</option>`).join('');
$('#deadline').min = new Date().toISOString().slice(0, 10);
if (!isConfigured()) $('#config-warn').hidden = false;

// Düzeltilen alanın kırmızı çerçevesini kaldır
form.addEventListener('input', (e) => e.target.classList?.remove('invalid'));

// ---------- Sürükle bırak görsel efekti ----------
for (const drop of document.querySelectorAll('.drop')) {
  drop.addEventListener('dragenter', () => drop.classList.add('over'));
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', () => drop.classList.remove('over'));
}

// ---------- Görseller ----------
$('#images').addEventListener('change', (e) => {
  hideError();
  for (const f of e.target.files) {
    if (images.length >= MAX_IMAGES) { showError(`En fazla ${MAX_IMAGES} görsel ekleyebilirsin.`); break; }
    if (!f.type.startsWith('image/')) { showError(`"${f.name}" bir görsel değil.`); continue; }
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) { showError(`"${f.name}" çok büyük (en fazla ${MAX_IMAGE_MB} MB).`); continue; }
    images.push({ file: f, url: URL.createObjectURL(f) });
  }
  e.target.value = '';
  renderThumbs();
});

function renderThumbs() {
  $('#thumbs').innerHTML = images.map((img, i) =>
    `<div class="thumb"><img src="${img.url}" alt=""><button type="button" class="x-btn" data-i="${i}" aria-label="Kaldır">×</button></div>`
  ).join('');
}
$('#thumbs').addEventListener('click', (e) => {
  const b = e.target.closest('.x-btn');
  if (!b) return;
  const [removed] = images.splice(Number(b.dataset.i), 1);
  URL.revokeObjectURL(removed.url);
  renderThumbs();
});

// ---------- 3D model ----------
$('#model').addEventListener('change', async (e) => {
  hideError();
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const ext = f.name.split('.').pop().toLowerCase();
  if (!MODEL_EXT.includes(ext)) return showError('Model dosyası STL, 3MF, OBJ veya STEP olmalı.');
  if (f.size > MAX_MODEL_MB * 1024 * 1024) {
    return showError(`Model dosyası en fazla ${MAX_MODEL_MB} MB olabilir. Daha büyükse açıklamaya bir indirme bağlantısı (Drive, WeTransfer…) ekleyebilirsin.`);
  }
  model = f;
  const box = $('#model-preview');
  box.innerHTML = `
    <div class="model-box">
      <div class="model-head">
        <div style="min-width:0"><div class="name">${esc(f.name)}</div><div class="meta" id="model-meta">${formatSize(f.size)}</div></div>
        <button type="button" class="link-btn" id="model-remove">Kaldır</button>
      </div>
      ${ext === 'stl' ? '<div class="viewer" id="viewer"><div class="note">Önizleme yükleniyor…</div></div>' : ''}
    </div>`;
  $('#model-remove').onclick = async () => {
    model = null;
    const v = $('#viewer');
    if (v) { try { (await import('./stl-viewer.js')).disposeViewer(v); } catch {} }
    box.innerHTML = '';
  };
  if (ext === 'stl') {
    const v = $('#viewer');
    try {
      const { showSTL } = await import('./stl-viewer.js');
      v.innerHTML = '';
      const info = showSTL(v, await f.arrayBuffer());
      const s = info.size;
      $('#model-meta').textContent = `${formatSize(f.size)} · ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm`;
    } catch (err) {
      console.warn(err);
      v.innerHTML = '<div class="note">Önizleme gösterilemedi, ama dosya yine de gönderilecek.</div>';
    }
  }
});

// ---------- Gönderim ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));

  const v = (id) => $('#' + id).value.trim();
  const problems = [];
  if (!v('name')) mark('name', problems, 'Ad soyad gerekli.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) mark('email', problems, 'Geçerli bir e-posta adresi gir.');
  if (v('description').length < 10) mark('description', problems, 'Ürünü biraz daha detaylı anlat (en az 10 karakter).');
  if (!$('#consent').checked) problems.push('Göndermek için onay kutusunu işaretlemelisin.');
  if (problems.length) {
    showError(problems.join(' '));
    form.querySelector('.invalid')?.focus();
    return;
  }
  if (!isConfigured()) return showError('Site henüz yapılandırılmadı, talep gönderilemiyor.');

  setBusy(true, 'Dosyalar hazırlanıyor…');
  try {
    const imgPayload = [];
    for (const img of images) imgPayload.push(await prepareImage(img.file));
    const modelPayload = model
      ? { name: model.name, type: model.type || 'application/octet-stream', data: await fileToBase64(model) }
      : null;

    setBusy(true, 'Gönderiliyor…');
    const res = await api({
      action: 'submit',
      name: v('name'), email: v('email'), phone: v('phone'),
      title: v('title'), description: v('description'),
      material: v('material'), color: v('color'), quantity: v('quantity'), deadline: v('deadline'),
      website: v('website'),
      images: imgPayload, model: modelPayload,
    });
    $('#order-id').textContent = res.id;
    $('#form-area').hidden = true;
    $('#success').hidden = false;
    $('#siparis').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
});

$('#again-btn').addEventListener('click', () => location.reload());

// Büyük fotoğrafları gönderimden önce küçültür (telefon fotoğrafları 5-10 MB olabiliyor)
async function prepareImage(file) {
  const MAX_SIDE = 2000;
  if (file.type === 'image/gif' || file.size < 1.2 * 1024 * 1024) {
    return { name: file.name, type: file.type, data: await fileToBase64(file) };
  }
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) throw new Error('sıkıştırma işe yaramadı');
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return { name, type: 'image/jpeg', data: await fileToBase64(blob) };
  } catch {
    return { name: file.name, type: file.type, data: await fileToBase64(file) };
  }
}

function mark(id, list, msg) { $('#' + id).classList.add('invalid'); list.push(msg); }
function showError(msg) { errBox.textContent = msg; errBox.hidden = false; errBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function hideError() { errBox.hidden = true; }
function setBusy(on, label) {
  submitBtn.disabled = on;
  submitBtn.innerHTML = on ? `<span class="spinner"></span>${esc(label)}` : 'Talebi gönder';
}
