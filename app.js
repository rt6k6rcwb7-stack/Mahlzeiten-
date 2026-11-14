'use strict';

/* ---------- Speicher ---------- */
const STORE_KEY = 'mahlzeiten.v1';
const MEALS = [
  { id: 'breakfast', label: 'Frühstück' },
  { id: 'lunch', label: 'Mittagessen' },
  { id: 'dinner', label: 'Abendessen' },
  { id: 'snack', label: 'Snacks' },
];
const DEFAULT_STATE = {
  goals: { kcal: 2000, p: 100, c: 230, f: 70, water: 2000 },
  days: {},          // 'YYYY-MM-DD' -> { entries: [], water: 0 }
  customFoods: [],   // gleiche Struktur wie BASE_FOODS, plus id
  recent: [],        // zuletzt verwendete Lebensmittel (Snapshot)
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...s, goals: { ...DEFAULT_STATE.goals, ...(s.goals || {}) } };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}
let state = loadState();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast('Speichern fehlgeschlagen – Speicher voll?'); }
}

/* ---------- Helfer ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const r0 = n => Math.round(n);
const r1 = n => Math.round(n * 10) / 10;
const fmt = n => r0(n).toLocaleString('de-DE');
const fmt1 = n => r1(n).toLocaleString('de-DE');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isoDate = d => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const parseIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return isoDate(d); };
const today = () => isoDate(new Date());

function dateLabel(s) {
  const t = today();
  if (s === t) return 'Heute';
  if (s === addDays(t, -1)) return 'Gestern';
  if (s === addDays(t, 1)) return 'Morgen';
  return parseIso(s).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getDay(date, create = false) {
  let d = state.days[date];
  if (!d && create) d = state.days[date] = { entries: [], water: 0 };
  return d || { entries: [], water: 0 };
}

function totals(entries) {
  return entries.reduce((t, e) => ({ kcal: t.kcal + e.kcal, p: t.p + e.p, c: t.c + e.c, f: t.f + e.f }),
    { kcal: 0, p: 0, c: 0, f: 0 });
}

function scale(food, amount) {
  const k = amount / 100;
  return { kcal: food.kcal * k, p: food.p * k, c: food.c * k, f: food.f * k };
}

function defaultMeal() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18) return 'snack';
  return 'dinner';
}

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { action.fn(); el.classList.remove('show'); };
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2200);
}

/* ---------- Zustand UI ---------- */
let currentDate = today();
let currentView = 'day';

