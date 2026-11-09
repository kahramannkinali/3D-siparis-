// Fiyat hesaplayıcı
// TOPLAM = [ (filament g + AMS fire g) × gram fiyatı
//          + süre (saat) × (saatlik elektrik + saatlik amortisman)
//          + sabit işçilik ] × (1 + fire/risk) × (1 + kâr)
import { esc } from './api.js';

export function calculate(p, input) {
  const qty = Math.max(1, Math.round(num(input.qty) || 1));
  const mat = p.materials.find((m) => m.name === input.material) || p.materials[0];
  const gramPrice = (mat?.kgPrice || 0) / 1000;
  const grams = num(input.grams) * qty + num(input.amsWaste);
  const hours = (num(input.hours) + num(input.minutes) / 60) * qty;

  const material = grams * gramPrice;
  const electricity = hours * p.powerKw * p.kwhPrice;
  const machine = hours * p.machineHourly;
  const labor = num(input.labor);
  const base = material + electricity + machine + labor;
  const risk = base * (num(input.risk) / 100);
  const profit = (base + risk) * (num(input.profit) / 100);
  const raw = base + risk + profit;
  const r = num(p.rounding);
  const total = r > 0 ? Math.ceil(raw / r - 1e-9) * r : Math.round(raw * 100) / 100;

  return { qty, grams, hours, material, electricity, machine, labor, base, risk, profit, raw, total, unit: total / qty, materialName: mat?.name || '' };
}

