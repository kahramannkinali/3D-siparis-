// Apps Script ile konuşan küçük yardımcı.
// İleride Supabase'e geçersen değişmesi gereken yer büyük ölçüde sadece burası.

export function isConfigured() {
  const url = window.SITE_CONFIG?.SCRIPT_URL || '';
  return url.startsWith('https://');
}

export async function api(payload) {
  if (!isConfigured()) throw new Error('Site henüz yapılandırılmadı (config.js içindeki SCRIPT_URL).');
  let res;
  try {
    // text/plain kullanmak tarayıcının CORS ön kontrolünü atlamasını sağlar (Apps Script için gerekli)
    res = await fetch(window.SITE_CONFIG.SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Sunucuya ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.');
  }
  let data;
  try { data = await res.json(); } catch { throw new Error('Sunucudan beklenmeyen bir yanıt geldi.'); }
  if (!data.ok) throw new Error(data.error || 'Bilinmeyen hata.');
  return data;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Dosya okunamadı: ' + file.name));
    r.readAsDataURL(file);
  });
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