/* ---------- Tagesansicht ---------- */
function renderDay() {
  $('#dateLabel').textContent = dateLabel(currentDate);
  const day = getDay(currentDate);
  const t = totals(day.entries);
  const g = state.goals;

  // Kalorienring
  const C = 2 * Math.PI * 52;
  const ratio = g.kcal ? t.kcal / g.kcal : 0;
  const ring = $('#kcalRing');
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - Math.min(ratio, 1));
  ring.classList.toggle('over', ratio > 1);
  const left = g.kcal - t.kcal;
  $('#kcalLeft').textContent = fmt(Math.abs(left));
  $('#kcalLeftLabel').textContent = left >= 0 ? 'kcal übrig' : 'kcal drüber';
  $('#kcalEaten').textContent = fmt(t.kcal);
  $('#kcalGoal').textContent = fmt(g.kcal);

  for (const m of ['p', 'c', 'f']) {
    const el = $(`.macro[data-m="${m}"]`);
    const r = g[m] ? t[m] / g[m] : 0;
    const bar = $('.bar i', el);
    bar.style.width = Math.min(r, 1) * 100 + '%';
    bar.classList.toggle('over', r > 1.1);
    $('.m-val', el).textContent = `${fmt(t[m])} / ${fmt(g[m])} g`;
  }

  $('#waterVal').textContent = `${fmt(day.water || 0)} / ${fmt(g.water)} ml`;

  // Mahlzeiten
  const wrap = $('#meals');
  wrap.innerHTML = '';
  for (const meal of MEALS) {
    const list = day.entries.filter(e => e.meal === meal.id);
    const mt = totals(list);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="meal-head"><h2 style="margin:0">${meal.label}</h2><span class="kcal">${list.length ? fmt(mt.kcal) + ' kcal' : ''}</span></div>
      <ul class="entries">${list.map(e => `
        <li class="entry">
          <div class="e-main">
            <div class="e-name">${esc(e.name)}</div>
            <div class="e-sub">${e.amount ? fmt(e.amount) + ' ' + e.unit + ' · ' : ''}E ${fmt1(e.p)} · KH ${fmt1(e.c)} · F ${fmt1(e.f)}</div>
          </div>
          <div class="e-right">${fmt(e.kcal)} kcal<button class="del-btn" data-del="${e.id}" aria-label="Löschen">✕</button></div>
        </li>`).join('')}
      </ul>
      <button class="add-btn" data-add="${meal.id}">+ Hinzufügen</button>`;
    wrap.append(card);
  }
}

$('#meals').addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) return openAdd(add.dataset.add);
  const del = e.target.closest('[data-del]');
  if (del) deleteEntry(del.dataset.del);
});

function deleteEntry(id) {
  const day = getDay(currentDate, true);
  const idx = day.entries.findIndex(e => e.id === id);
  if (idx < 0) return;
  const [removed] = day.entries.splice(idx, 1);
  save(); render();
  toast(`„${removed.name}“ gelöscht`, {
    label: 'Rückgängig',
    fn: () => { day.entries.splice(idx, 0, removed); save(); render(); },
  });
}

$$('[data-water]').forEach(b => b.addEventListener('click', () => {
  const day = getDay(currentDate, true);
  day.water = Math.max(0, (day.water || 0) + Number(b.dataset.water));
  save(); renderDay();
}));

/* ---------- Datum ---------- */
$('#prevDay').onclick = () => { currentDate = addDays(currentDate, -1); render(); };
$('#nextDay').onclick = () => { currentDate = addDays(currentDate, 1); render(); };
$('#dateLabel').onclick = () => {
  const p = $('#datePicker');
  p.value = currentDate;
  if (p.showPicker) { try { p.showPicker(); return; } catch {} }
  currentDate = today(); render();
};
$('#datePicker').onchange = e => { if (e.target.value) { currentDate = e.target.value; render(); } };

/* ---------- Hinzufügen-Dialog ---------- */
const addDialog = $('#addDialog');
let addMeal = 'breakfast';
let pickSrc = 'all';
let selected = null;

function allFoods() {
  return [...state.customFoods.map(f => ({ ...f, custom: true })), ...window.BASE_FOODS];
}

function openAdd(meal) {
  addMeal = meal || defaultMeal();
  $('#addTitle').textContent = `${MEALS.find(m => m.id === addMeal).label} · ${dateLabel(currentDate)}`;
  $('#foodSearch').value = '';
  setPickSrc(state.recent.length ? 'recent' : 'all');
  showStep('pick');
  addDialog.showModal();
  setTimeout(() => $('#foodSearch').focus(), 50);
}

function showStep(step) {
  $('#pickStep').hidden = step !== 'pick';
  $('#amountStep').hidden = step !== 'amount';
}

function setPickSrc(src) {
  pickSrc = src;
  $$('#pickTabs button').forEach(b => b.classList.toggle('active', b.dataset.src === src));
  $('#quickForm').hidden = src !== 'quick';
  $('#foodResults').hidden = src === 'quick';
  $('#foodSearch').hidden = src === 'quick';
  renderResults();
}
$('#pickTabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setPickSrc(b.dataset.src);
});

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function renderResults() {
  if (pickSrc === 'quick') return;
  const q = norm($('#foodSearch').value.trim());
  let list = pickSrc === 'recent' && !q ? state.recent : allFoods();
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter(f => words.every(w => norm(f.name).includes(w)))
      .sort((a, b) => norm(a.name).indexOf(words[0]) - norm(b.name).indexOf(words[0]));
  }
  const ul = $('#foodResults');
  if (!list.length) {
    ul.innerHTML = `<li class="empty">${q ? 'Nichts gefunden. Lege es unter „Schnell“ oder in den Einstellungen an.' : 'Noch nichts eingetragen.'}</li>`;
    return;
  }
  ul.innerHTML = list.slice(0, 60).map((f, i) => `
    <li data-i="${i}">
      <div><div>${esc(f.name)}${f.custom ? ' ⭐' : ''}</div>
      <div class="fr-sub">${f.quick ? 'Schnelleintrag' : `pro 100 ${f.unit} · E ${fmt1(f.p)} · KH ${fmt1(f.c)} · F ${fmt1(f.f)}`}</div></div>
      <div class="fr-kcal">${fmt(f.kcal)} kcal</div>
    </li>`).join('');
  ul._list = list;
}
$('#foodSearch').addEventListener('input', renderResults);
$('#foodResults').addEventListener('click', e => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  const food = $('#foodResults')._list[Number(li.dataset.i)];
  if (food.quick) return addEntry({ ...food, amount: 0 });
  selectFood(food);
});

function selectFood(food) {
  selected = food;
  $('#selName').textContent = food.name;
  $('#selPer100').textContent = `pro 100 ${food.unit}: ${fmt(food.kcal)} kcal · E ${fmt1(food.p)} g · KH ${fmt1(food.c)} g · F ${fmt1(food.f)} g`;
  $('#selUnit').textContent = food.unit;
  const amt = food.lastAmount || food.portion || 100;
  $('#amount').value = amt;
  const chips = [...new Set([food.portion, 50, 100, 150, 200].filter(Boolean))].sort((a, b) => a - b);
  $('#portionChips').innerHTML = chips.map(c =>
    `<button type="button" class="chip" data-amt="${c}">${c} ${food.unit}${c === food.portion ? ' (Portion)' : ''}</button>`).join('');
  updatePreview();
  showStep('amount');
  setTimeout(() => $('#amount').select(), 50);
}
$('#portionChips').addEventListener('click', e => {
  const b = e.target.closest('[data-amt]');
  if (b) { $('#amount').value = b.dataset.amt; updatePreview(); }
});
$('#amount').addEventListener('input', updatePreview);
$('#amount').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirmAmount(); } });

function updatePreview() {
  const a = parseFloat($('#amount').value) || 0;
  const n = scale(selected, a);
  $('#amountPreview').textContent = `${fmt(n.kcal)} kcal · E ${fmt1(n.p)} g · KH ${fmt1(n.c)} g · F ${fmt1(n.f)} g`;
}

$('#backBtn').onclick = () => showStep('pick');
$('#confirmAddBtn').onclick = confirmAmount;

function confirmAmount() {
  const a = parseFloat($('#amount').value);
  if (!(a > 0)) { $('#amount').focus(); return; }
  addEntry({ ...selected, amount: a });
}

$('#quickAddBtn').onclick = () => {
  const f = $('#addForm');
  const num = n => parseFloat(f.elements[n].value) || 0;
  const kcal = num('qKcal');
  if (!kcal && !num('qP') && !num('qC') && !num('qF')) { f.elements.qKcal.focus(); return; }
  addEntry({ name: f.elements.qName.value.trim() || 'Schnelleintrag', kcal, p: num('qP'), c: num('qC'), f: num('qF'), quick: true, amount: 0 });
  ['qName', 'qKcal', 'qP', 'qC', 'qF'].forEach(n => f.elements[n].value = '');
};

function addEntry(food) {
  const vals = food.quick ? { kcal: food.kcal, p: food.p, c: food.c, f: food.f } : scale(food, food.amount);
  const day = getDay(currentDate, true);
  day.entries.push({
    id: uid(), meal: addMeal, name: food.name,
    amount: food.quick ? 0 : food.amount, unit: food.unit || '',
    kcal: r1(vals.kcal), p: r1(vals.p), c: r1(vals.c), f: r1(vals.f),
  });
  // Zuletzt verwendet
  const snap = food.quick
    ? { name: food.name, kcal: food.kcal, p: food.p, c: food.c, f: food.f, quick: true }
    : { name: food.name, kcal: food.kcal, p: food.p, c: food.c, f: food.f, unit: food.unit, portion: food.portion, lastAmount: food.amount, custom: food.custom };
  state.recent = [snap, ...state.recent.filter(r => r.name !== food.name)].slice(0, 30);
  save();
  addDialog.close();
  render();
  toast(`${food.name} eingetragen`);
}

/* ---------- Verlauf ---------- */
function renderHistory() {
  const g = state.goals;
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const vals = days.map(d => totals(getDay(d).entries).kcal);
  const max = Math.max(g.kcal * 1.2, ...vals, 1);
  const chart = $('#weekChart');
  chart.innerHTML = `<div class="goal-line" style="bottom:${(g.kcal / max) * 120 + 18}px" title="Ziel"></div>` +
    days.map((d, i) => `
      <div class="wc-col" data-date="${d}">
        <span class="wc-val">${vals[i] ? fmt(vals[i]) : ''}</span>
        <div class="wc-bar ${!vals[i] ? 'empty' : vals[i] > g.kcal ? 'over' : ''}" style="height:${(vals[i] / max) * 120}px"></div>
        <span class="wc-label">${parseIso(d).toLocaleDateString('de-DE', { weekday: 'short' })}</span>
      </div>`).join('');
  const logged = vals.filter(Boolean);
  $('#weekAvg').textContent = logged.length
    ? `Ø ${fmt(logged.reduce((a, b) => a + b, 0) / logged.length)} kcal an ${logged.length} erfassten Tagen (Ziel ${fmt(g.kcal)})`
    : 'Noch keine Einträge in den letzten 7 Tagen.';

  const items = [];
  for (let i = 0; i < 30; i++) {
    const d = addDays(t, -i);
    const day = state.days[d];
    if (!day || !day.entries.length) continue;
    const tt = totals(day.entries);
    items.push(`<li data-date="${d}"><span>${dateLabel(d)}</span><span class="muted">E ${fmt(tt.p)} · KH ${fmt(tt.c)} · F ${fmt(tt.f)}</span><strong>${fmt(tt.kcal)} kcal</strong></li>`);
  }
  $('#historyList').innerHTML = items.join('') || '<li class="muted">Noch keine Einträge.</li>';
}
function jumpTo(e) {
  const el = e.target.closest('[data-date]');
  if (!el) return;
  currentDate = el.dataset.date;
  setView('day');
}
$('#weekChart').addEventListener('click', jumpTo);
$('#historyList').addEventListener('click', jumpTo);

/* ---------- Einstellungen ---------- */
const goalsForm = $('#goalsForm');
function renderSettings() {
  for (const k of Object.keys(state.goals)) goalsForm.elements[k].value = state.goals[k];
  $('#customFoodList').innerHTML = state.customFoods.map(f => `
    <li><div><div>${esc(f.name)}</div><div class="muted">${fmt(f.kcal)} kcal / 100 ${f.unit}</div></div>
    <button class="del-btn" data-delfood="${f.id}" aria-label="Löschen">✕</button></li>`).join('');
}
goalsForm.addEventListener('submit', e => {
  e.preventDefault();
  for (const k of Object.keys(state.goals)) state.goals[k] = Math.max(0, Number(goalsForm.elements[k].value) || 0);
  save(); toast('Ziele gespeichert');
});

const foodDialog = $('#foodDialog');
$('#newFoodBtn').onclick = () => { $('#foodForm').reset(); foodDialog.showModal(); };
$('#foodForm').addEventListener('submit', e => {
  if (e.submitter?.value !== 'save') return;
  const f = e.target.elements;
  state.customFoods.unshift({
    id: uid(), name: f.name.value.trim(), unit: f.unit.value,
    portion: Number(f.portion.value) || 100,
    kcal: Number(f.kcal.value) || 0, p: Number(f.p.value) || 0, c: Number(f.c.value) || 0, f: Number(f.f.value) || 0,
  });
  save(); renderSettings(); toast('Lebensmittel gespeichert');
});
$('#customFoodList').addEventListener('click', e => {
  const b = e.target.closest('[data-delfood]');
  if (!b) return;
  state.customFoods = state.customFoods.filter(f => f.id !== b.dataset.delfood);
  save(); renderSettings();
});

$('#exportBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mahlzeiten-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#importFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data.days !== 'object') throw new Error();
    if (!confirm('Aktuelle Daten durch das Backup ersetzen?')) return;
    state = { ...structuredClone(DEFAULT_STATE), ...data, goals: { ...DEFAULT_STATE.goals, ...(data.goals || {}) } };
    save(); render(); toast('Backup importiert');
  } catch {
    toast('Datei konnte nicht gelesen werden');
  } finally {
    e.target.value = '';
  }
};

/* ---------- Navigation ---------- */
function setView(v) {
  currentView = v;
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $('.topbar').style.visibility = v === 'day' ? 'visible' : 'hidden';
  render();
  window.scrollTo(0, 0);
}
$$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));

function render() {
  if (currentView === 'day') renderDay();
  else if (currentView === 'history') renderHistory();
  else renderSettings();
}

// Dialoge per Klick auf den Hintergrund schließen
for (const d of [addDialog, foodDialog]) {
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}
$('#foodSearch').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('#foodResults li[data-i]')?.click();
});

// Datum aktualisieren, wenn die App über Mitternacht offen bleibt
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