function num(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

export function money(v, cur) {
  const n = Number(v) || 0;
  const s = n.toLocaleString('tr-TR', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return cur === '€' || cur === '$' ? cur + s : s + ' ' + cur;
}

/** Sipariş malzemesini ayarlardaki bir malzemeyle eşleştir */
export function guessMaterial(p, orderMaterial) {
  const o = String(orderMaterial || '').toLocaleLowerCase('tr');
  const hit = p.materials.find((m) => o && (o === m.name.toLocaleLowerCase('tr') || o.includes(m.name.toLocaleLowerCase('tr').split(' ')[0])));
  return (hit || p.materials[0])?.name || '';
}

/** Hesaplayıcı formunun HTML'i */
export function calculatorHTML(p, init = {}) {
  const mat = init.material || p.materials[0]?.name;
  return `
  <div class="calc" data-calc>
    <div class="calc-grid">
      <div class="field"><label>Malzeme</label>
        <select data-k="material">${p.materials.map((m) => `<option ${m.name === mat ? 'selected' : ''} value="${esc(m.name)}">${esc(m.name)} · ${money(m.kgPrice, p.currency)}/kg</option>`).join('')}</select></div>
      <div class="field"><label>Adet</label><input data-k="qty" type="number" min="1" step="1" value="${esc(init.qty || 1)}"></div>
      <div class="field"><label>Filament <span class="opt">(g, 1 adet)</span></label><input data-k="grams" type="number" min="0" step="0.1" inputmode="decimal" placeholder="Slicer'dan" value="${esc(init.grams ?? '')}"></div>
      <div class="field"><label>AMS firesi <span class="opt">(g, toplam)</span></label><input data-k="amsWaste" type="number" min="0" step="0.1" inputmode="decimal" value="${esc(init.amsWaste ?? p.amsWaste)}"></div>
      <div class="field"><label>Baskı süresi <span class="opt">(1 adet)</span></label>
        <div class="dur"><input data-k="hours" type="number" min="0" step="1" inputmode="numeric" placeholder="0" value="${esc(init.hours ?? '')}"><span>sa</span>
        <input data-k="minutes" type="number" min="0" max="59" step="1" inputmode="numeric" placeholder="0" value="${esc(init.minutes ?? '')}"><span>dk</span></div></div>
      <div class="field"><label>İşçilik <span class="opt">(sabit)</span></label><input data-k="labor" type="number" min="0" step="1" value="${esc(init.labor ?? p.labor)}"></div>
      <div class="field"><label>Fire / risk <span class="opt">(%)</span></label><input data-k="risk" type="number" min="0" step="1" value="${esc(init.risk ?? p.risk)}"></div>
      <div class="field"><label>Kâr <span class="opt">(%)</span></label><input data-k="profit" type="number" min="0" step="1" value="${esc(init.profit ?? p.profit)}"></div>
    </div>
    <div class="calc-out" data-out></div>
  </div>`;
}

export function readCalc(root) {
  const o = {};
  root.querySelectorAll('[data-k]').forEach((el) => (o[el.dataset.k] = el.value));
  return o;
}

export function renderResult(root, p) {
  const r = calculate(p, readCalc(root));
  const c = p.currency;
  const row = (label, v, sub = '') => `<div class="cr"><span>${label}${sub ? ` <em>${sub}</em>` : ''}</span><b>${money(v, c)}</b></div>`;
  const h = Math.floor(r.hours), m = Math.round((r.hours - h) * 60);
  root.querySelector('[data-out]').innerHTML = `
    ${row('Hammadde', r.material, `${fmt(r.grams)} g`)}
    ${row('Elektrik', r.electricity, `${h} sa ${m} dk`)}
    ${row('Makine amortismanı', r.machine)}
    ${row('İşçilik', r.labor)}
    <div class="cr sum">${'<span>Temel maliyet</span>'}<b>${money(r.base, c)}</b></div>
    ${row('Fire / risk payı', r.risk)}
    ${row('Kâr', r.profit)}
    <div class="cr total"><span>Önerilen fiyat</span><b>${money(r.total, c)}</b></div>
    ${r.qty > 1 ? `<div class="cr unit"><span>Adet başı</span><b>${money(r.unit, c)}</b></div>` : ''}`;
  return r;
}

function fmt(n) { return (Math.round(n * 10) / 10).toLocaleString('tr-TR'); }

export function bindCalc(root, p, onChange) {
  const update = () => { const r = renderResult(root, p); onChange?.(r); };
  root.addEventListener('input', update);
  update();
}

/** Ayarlar formu */
export function settingsHTML(p) {
  const f = (k, label, unit, step = 'any') =>
    `<div class="field"><label>${label} <span class="opt">${unit}</span></label><input type="number" min="0" step="${step}" data-s="${k}" value="${esc(p[k])}"></div>`;
  return `
    <div class="section-t">Filament fiyatları <span style="text-transform:none;letter-spacing:0;font-weight:400">(${esc(p.currency)}/kg)</span></div>
    <div class="mat-list" data-mats>${p.materials.map(matRow).join('')}</div>
    <button type="button" class="btn btn-ghost btn-sm" data-add-mat style="justify-self:start">+ Malzeme ekle</button>
    <div class="section-t" style="margin-top:8px">Maliyetler</div>
    <div class="calc-grid">
      ${f('kwhPrice', 'Elektrik birim fiyatı', `(${esc(p.currency)}/kWh)`)}
      ${f('powerKw', 'Yazıcı tüketimi', '(kWh/saat)')}
      ${f('machineHourly', 'Makine amortismanı', `(${esc(p.currency)}/saat)`)}
      ${f('labor', 'Varsayılan işçilik', `(${esc(p.currency)})`)}
      ${f('amsWaste', 'Varsayılan AMS firesi', '(g)')}
      ${f('rounding', 'Yukarı yuvarla', `(${esc(p.currency)}, 0 = kapalı)`)}
    </div>
    <div class="section-t" style="margin-top:8px">Oranlar</div>
    <div class="calc-grid">
      ${f('risk', 'Fire / risk payı', '(%)', '1')}
      ${f('profit', 'Kâr marjı', '(%)', '1')}
      <div class="field"><label>Para birimi</label>
        <select data-s="currency">${['₺', '€', '$'].map((c) => `<option ${c === p.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>`;
}

export function matRow(m = { name: '', kgPrice: '' }) {
  return `<div class="mat-row"><input type="text" placeholder="Malzeme adı" data-mn value="${esc(m.name)}"><input type="number" min="0" step="any" placeholder="kg fiyatı" data-mp value="${esc(m.kgPrice)}"><button type="button" class="x-btn" data-del-mat aria-label="Sil" style="position:static;background:#eee;color:#555">×</button></div>`;
}

export function readSettings(root) {
  const p = {};
  root.querySelectorAll('[data-s]').forEach((el) => (p[el.dataset.s] = el.tagName === 'SELECT' ? el.value : el.value));
  p.materials = [...root.querySelectorAll('.mat-row')].map((r) => ({ name: r.querySelector('[data-mn]').value.trim(), kgPrice: r.querySelector('[data-mp]').value }))
    .filter((m) => m.name);
  return p;
}
