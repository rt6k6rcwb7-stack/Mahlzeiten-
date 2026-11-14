'use strict';

/* ---------- Speicher ---------- */
const STORE_KEY = 'mahlzeiten.v1';
const MEALS = [
  { id: 'breakfast', label: 'Frühstück', icon: '🥣', tint: '#e6a23c' },
  { id: 'lunch', label: 'Mittagessen', icon: '🥗', tint: '#2e9e6b' },
  { id: 'dinner', label: 'Abendessen', icon: '🍝', tint: '#de5b70' },
  { id: 'snack', label: 'Snacks', icon: '🍎', tint: '#3d7be0' },
];
const PLUS_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
const DEFAULT_STATE = {
  goals: { kcal: 2000, p: 100, c: 230, f: 70, fib: 30, sug: 50, salt: 6, water: 2000, weight: 0, weightDate: '', actFactor: 1 },
  days: {},          // 'YYYY-MM-DD' -> { entries: [], water: 0 }
  customFoods: [],   // gleiche Struktur wie BASE_FOODS, plus id
  recent: [],        // zuletzt verwendete Lebensmittel (Snapshot)
  dishes: [],        // gespeicherte Gerichte: { id, name, portions, ingredients: [...] }
  weights: [],       // Messungen: { id, ts: 'YYYY-MM-DDTHH:MM', date, kg, fat (%), source }
  profile: {},       // Angaben für den Zielrechner
  ui: { accent: 'green', theme: 'auto' }, // Darstellung
  recentActivities: [], // zuletzt genutzte Aktivitäten
};

// Alle erfassten Nährwerte (pro 100 g/ml bzw. absolut in Einträgen)
const NUTR = ['kcal', 'p', 'c', 'f', 'fib', 'sug', 'salt'];
const mapN = (o, fn) => Object.fromEntries(NUTR.map(k => [k, fn(Number(o?.[k]) || 0, k)]));
const pickN = o => mapN(o, v => v);
const zeroN = () => mapN({}, () => 0);
const addN = (a, b) => mapN(a, (v, k) => v + (Number(b?.[k]) || 0));
const roundN = o => mapN(o, (v, k) => k === 'salt' ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10);

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
  return entries.reduce(addN, zeroN());
}

// Verbrauch durch Aktivitäten an einem Tag
function burnedOn(date) {
  return (state.days[date]?.activities || []).reduce((s, a) => s + (Number(a.kcal) || 0), 0);
}

// Tagesziele inkl. angerechneter Aktivitätskalorien (Mehr-kcal gehen in KH und Fett, Eiweiß bleibt)
function effGoals(date) {
  const g = state.goals;
  const factor = g.actFactor ?? 1;
  const extra = Math.round(burnedOn(date) * factor);
  if (!extra || !g.kcal) return { ...g, extra: 0 };
  const cK = g.c * 4, fK = g.f * 9;
  const share = cK + fK > 0 ? cK / (cK + fK) : 0.6;
  return { ...g, extra, kcal: g.kcal + extra, c: g.c + (extra * share) / 4, f: g.f + (extra * (1 - share)) / 9 };
}

function scale(food, amount) {
  const k = amount / 100;
  return mapN(food, v => v * k);
}

// Nährwerte für eine Menge: Lebensmittel pro 100 g/ml, Gerichte pro Portion
function nutr(food, amount) {
  if (food.kind === 'dish') return mapN(food, v => v * amount);
  return scale(food, amount);
}

function amountLabel(e) {
  if (!e.amount) return '';
  if (e.unit === 'Portion') return `${fmt1(e.amount)} ${e.amount === 1 ? 'Portion' : 'Portionen'}`;
  return `${fmt(e.amount)} ${e.unit}`;
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
  const isToday = currentDate === today();
  $('#dateLabel').textContent = dateLabel(currentDate);
  $('#dateSub').textContent = parseIso(currentDate).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#todayBtn').hidden = isToday;
  const day = getDay(currentDate);
  const t = totals(day.entries);
  const g = effGoals(currentDate);

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
  $('#kcalAct').textContent = g.extra ? `(inkl. +${fmt(g.extra)} Aktivität)` : '';
  $('#kcalActVal').textContent = g.extra ? `+${fmt(g.extra)}` : '0';
  renderActivities();

  for (const m of ['p', 'c', 'f']) {
    const el = $(`.macro[data-m="${m}"]`);
    const r = g[m] ? t[m] / g[m] : 0;
    const bar = $('.bar i', el);
    bar.style.width = Math.min(r, 1) * 100 + '%';
    bar.classList.toggle('over', r > 1.1);
    $('.m-val', el).textContent = `${fmt(t[m])} / ${fmt(g[m])} g`;
  }

  // Weitere Nährstoffe (Ballaststoffe = Mindestziel, Zucker/Salz = Maximum)
  let anyExtra = false;
  for (const m of ['fib', 'sug', 'salt']) {
    const el = $(`.macro[data-m="${m}"]`);
    el.hidden = !g[m];
    if (!g[m]) continue;
    anyExtra = true;
    const r = t[m] / g[m];
    const bar = $('.bar i', el);
    bar.style.width = Math.min(r, 1) * 100 + '%';
    bar.classList.toggle('over', m !== 'fib' && r > 1);
    bar.classList.toggle('done', m === 'fib' && r >= 1);
    const v = m === 'salt' ? fmt1(t[m]) : fmt(t[m]);
    $('.m-val', el).textContent = `${v} / ${m === 'salt' ? fmt1(g[m]) : fmt(g[m])} g`;
  }
  $('#nutrientCard').hidden = !anyExtra;

  const streak = currentDate === today() ? currentStreak(d => dayStatus(d).kcal === true) : 0;
  $('#streakLine').hidden = streak < 2;
  $('#streakLine').textContent = `🔥 ${streak} Tage in Folge im Kalorienziel`;

  $('#waterVal').textContent = `${fmt1((day.water || 0) / 1000)} von ${fmt1(g.water / 1000)} Litern`;
  // Gläser à 250 ml (4 bis 12 Symbole)
  const glassMl = 250;
  const nGlasses = Math.min(12, Math.max(4, Math.ceil((g.water || 2000) / glassMl)));
  const water = day.water || 0;
  $('#glasses').innerHTML = Array.from({ length: nGlasses }, (_, i) => {
    const fill = Math.max(0, Math.min(1, (water - i * glassMl) / glassMl));
    return `<button class="glass" data-glass="${i + 1}" style="--fill:${Math.round(fill * 100)}%" aria-label="${(i + 1) * glassMl} ml"></button>`;
  }).join('');
  const wToday = latestWeightOn(currentDate);
  const wPrev = wToday || [...sortedWeights()].reverse().find(w => w.date < currentDate);
  $('#weightVal').textContent = wToday ? `${fmtKg(wToday.kg)} kg`
    : wPrev ? `zuletzt ${fmtKg(wPrev.kg)} kg · ${dateLabel(wPrev.date)}` : 'noch nichts eingetragen';

  // Mahlzeiten
  const wrap = $('#meals');
  wrap.innerHTML = '';
  for (const meal of MEALS) {
    const list = day.entries.filter(e => e.meal === meal.id);
    const mt = totals(list);
    const card = document.createElement('div');
    card.className = 'card meal-card';
    card.innerHTML = `
      <div class="card-title">
        <span class="ct-icon" style="--tint:${meal.tint}">${meal.icon}</span>
        <div class="ct-text"><h2>${meal.label}</h2><span class="ct-sub">${list.length ? `${fmt(mt.kcal)} kcal · ${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}` : 'Noch nichts eingetragen'}</span></div>
        <button class="add-round" data-add="${meal.id}" aria-label="${meal.label}: hinzufügen">${PLUS_SVG}</button>
      </div>
      <ul class="entries">${list.map(e => `
        <li class="entry">
          <div class="e-main">
            <div class="e-name">${esc(e.name)}</div>
            <div class="e-sub">${e.amount ? amountLabel(e) + ' · ' : ''}E ${fmt1(e.p)} · KH ${fmt1(e.c)} · F ${fmt1(e.f)}</div>
          </div>
          <div class="e-right">${fmt(e.kcal)} kcal<button class="del-btn" data-del="${e.id}" aria-label="Löschen">✕</button></div>
        </li>`).join('')}
      </ul>
      ${list.length >= 2 ? `<button class="link-btn" data-savedish="${meal.id}">🍲 Als Gericht speichern</button>` : ''}`;
    wrap.append(card);
  }
}

$('#meals').addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) return openAdd(add.dataset.add);
  const del = e.target.closest('[data-del]');
  if (del) return deleteEntry(del.dataset.del);
  const sd = e.target.closest('[data-savedish]');
  if (sd) saveMealAsDish(sd.dataset.savedish);
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
// Tippen auf ein Glas setzt die Menge bis zu diesem Glas (erneutes Tippen auf das letzte volle Glas leert es)
$('#glasses').addEventListener('click', e => {
  const b = e.target.closest('[data-glass]');
  if (!b) return;
  const day = getDay(currentDate, true);
  const ml = Number(b.dataset.glass) * 250;
  day.water = (day.water || 0) === ml ? ml - 250 : ml;
  save(); renderDay();
});

/* ---------- Datum ---------- */
$('#prevDay').onclick = () => { currentDate = addDays(currentDate, -1); render(); };
$('#nextDay').onclick = () => { currentDate = addDays(currentDate, 1); render(); };
$('#todayBtn').onclick = () => { currentDate = today(); render(); };
$('#dateBtn').onclick = () => {
  if (currentView !== 'day') return;
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
  $('#searchRow').hidden = src === 'quick';
  renderResults();
}
$('#pickTabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setPickSrc(b.dataset.src);
});

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function filterByQuery(list, rawQuery) {
  const q = norm(rawQuery.trim());
  if (!q) return list;
  const words = q.split(/\s+/);
  return list.filter(f => words.every(w => norm(f.name).includes(w)))
    .sort((a, b) => norm(a.name).indexOf(words[0]) - norm(b.name).indexOf(words[0]));
}

function foodRowHtml(f, i, withEdit = false) {
  const icon = f.kind === 'dish' ? ' 🍲' : f.barcode ? ' 📦' : f.custom ? ' ⭐' : '';
  const sub = f.kind === 'dish'
    ? `Gericht · ${f.ingredientCount} Zutat${f.ingredientCount === 1 ? '' : 'en'} · pro Portion`
    : f.quick ? 'Schnelleintrag' : `pro 100 ${f.unit} · E ${fmt1(f.p)} · KH ${fmt1(f.c)} · F ${fmt1(f.f)}`;
  const edit = withEdit && f.kind === 'dish'
    ? `<button type="button" class="del-btn edit-btn" data-edit-dish="${f.id}" aria-label="Gericht bearbeiten">✎</button>` : '';
  return `
    <li data-i="${i}">
      <div><div>${esc(f.name)}${icon}</div><div class="fr-sub">${sub}</div></div>
      <div class="fr-right"><span class="fr-kcal">${fmt(f.kcal)} kcal</span>${edit}</div>
    </li>`;
}

function renderResults() {
  if (pickSrc === 'quick') return;
  const rawQ = $('#foodSearch').value;
  const q = rawQ.trim();
  const dishes = state.dishes.map(dishToFood);
  let list;
  if (pickSrc === 'dishes') list = filterByQuery(dishes, rawQ);
  else if (pickSrc === 'recent' && !q) list = state.recent.map(freshRecent);
  else list = filterByQuery([...dishes, ...allFoods()], rawQ);
  const ul = $('#foodResults');
  const newDish = pickSrc === 'dishes' ? `<li class="new-dish" data-new-dish><div><strong>+ Neues Gericht anlegen</strong></div></li>` : '';
  if (!list.length) {
    const msg = pickSrc === 'dishes'
      ? (q ? 'Kein passendes Gericht.' : 'Noch keine Gerichte. Speichere eine Mahlzeit als Gericht oder lege eins an.')
      : q ? 'Nichts gefunden. Lege es unter „Schnell“ oder in den Einstellungen an.' : 'Noch nichts eingetragen.';
    ul.innerHTML = `<li class="empty">${msg}</li>` + newDish;
    ul._list = [];
    return;
  }
  ul.innerHTML = list.slice(0, 60).map((f, i) => foodRowHtml(f, i, pickSrc === 'dishes')).join('') + newDish;
  ul._list = list;
}

// Einträge aus „Zuletzt“ für Gerichte mit dem aktuellen Stand des Gerichts verknüpfen
function freshRecent(r) {
  if (r.kind !== 'dish') return r;
  const d = state.dishes.find(x => x.id === r.id);
  return d ? { ...dishToFood(d), lastAmount: r.lastAmount } : r;
}
$('#foodSearch').addEventListener('input', renderResults);
$('#foodResults').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit-dish]');
  if (edit) return openDishEditor(state.dishes.find(d => d.id === edit.dataset.editDish));
  if (e.target.closest('[data-new-dish]')) return openDishEditor();
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  const food = $('#foodResults')._list[Number(li.dataset.i)];
  if (food.quick) return addEntry({ ...food, amount: 0 });
  selectFood(food);
});

function selectFood(food) {
  selected = food;
  const isDish = food.kind === 'dish';
  $('#selName').textContent = food.name;
  $('#selPer100').textContent = isDish
    ? `pro Portion: ${fmt(food.kcal)} kcal · E ${fmt1(food.p)} g · KH ${fmt1(food.c)} g · F ${fmt1(food.f)} g` +
      (food.ingredientNames ? ` · ${food.ingredientNames}` : '')
    : `pro 100 ${food.unit}: ${fmt(food.kcal)} kcal · E ${fmt1(food.p)} g · KH ${fmt1(food.c)} g · F ${fmt1(food.f)} g`;
  $('#selUnit').textContent = isDish ? 'Portionen' : food.unit;
  $('#amount').step = isDish ? '0.25' : '1';
  const amt = food.lastAmount || food.portion || 100;
  $('#amount').value = amt;
  const chips = isDish ? [0.5, 1, 1.5, 2]
    : [...new Set([food.portion, 50, 100, 150, 200].filter(Boolean))].sort((a, b) => a - b);
  $('#portionChips').innerHTML = chips.map(c => isDish
    ? `<button type="button" class="chip" data-amt="${c}">${fmt1(c)} ${c === 1 ? 'Portion' : 'Portionen'}</button>`
    : `<button type="button" class="chip" data-amt="${c}">${c} ${food.unit}${c === food.portion ? ' (Portion)' : ''}</button>`).join('');
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
  const n = nutr(selected, a);
  const extra = [n.fib >= 0.05 && `Ballaststoffe ${fmt1(n.fib)} g`, n.sug >= 0.05 && `Zucker ${fmt1(n.sug)} g`, n.salt >= 0.05 && `Salz ${fmt1(n.salt)} g`].filter(Boolean);
  $('#amountPreview').innerHTML = `${fmt(n.kcal)} kcal · E ${fmt1(n.p)} g · KH ${fmt1(n.c)} g · F ${fmt1(n.f)} g` +
    (extra.length ? `<br><span class="muted">${extra.join(' · ')}</span>` : '');
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
  const vals = food.quick ? pickN(food) : nutr(food, food.amount);
  const day = getDay(currentDate, true);
  day.entries.push({
    id: uid(), meal: addMeal, name: food.name,
    amount: food.quick ? 0 : food.amount, unit: food.unit || '',
    ...roundN(vals),
  });
  // Zuletzt verwendet
  const snap = food.quick
    ? { name: food.name, ...pickN(food), quick: true }
    : food.kind === 'dish'
    ? { ...food, lastAmount: food.amount, amount: undefined }
    : { name: food.name, ...pickN(food), unit: food.unit, portion: food.portion, lastAmount: food.amount, custom: food.custom };
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
        <div class="wc-bar ${!vals[i] ? 'empty' : vals[i] > effGoals(d).kcal ? 'over' : ''}" style="height:${(vals[i] / max) * 120}px"></div>
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
    const burned = burnedOn(d);
    items.push(`<li data-date="${d}"><span>${dateLabel(d)}</span><span class="muted">E ${fmt(tt.p)} · KH ${fmt(tt.c)} · F ${fmt(tt.f)}${burned ? ` · 🏃 ${fmt(burned)}` : ''}</span><strong>${fmt(tt.kcal)} kcal</strong></li>`);
  }
  $('#historyList').innerHTML = items.join('') || '<li class="muted">Noch keine Einträge.</li>';
  renderGoalProgress();
  renderWeight();
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
  if (!calcForm.contains(document.activeElement)) fillCalcForm();
  for (const k of Object.keys(state.goals)) {
    if (!goalsForm.elements[k]) continue;
    goalsForm.elements[k].value = (k === 'weight' && !state.goals[k]) ? '' : state.goals[k];
  }
  renderCalc();
  $('#dishList').innerHTML = state.dishes.map(d => {
    const f = dishToFood(d);
    return `<li data-dish="${d.id}"><div><div>${esc(d.name)}</div>
      <div class="muted">${fmt(f.kcal)} kcal pro Portion · ${d.portions} Portion${d.portions === 1 ? '' : 'en'} · ${d.ingredients.length} Zutaten</div></div>
      <span class="muted">✎</span></li>`;
  }).join('');
  $('#customFoodList').innerHTML = state.customFoods.map(f => `
    <li><div><div>${esc(f.name)}</div><div class="muted">${fmt(f.kcal)} kcal / 100 ${f.unit}</div></div>
    <button class="del-btn" data-delfood="${f.id}" aria-label="Löschen">✕</button></li>`).join('');
}
goalsForm.addEventListener('submit', e => {
  e.preventDefault();
  for (const k of Object.keys(state.goals)) {
    const el = goalsForm.elements[k];
    if (!el) continue;
    state.goals[k] = k === 'weightDate' ? el.value : Math.max(0, Number(el.value) || 0);
  }
  renderCalc();
  save(); toast('Ziele gespeichert');
});

const foodDialog = $('#foodDialog');
let selectAfterFoodSave = false;
function openFoodDialog(prefill = {}, selectAfterSave = false, message = '') {
  const form = $('#foodForm');
  form.reset();
  form.elements.barcode.value = prefill.barcode || '';
  if (prefill.name) form.elements.name.value = prefill.name;
  const info = $('#foodBarcodeInfo');
  info.hidden = !prefill.barcode && !message;
  info.textContent = [message, prefill.barcode ? `Barcode ${prefill.barcode} – beim nächsten Scan wird das Produkt direkt erkannt.` : '']
    .filter(Boolean).join(' ');
  selectAfterFoodSave = selectAfterSave;
  foodDialog.showModal();
}
$('#newFoodBtn').onclick = () => openFoodDialog();
$('#foodForm').addEventListener('submit', e => {
  if (e.submitter?.value !== 'save') return;
  const f = e.target.elements;
  const food = saveCustomFood({
    name: f.name.value.trim(), unit: f.unit.value,
    portion: Number(f.portion.value) || 100,
    ...mapN({}, (_, k) => Number(f[k].value) || 0),
    barcode: f.barcode.value || undefined,
  });
  renderSettings(); toast('Lebensmittel gespeichert');
  if (selectAfterFoodSave) deliverScanned({ ...food, custom: true });
  selectAfterFoodSave = false;
});

function saveCustomFood(food) {
  const entry = { id: uid(), ...food };
  state.customFoods = [entry, ...state.customFoods.filter(x => !food.barcode || x.barcode !== food.barcode)];
  save();
  return entry;
}
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
    save(); applyTheme(); render(); toast('Backup importiert');
  } catch {
    toast('Datei konnte nicht gelesen werden');
  } finally {
    e.target.value = '';
  }
};

/* ---------- Darstellung ---------- */
function applyTheme() {
  const ui = { accent: 'green', theme: 'auto', ...(state.ui || {}) };
  const root = document.documentElement;
  if (ui.accent !== 'green') root.dataset.accent = ui.accent; else root.removeAttribute('data-accent');
  if (ui.theme === 'light' || ui.theme === 'dark') root.dataset.theme = ui.theme; else root.removeAttribute('data-theme');
  $$('#accentSwatches button').forEach(b => b.classList.toggle('active', b.dataset.accent === ui.accent));
  $$('#themeMode button').forEach(b => b.classList.toggle('active', b.dataset.theme === ui.theme));
  // Statusleiste an den Hintergrund anpassen
  requestAnimationFrame(() => {
    document.querySelector('meta[name="theme-color"]').setAttribute('content', getComputedStyle(document.body).backgroundColor);
  });
}
$('#accentSwatches').addEventListener('click', e => {
  const b = e.target.closest('[data-accent]');
  if (!b) return;
  state.ui = { ...(state.ui || {}), accent: b.dataset.accent };
  save(); applyTheme();
});
$('#themeMode').addEventListener('click', e => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  state.ui = { ...(state.ui || {}), theme: b.dataset.theme };
  save(); applyTheme();
});
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ---------- Navigation ---------- */
function setView(v) {
  currentView = v;
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  const titles = { history: ['Verlauf', 'Ziele, Kalorien & Gewicht'], settings: ['Einstellungen', 'Ziele, Lebensmittel & Daten'] };
  $('#topbar').classList.toggle('static', v !== 'day');
  $('#dayNav').hidden = v !== 'day';
  if (v !== 'day') { $('#dateLabel').textContent = titles[v][0]; $('#dateSub').textContent = titles[v][1]; }
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
/* ---------- Barcode-Scanner ---------- */
const scanDialog = $('#scanDialog');
const scanVideo = $('#scanVideo');
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let scanStream = null;
let scanTimer = null;
let scanBusy = false;
let detectorPromise = null;

const setScanStatus = msg => { $('#scanStatus').textContent = msg; };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('load ' + src));
    document.head.append(el);
  });
}

// Natives BarcodeDetector (Android/Chrome) oder lokale WebAssembly-Variante (z. B. iPhone)
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          if (BARCODE_FORMATS.some(f => supported.includes(f))) {
            return new window.BarcodeDetector({ formats: BARCODE_FORMATS.filter(f => supported.includes(f)) });
          }
        } catch {}
      }
      if (!window.BarcodeDetectionAPI) await loadScript('vendor/barcode-detector.js');
      const api = window.BarcodeDetectionAPI;
      const wasmUrl = new URL('vendor/zxing_reader.wasm', location.href).href;
      api.setZXingModuleOverrides({ locateFile: (path, prefix) => path.endsWith('.wasm') ? wasmUrl : prefix + path });
      await api.prepareZXingModule({ fireImmediately: true });
      return new api.BarcodeDetector({ formats: BARCODE_FORMATS });
    })();
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

let scanTarget = 'add';
function deliverScanned(food) {
  if (scanTarget === 'dish' && dishDialog.open) addIngredient(food);
  else if (addDialog.open) selectFood(food);
}

async function openScanner(target = 'add') {
  scanTarget = target;
  $('#manualCode').value = '';
  setScanStatus('Kamera wird gestartet …');
  scanDialog.showModal();
  if (!navigator.mediaDevices?.getUserMedia) {
    setScanStatus('Kamera wird von diesem Browser nicht unterstützt. Gib die Nummer unten ein.');
    return;
  }
  try {
    const [stream, detector] = await Promise.all([
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      }),
      getDetector(),
    ]);
    if (!scanDialog.open) { stream.getTracks().forEach(t => t.stop()); return; }
    scanStream = stream;
    scanVideo.srcObject = stream;
    await scanVideo.play();
    setScanStatus('Halte den Barcode in den Rahmen.');
    scanLoop(detector);
  } catch (err) {
    console.warn(err);
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    setScanStatus(denied
      ? 'Kein Kamerazugriff. Erlaube die Kamera in den Browser-Einstellungen oder gib die Nummer unten ein.'
      : 'Kamera konnte nicht gestartet werden. Gib die Nummer unten ein.');
  }
}

function scanLoop(detector) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(async () => {
    if (!scanStream || !scanDialog.open) return;
    if (scanVideo.readyState >= 2 && !scanBusy) {
      try {
        const codes = await detector.detect(scanVideo);
        const code = codes.find(c => /^\d{6,14}$/.test(c.rawValue));
        if (code) {
          navigator.vibrate?.(60);
          stopCamera();
          return lookupBarcode(code.rawValue);
        }
      } catch (err) { console.warn(err); }
    }
    scanLoop(detector);
  }, 180);
}

function stopCamera() {
  clearTimeout(scanTimer);
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  scanStream = null;
  scanVideo.srcObject = null;
}
scanDialog.addEventListener('close', stopCamera);

$('#scanBtn').onclick = () => openScanner('add');
$('#manualCodeForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('#manualCode').value.replace(/\D/g, '');
  if (code.length < 6) { setScanStatus('Bitte eine gültige Barcode-Nummer eingeben (8–13 Ziffern).'); return; }
  stopCamera();
  lookupBarcode(code);
});

// Gleiche Codes können als EAN-13 (mit führender 0) oder UPC-A vorliegen
const sameBarcode = (a, b) => a.replace(/^0+/, '') === b.replace(/^0+/, '');

async function fetchProduct(code) {
  const fields = 'product_name,product_name_de,generic_name_de,brands,nutriments,serving_quantity,product_quantity_unit,quantity';
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}&lc=de`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return data.status === 1 ? data.product : null;
}

function productToFood(code, p) {
  const n = p.nutriments || {};
  const num = v => (v === undefined || v === null || v === '' || isNaN(Number(v))) ? null : Number(v);
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null && num(n['energy_100g']) !== null) kcal = num(n['energy_100g']) / 4.184; // kJ -> kcal
  const brand = (p.brands || '').split(',')[0].trim();
  let name = (p.product_name_de || p.product_name || p.generic_name_de || '').trim();
  if (brand && name && !norm(name).includes(norm(brand))) name += ` (${brand})`;
  if (!name) name = brand;
  const unit = (p.product_quantity_unit === 'ml' || /\d\s*(ml|cl|l)\b/i.test(p.quantity || '')) ? 'ml' : 'g';
  const portion = num(p.serving_quantity);
  return {
    complete: kcal !== null && !!name,
    food: {
      name: name || '', unit, portion: portion && portion > 0 ? r1(portion) : 100, barcode: code,
      ...roundN({ kcal: kcal ?? 0, p: num(n.proteins_100g), c: num(n.carbohydrates_100g), f: num(n.fat_100g),
        fib: num(n.fiber_100g), sug: num(n.sugars_100g), salt: num(n.salt_100g) ?? (num(n.sodium_100g) !== null ? num(n.sodium_100g) * 2.5 : 0) }),
    },
  };
}

async function lookupBarcode(code) {
  const known = state.customFoods.find(f => f.barcode && sameBarcode(f.barcode, code));
  if (known) {
    scanDialog.close();
    return deliverScanned({ ...known, custom: true });
  }
  scanBusy = true;
  setScanStatus(`Suche Produkt ${code} …`);
  try {
    const product = await fetchProduct(code);
    if (!scanDialog.open) return;
    if (!product) {
      scanDialog.close();
      return openFoodDialog({ barcode: code }, true, 'Produkt nicht in der Datenbank – trag die Werte von der Packung ein.');
    }
    const { complete, food } = productToFood(code, product);
    scanDialog.close();
    if (!complete) {
      return openFoodDialog({ barcode: code, name: food.name }, true, 'Nährwerte unvollständig – bitte von der Packung ergänzen.');
    }
    const saved = saveCustomFood(food);
    deliverScanned({ ...saved, custom: true });
  } catch (err) {
    console.warn(err);
    if (!scanDialog.open) return;
    scanDialog.close();
    openFoodDialog({ barcode: code }, true, 'Keine Verbindung zur Produktdatenbank – trag die Werte von der Packung ein.');
  } finally {
    scanBusy = false;
  }
}

/* ---------- Aktivitäten ---------- */
const actDialog = $('#actDialog');
let actSelected = null;

// Gewicht für die Berechnung: letzte Messung bis zum Tag, sonst Profil, sonst 70 kg
function weightFor(date) {
  const w = [...state.weights].filter(x => x.date <= date).sort((a, b) => a.ts.localeCompare(b.ts)).pop()
    || [...state.weights].sort((a, b) => a.ts.localeCompare(b.ts))[0];
  if (w) return { kg: w.kg, known: true };
  const pw = Number(state.profile?.weight);
  return pw >= 30 ? { kg: pw, known: true } : { kg: 70, known: false };
}

const actKcal = (met, minutes, kg) => Math.max(0, (met - 1) * kg * (minutes / 60));

function renderActivities() {
  const list = state.days[currentDate]?.activities || [];
  const total = burnedOn(currentDate);
  $('#actTotal').textContent = list.length ? `${fmt(total)} kcal verbraucht` : '';
  $('#actList').innerHTML = list.map(a => `
    <li class="entry">
      <div class="e-main">
        <div class="e-name">${a.icon ? a.icon + ' ' : ''}${esc(a.name)}</div>
        <div class="e-sub">${a.minutes ? `${fmt(a.minutes)} min` : 'eigene Angabe'}</div>
      </div>
      <div class="e-right"><span class="burn">${fmt(a.kcal)} kcal</span><button class="del-btn" data-delact="${a.id}" aria-label="Löschen">✕</button></div>
    </li>`).join('');
  const factor = state.goals.actFactor ?? 1;
  const note = $('#actNote');
  note.hidden = !list.length || factor === 1;
  note.textContent = factor === 0 ? 'Aktivitäten werden nur angezeigt, nicht zum Ziel addiert (Einstellungen).'
    : `${fmt(factor * 100)} % davon werden zu deinem Tagesziel addiert (Einstellungen).`;
}

$('#actList').addEventListener('click', e => {
  const b = e.target.closest('[data-delact]');
  if (!b) return;
  const day = state.days[currentDate];
  const idx = day.activities.findIndex(a => a.id === b.dataset.delact);
  if (idx < 0) return;
  const [removed] = day.activities.splice(idx, 1);
  save(); render();
  toast(`„${removed.name}“ gelöscht`, { label: 'Rückgängig', fn: () => { day.activities.splice(idx, 0, removed); save(); render(); } });
});

function actStep(step) {
  $('#actPickStep').hidden = step !== 'pick';
  $('#actTimeStep').hidden = step !== 'time';
  $('#actCustomStep').hidden = step !== 'custom';
}

function openActivity() {
  $('#actTitle').textContent = `Aktivität · ${dateLabel(currentDate)}`;
  $('#actSearch').value = '';
  renderActResults();
  actStep('pick');
  actDialog.showModal();
}
$('#actAddBtn').onclick = openActivity;

function renderActResults() {
  const q = $('#actSearch').value;
  const recentNames = state.recentActivities.map(r => r.name);
  let list = filterByQuery(window.ACTIVITIES, q);
  if (!q.trim()) {
    const recent = state.recentActivities.map(r => ({ ...(window.ACTIVITIES.find(a => a.name === r.name) || r), lastMinutes: r.minutes, recent: true }));
    list = [...recent, ...window.ACTIVITIES.filter(a => !recentNames.includes(a.name))];
  }
  const kg = weightFor(currentDate).kg;
  const ul = $('#actResults');
  ul.innerHTML = `<li data-custom><div><div>✏️ Eigene Angabe</div><div class="fr-sub">Kalorien direkt eintragen, z. B. von deiner Uhr</div></div></li>` +
    list.map((a, i) => `
      <li data-i="${i}">
        <div><div>${a.icon || '🏃'} ${esc(a.name)}</div>
        <div class="fr-sub">${a.recent ? `zuletzt ${fmt(a.lastMinutes)} min · ` : ''}≈ ${fmt(actKcal(a.met, 30, kg))} kcal pro 30 min</div></div>
      </li>`).join('') +
    (!list.length ? '<li class="empty">Nichts gefunden – nutze „Eigene Angabe“.</li>' : '');
  ul._list = list;
}
$('#actSearch').addEventListener('input', renderActResults);
$('#actSearch').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('#actResults li[data-i]')?.click();
});
$('#actResults').addEventListener('click', e => {
  if (e.target.closest('[data-custom]')) {
    $('#actCustomName').value = ''; $('#actCustomKcal').value = ''; $('#actCustomMin').value = '';
    $('#actError').textContent = '';
    actStep('custom');
    setTimeout(() => $('#actCustomKcal').focus(), 50);
    return;
  }
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  actSelected = $('#actResults')._list[Number(li.dataset.i)];
  const w = weightFor(currentDate);
  $('#actSelName').textContent = `${actSelected.icon || '🏃'} ${actSelected.name}`;
  $('#actSelInfo').textContent = `Berechnet mit ${fmtKg(w.kg)} kg Körpergewicht` + (w.known ? '' : ' (Standardwert – trag dein Gewicht ein für genauere Werte)');
  $('#actMinutes').value = actSelected.lastMinutes || 30;
  $('#actChips').innerHTML = [15, 30, 45, 60, 90].map(m => `<button type="button" class="chip" data-min="${m}">${m} min</button>`).join('');
  updateActPreview();
  actStep('time');
  setTimeout(() => $('#actMinutes').select(), 50);
});
$('#actChips').addEventListener('click', e => {
  const b = e.target.closest('[data-min]');
  if (b) { $('#actMinutes').value = b.dataset.min; updateActPreview(); }
});
$('#actMinutes').addEventListener('input', updateActPreview);
$('#actMinutes').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#actConfirmBtn').click(); } });
$$('[data-act-back]').forEach(b => b.onclick = () => actStep('pick'));

function updateActPreview() {
  const min = parseFloat($('#actMinutes').value) || 0;
  $('#actPreview').textContent = `≈ ${fmt(actKcal(actSelected.met, min, weightFor(currentDate).kg))} kcal zusätzlicher Verbrauch`;
}

function addActivity(a) {
  const day = getDay(currentDate, true);
  (day.activities ||= []).push({ id: uid(), ...a, kcal: Math.round(a.kcal) });
  state.recentActivities = [{ name: a.name, minutes: a.minutes || 0, met: a.met, icon: a.icon }, ...state.recentActivities.filter(r => r.name !== a.name)].slice(0, 8);
  save();
  actDialog.close();
  render();
  const g = effGoals(currentDate);
  toast(g.extra ? `${a.name.split(' (')[0]} eingetragen – Ziel jetzt ${fmt(g.kcal)} kcal` : `${a.name.split(' (')[0]} eingetragen`);
}

$('#actConfirmBtn').onclick = () => {
  const min = parseFloat($('#actMinutes').value);
  if (!(min > 0)) { $('#actMinutes').focus(); return; }
  addActivity({ name: actSelected.name, icon: actSelected.icon, met: actSelected.met, minutes: min,
    kcal: actKcal(actSelected.met, min, weightFor(currentDate).kg) });
};
$('#actCustomBtn').onclick = () => {
  const kcal = parseFloat($('#actCustomKcal').value);
  const min = parseFloat($('#actCustomMin').value) || 0;
  if (!(kcal > 0)) { $('#actError').textContent = 'Bitte die verbrauchten Kalorien eingeben.'; $('#actCustomKcal').focus(); return; }
  addActivity({ name: $('#actCustomName').value.trim() || 'Aktivität', icon: '✏️', minutes: min, kcal });
};

/* ---------- Ziele: Status, Serien, Fortschritt ---------- */
// true = erreicht, false = verfehlt, null = nichts eingetragen / kein Ziel
function dayStatus(date) {
  const g = effGoals(date);
  const day = state.days[date];
  const logged = !!(day && day.entries.length);
  const t = logged ? totals(day.entries) : zeroN();
  const chk = (goal, ok) => (!goal || !logged) ? null : ok;
  return {
    logged,
    kcal: chk(g.kcal, t.kcal >= g.kcal * 0.8 && t.kcal <= g.kcal * 1.05),
    p: chk(g.p, t.p >= g.p * 0.9),
    fib: chk(g.fib, t.fib >= g.fib * 0.9),
    sug: chk(g.sug, t.sug <= g.sug),
    salt: chk(g.salt, t.salt <= g.salt),
    water: g.water ? ((day?.water || 0) >= g.water ? true : (logged || day?.water) ? false : null) : null,
  };
}

// Aktuelle Serie; der heutige Tag zählt erst, wenn das Ziel erreicht ist
function currentStreak(test) {
  let d = today();
  if (!test(d)) d = addDays(d, -1);
  let n = 0;
  while (test(d) && n < 3660) { n++; d = addDays(d, -1); }
  return n;
}

function longestStreak(test) {
  const dates = Object.keys(state.days).filter(d => state.days[d].entries.length).sort();
  if (!dates.length) return 0;
  let best = 0, cur = 0, d = dates[0];
  const end = today();
  while (d <= end) {
    if (test(d)) { cur++; best = Math.max(best, cur); } else cur = 0;
    d = addDays(d, 1);
  }
  return best;
}

function renderGoalProgress() {
  const g = state.goals;
  const kcalTest = d => dayStatus(d).kcal === true;
  const logTest = d => dayStatus(d).logged;
  const tiles = [
    [currentStreak(kcalTest), 'Tage in Folge im Kalorienziel', '🔥'],
    [currentStreak(logTest), 'Tage in Folge eingetragen', '📝'],
    [longestStreak(kcalTest), 'Rekord-Serie im Kalorienziel', '🏆'],
  ];
  $('#streakTiles').innerHTML = tiles.map(([n, label, icon]) =>
    `<div class="streak-tile"><strong>${icon} ${n}</strong><span>${label}</span></div>`).join('');

  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  const status = days.map(dayStatus);
  // Heute läuft noch: „noch nicht erreicht“ ist kein Verfehlen (außer Überschreitungen)
  const tToday = totals(getDay(today()).entries);
  const st = status[6];
  for (const k of ['p', 'fib', 'water']) if (st[k] === false) st[k] = 'pending';
  if (st.kcal === false && tToday.kcal < effGoals(today()).kcal * 0.8) st.kcal = 'pending';
  const rows = [
    ['kcal', 'Kalorien'], ['p', 'Eiweiß'], ['fib', 'Ballaststoffe'], ['sug', 'Zucker'], ['salt', 'Salz'], ['water', 'Wasser'],
  ].filter(([k]) => g[k]);
  const cell = v => v === true ? '<td class="ok">✓</td>' : v === false ? '<td class="no">✗</td>'
    : v === 'pending' ? '<td class="na" title="Heute noch offen">…</td>' : '<td class="na">–</td>';
  $('#goalTable').innerHTML = `
    <thead><tr><th></th>${days.map(d => `<th class="${d === today() ? 'today' : ''}">${parseIso(d).toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')}</th>`).join('')}<th>Woche</th></tr></thead>
    <tbody>${rows.map(([k, label]) => {
      const vals = status.map(s => s[k]);
      return `<tr><td>${label}</td>${vals.map(cell).join('')}<td>${vals.filter(v => v === true).length}/${vals.filter(v => v === true || v === false).length}</td></tr>`;
    }).join('')}</tbody>`;
}

/* ---------- Zielrechner ---------- */
const calcForm = $('#calcForm');
let calcSuggestion = null;

function weeksUntil(date) {
  return (parseIso(date).getTime() - parseIso(today()).getTime()) / (7 * 86400000);
}

function computeGoals(pr) {
  const age = Number(pr.age), h = Number(pr.height), w = Number(pr.weight), act = Number(pr.activity) || 1.2;
  if (!(age >= 14 && age <= 100 && h >= 120 && h <= 230 && w >= 30 && w <= 300)) return null;
  const bmr = 10 * w + 6.25 * h - 5 * age + (pr.sex === 'm' ? 5 : -161);
  const tdee = bmr * act;
  const notes = [];
  let delta = 0;
  if (pr.aim === 'target') {
    const goal = Number(state.goals.weight), date = state.goals.weightDate;
    if (!goal || !date) return { error: 'Trag unten bei den Tageszielen ein Zielgewicht und ein Zieldatum ein.' };
    const weeks = weeksUntil(date);
    if (weeks < 1) return { error: 'Das Zieldatum muss mindestens eine Woche in der Zukunft liegen.' };
    const perWeek = (goal - w) / weeks;
    delta = perWeek * 7700 / 7;
    const lim = delta < 0 ? -1000 : 700;
    if (Math.abs(delta) > Math.abs(lim)) {
      delta = lim;
      notes.push(`Für dein Zieldatum wären ${fmtKg(Math.abs(perWeek))} kg pro Woche nötig – das ist zu schnell. Gerechnet wird mit ${delta < 0 ? 'max. 1.000 kcal Defizit' : 'max. 700 kcal Überschuss'}; plane ein späteres Datum ein.`);
    } else notes.push(`Dafür nötig: ${perWeek < 0 ? '−' : '+'}${fmtKg(Math.abs(perWeek))} kg pro Woche.`);
  } else delta = Number(pr.aim) || 0;

  let kcal = Math.round((tdee + delta) / 10) * 10;
  const minKcal = pr.sex === 'm' ? 1500 : 1200;
  if (kcal < minKcal) { kcal = minKcal; notes.push(`Auf ${fmt(minKcal)} kcal angehoben – weniger sollte es ohne ärztliche Begleitung nicht sein.`); }
  const refW = Math.min(w, 27 * (h / 100) ** 2); // Bezugsgewicht bei hohem BMI
  const p = Math.round(refW * (delta < 0 ? 1.8 : 1.6));
  const f = Math.round(kcal * 0.3 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return {
    bmr, tdee, notes,
    goals: { kcal, p, c, f, fib: 30, sug: Math.round(kcal * 0.1 / 4), salt: 6, water: Math.min(4000, Math.max(1500, Math.round(w * 35 / 250) * 250)) },
  };
}

function readProfile() {
  const f = calcForm.elements;
  return { sex: f.sex.value, age: f.age.value, height: f.height.value, weight: f.weight.value, activity: f.activity.value, aim: f.aim.value };
}

function fillCalcForm() {
  const pr = state.profile || {};
  const f = calcForm.elements;
  const lastW = sortedWeights().pop();
  f.sex.value = pr.sex || 'f';
  f.age.value = pr.age || '';
  f.height.value = pr.height || '';
  f.weight.value = lastW ? lastW.kg : (pr.weight || '');
  f.activity.value = pr.activity || '1.375';
  f.aim.value = pr.aim || '0';
}

function renderCalc() {
  const res = computeGoals(readProfile());
  const box = $('#calcResult');
  calcSuggestion = res?.goals || null;
  $('#calcApplyBtn').disabled = !calcSuggestion;
  if (!res) { box.innerHTML = '<span class="muted">Fülle Alter, Größe und Gewicht aus, um deinen Bedarf zu sehen.</span>'; return; }
  if (res.error) { box.innerHTML = `<span class="muted">${esc(res.error)}</span>`; return; }
  const gg = res.goals;
  box.innerHTML = `
    <div class="muted">Grundumsatz ${fmt(res.bmr)} kcal · Gesamtbedarf ${fmt(res.tdee)} kcal</div>
    <div>Vorschlag: <span class="calc-big">${fmt(gg.kcal)} kcal</span></div>
    <div class="calc-grid">
      <span>Eiweiß ${fmt(gg.p)} g</span><span>Kohlenhydrate ${fmt(gg.c)} g</span>
      <span>Fett ${fmt(gg.f)} g</span><span>Ballaststoffe ≥ ${fmt(gg.fib)} g</span>
      <span>Zucker ≤ ${fmt(gg.sug)} g</span><span>Salz ≤ ${fmt(gg.salt)} g</span>
      <span>Wasser ${fmt1(gg.water / 1000)} l</span>
    </div>
    ${res.notes.map(n => `<div class="${/zu schnell|angehoben/.test(n) ? 'warn' : 'muted'}" style="margin-top:6px">${esc(n)}</div>`).join('')}`;
}

calcForm.addEventListener('input', () => { state.profile = readProfile(); save(); renderCalc(); });
calcForm.addEventListener('change', () => { state.profile = readProfile(); save(); renderCalc(); });
calcForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!calcSuggestion) return;
  Object.assign(state.goals, calcSuggestion);
  save();
  renderSettings();
  toast('Neue Tagesziele übernommen');
});

/* ---------- Gewicht ---------- */
const fmtKg = n => (Math.round(n * 10) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sortedWeights = () => [...state.weights].sort((a, b) => a.ts.localeCompare(b.ts));
const latestWeightOn = date => sortedWeights().filter(w => w.date === date).pop();

// Pro Tag die letzte Messung
function dailyWeights() {
  const byDay = new Map();
  for (const w of sortedWeights()) byDay.set(w.date, w);
  return [...byDay.values()];
}

let weightRange = 90;
$('#weightRange').addEventListener('click', e => {
  const b = e.target.closest('[data-range]');
  if (!b) return;
  weightRange = Number(b.dataset.range);
  $$('#weightRange button').forEach(x => x.classList.toggle('active', x === b));
  renderWeight();
});

function renderWeight() {
  const all = dailyWeights();
  const from = weightRange ? addDays(today(), -weightRange + 1) : '0000';
  const pts = all.filter(w => w.date >= from);
  const chart = $('#weightChart');
  const goal = Number(state.goals.weight) || 0;

  if (!pts.length) {
    chart.innerHTML = `<div class="empty">${all.length ? 'Keine Messungen in diesem Zeitraum.' : 'Noch keine Messungen – trag dein Gewicht ein oder importiere es aus Withings.'}</div>`;
  } else {
    const W = 340, H = 170, L = 34, R = 10, T = 12, B = 22;
    const t0 = parseIso(weightRange ? from : pts[0].date).getTime();
    const t1 = parseIso(today()).getTime();
    const span = Math.max(t1 - t0, 86400000);
    let lo = Math.min(...pts.map(p => p.kg)), hi = Math.max(...pts.map(p => p.kg));
    if (goal && goal > lo - 5 && goal < hi + 5) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
    const pad = Math.max(0.5, (hi - lo) * 0.12);
    lo -= pad; hi += pad;
    const x = d => L + ((parseIso(d).getTime() - t0) / span) * (W - L - R);
    const y = kg => T + (1 - (kg - lo) / (hi - lo)) * (H - T - B);
    const ticks = [lo + pad, (lo + hi) / 2, hi - pad];
    const fmtD = d => parseIso(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
    const showDots = pts.length <= 60;
    chart.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewichtsverlauf">
        ${ticks.map(t => `<line class="wgrid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="wlabel" x="${L - 4}" y="${y(t) + 4}" text-anchor="end">${fmtKg(t)}</text>`).join('')}
        ${goal && goal >= lo && goal <= hi ? `<line class="wgoal" x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}"/><text class="wlabel" x="${W - R}" y="${y(goal) - 4}" text-anchor="end">Ziel ${fmtKg(goal)}</text>` : ''}
        <defs><linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="wgrad-a"/><stop offset="100%" class="wgrad-b"/></linearGradient></defs>
        ${pts.length > 1 ? `<path class="warea" d="M${x(pts[0].date).toFixed(1)},${H - B} ${pts.map(p => `L${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ')} L${x(pts[pts.length - 1].date).toFixed(1)},${H - B} Z"/>` : ''}
        <polyline class="wline" points="${pts.map(p => `${x(p.date).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ')}"/>
        ${pts.map((p, i) => (showDots || i === pts.length - 1)
          ? `<circle class="wdot${i === pts.length - 1 ? ' last' : ''}" cx="${x(p.date).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="${i === pts.length - 1 ? 4 : 3}"><title>${fmtD(p.date)}: ${fmtKg(p.kg)} kg</title></circle>` : '').join('')}
        <text class="wlabel" x="${L}" y="${H - 6}">${fmtD(weightRange ? from : pts[0].date)}</text>
        <text class="wlabel" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtD(today())}</text>
      </svg>`;
  }

  const last = all[all.length - 1];
  const parts = [];
  if (last) parts.push(`Aktuell ${fmtKg(last.kg)} kg${last.fat ? ` · ${fmtKg(last.fat)} % Fett` : ''}`);
  if (pts.length >= 2) {
    const diff = pts[pts.length - 1].kg - pts[0].kg;
    parts.push(`${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${fmtKg(Math.abs(diff))} kg ${weightRange ? `in ${weightRange} Tagen` : 'insgesamt'}`);
  }
  if (last && goal) {
    const d = last.kg - goal;
    parts.push(Math.abs(d) < 0.05 ? 'Ziel erreicht 🎉' : `noch ${fmtKg(Math.abs(d))} kg bis zum Ziel`);
  }
  $('#weightStats').textContent = parts.join(' · ');
  renderWeightPlan(last);

  $('#weightList').innerHTML = [...sortedWeights()].reverse().slice(0, 100).map(w => `
    <li><span>${dateLabel(w.date)}${w.ts.length > 10 && w.source === 'withings' ? ` <span class="muted">${w.ts.slice(11, 16)}</span>` : ''}${w.source === 'withings' ? '<span class="src-tag">Withings</span>' : ''}</span>
    <span><strong>${fmtKg(w.kg)} kg</strong>${w.fat ? ` <span class="muted">${fmtKg(w.fat)} %</span>` : ''}<button class="del-btn" data-delweight="${w.id}" aria-label="Messung löschen">✕</button></span></li>`).join('');
}

// Lineare Regression über die letzten 4 Wochen -> kg pro Tag
function weightTrend() {
  const from = addDays(today(), -27);
  const pts = dailyWeights().filter(w => w.date >= from);
  if (pts.length < 3) return null;
  const xs = pts.map(p => parseIso(p.date).getTime() / 86400000);
  if (xs[xs.length - 1] - xs[0] < 7) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = pts.reduce((a, p) => a + p.kg, 0) / pts.length;
  let num_ = 0, den = 0;
  xs.forEach((x, i) => { num_ += (x - mx) * (pts[i].kg - my); den += (x - mx) ** 2; });
  return den ? num_ / den : null;
}

function renderWeightPlan(last) {
  const box = $('#weightPlan');
  const goal = Number(state.goals.weight) || 0;
  const date = state.goals.weightDate;
  if (!goal || !last) { box.hidden = true; return; }
  const lines = [];
  const remaining = goal - last.kg;
  const fmtLong = d => parseIso(d).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const sign = v => v < 0 ? '−' : '+';

  if (Math.abs(remaining) < 0.05) {
    box.hidden = false;
    box.innerHTML = '<p class="status-ok">🎉 Du hast dein Zielgewicht erreicht!</p>';
    return;
  }
  let neededPerWeek = null;
  if (date) {
    const weeks = weeksUntil(date);
    if (weeks <= 0) lines.push(`<p>Dein Zieldatum (${fmtLong(date)}) ist vorbei – setze in den Einstellungen ein neues.</p>`);
    else {
      neededPerWeek = remaining / weeks;
      lines.push(`<p><strong>Plan:</strong> ${fmtKg(goal)} kg bis ${fmtLong(date)} – noch ${fmtKg(Math.abs(remaining))} kg in ${weeks < 2 ? fmt1(weeks) : fmt(weeks)} Wochen, also ${sign(neededPerWeek)}${fmtKg(Math.abs(neededPerWeek))} kg pro Woche.</p>`);
      if (Math.abs(neededPerWeek) > 1) lines.push('<p class="status-warn">⚠️ Mehr als 1 kg pro Woche ist sehr ambitioniert – ein späteres Datum ist realistischer.</p>');
    }
  }
  const slope = weightTrend();
  if (slope === null) {
    lines.push('<p class="muted">Für eine Prognose brauche ich mindestens 3 Messungen über eine Woche in den letzten 4 Wochen.</p>');
  } else {
    const perWeek = slope * 7;
    const towards = Math.sign(perWeek) === Math.sign(remaining) && Math.abs(perWeek) >= 0.02;
    if (!towards) {
      lines.push(`<p><strong>Trend</strong> (4 Wochen): ${sign(perWeek)}${fmtKg(Math.abs(perWeek))} kg pro Woche – damit bewegst du dich gerade nicht auf dein Ziel zu.</p>`);
      if (date) lines.push('<p class="status-warn">Noch nicht im Plan – kleine Anpassungen helfen schon.</p>');
    } else {
      const eta = addDays(today(), Math.round(remaining / slope));
      lines.push(`<p><strong>Trend</strong> (4 Wochen): ${sign(perWeek)}${fmtKg(Math.abs(perWeek))} kg pro Woche – Ziel voraussichtlich am <strong>${fmtLong(eta)}</strong>.</p>`);
      if (date && weeksUntil(date) > 0) {
        lines.push(eta <= date
          ? '<p class="status-ok">✅ Du liegst im Plan.</p>'
          : '<p class="status-warn">⏳ Etwas langsamer als geplant.</p>');
      }
    }
  }
  box.hidden = false;
  box.innerHTML = lines.join('');
}

$('#weightList').addEventListener('click', e => {
  const b = e.target.closest('[data-delweight]');
  if (!b) return;
  const idx = state.weights.findIndex(w => w.id === b.dataset.delweight);
  if (idx < 0) return;
  const [removed] = state.weights.splice(idx, 1);
  save(); render();
  toast('Messung gelöscht', { label: 'Rückgängig', fn: () => { state.weights.push(removed); save(); render(); } });
});

const weightDialog = $('#weightDialog');
const weightForm = $('#weightForm');
function openWeightDialog() {
  const date = currentView === 'day' ? currentDate : today();
  const existing = state.weights.find(w => w.date === date && w.source === 'manual');
  const last = sortedWeights().pop();
  weightForm.elements.date.value = date;
  weightForm.elements.date.max = today();
  weightForm.elements.kg.value = existing ? existing.kg : last ? last.kg : '';
  weightForm.elements.fat.value = existing?.fat || '';
  $('#weightError').textContent = '';
  weightDialog.showModal();
  setTimeout(() => weightForm.elements.kg.select(), 50);
}
$('#weightAddBtn').onclick = openWeightDialog;
$('#weightAddBtn2').onclick = openWeightDialog;
weightForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = weightForm.elements;
  const kg = parseFloat(String(f.kg.value).replace(',', '.'));
  const fat = parseFloat(String(f.fat.value).replace(',', '.'));
  const date = f.date.value || today();
  if (!(kg >= 20 && kg <= 400)) { $('#weightError').textContent = 'Bitte ein Gewicht zwischen 20 und 400 kg eingeben.'; f.kg.focus(); return; }
  // Pro Tag nur eine manuelle Messung – erneutes Eintragen korrigiert sie
  state.weights = state.weights.filter(w => !(w.date === date && w.source === 'manual'));
  const now = new Date();
  const time = date === today() ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` : '12:00';
  state.weights.push({ id: uid(), ts: `${date}T${time}`, date, kg: r1(kg), fat: fat > 0 ? r1(fat) : null, source: 'manual' });
  save();
  weightDialog.close();
  render();
  toast(`${fmtKg(kg)} kg eingetragen`);
});

/* --- Withings-Import (ZIP-Export oder weight.csv) --- */
async function readZipEntry(buf, pick) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei.');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count && dv.getUint32(off, true) === 0x02014b50; n++) {
    const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    entries.push({
      method: dv.getUint16(off + 10, true), flags: dv.getUint16(off + 8, true), csize: dv.getUint32(off + 20, true),
      lho: dv.getUint32(off + 42, true), name: dec.decode(new Uint8Array(buf, off + 46, nlen)),
    });
    off += 46 + nlen + elen + clen;
  }
  const e = pick(entries);
  if (!e) return null;
  if (e.flags & 1) throw new Error('Die ZIP-Datei ist verschlüsselt. Entpacke sie und wähle die weight.csv.');
  const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
  const data = new Uint8Array(buf, start, e.csize);
  if (e.method === 0) return dec.decode(data);
  if (e.method === 8 && 'DecompressionStream' in window) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }
  throw new Error('ZIP konnte nicht entpackt werden. Entpacke sie und wähle die weight.csv.');
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

function parseTimestamp(raw) {
  const s = String(raw).trim();
  let m;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && !isNaN(Date.parse(s))) {
    const d = new Date(s);
    return `${isoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/))) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${(m[4] || '12').padStart(2, '0')}:${m[5] || '00'}`;
  }
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/))) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${(m[4] || '12').padStart(2, '0')}:${m[5] || '00'}`;
  }
  return null;
}

const num = v => {
  const n = parseFloat(String(v ?? '').trim().replace(',', '.'));
  return isNaN(n) ? null : n;
};

function parseWithingsCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Die Datei enthält keine Messungen.');
  const head = rows[0].map(h => h.trim().toLowerCase());
  let dateIdx = head.findIndex(h => /^(date|datum)/.test(h) || /date|datum|zeit|time/.test(h));
  if (dateIdx < 0) dateIdx = 0;
  const weightIdx = head.findIndex(h => /weight|gewicht/.test(h) && !/fat|fett|muscle|muskel|bone|knochen|water|wasser|hydration|lean|mager/.test(h));
  if (weightIdx < 0) throw new Error('Keine Gewichtsspalte gefunden. Ist das die weight.csv aus dem Withings-Export?');
  const toKg = /\blbs?\b|pound/.test(head[weightIdx]) ? 0.45359237 : 1;
  const fatIdx = head.findIndex(h => /fat|fett/.test(h) && !/free|frei/.test(h));
  const fatIsPercent = fatIdx >= 0 && /%|ratio|anteil|percent/.test(head[fatIdx]);
  const fatToKg = fatIdx >= 0 && /\blbs?\b|pound/.test(head[fatIdx]) ? 0.45359237 : 1;

  const out = [];
  for (const r of rows.slice(1)) {
    const ts = parseTimestamp(r[dateIdx]);
    let kg = num(r[weightIdx]);
    if (!ts || kg === null) continue;
    kg *= toKg;
    if (kg < 20 || kg > 400) continue;
    let fat = fatIdx >= 0 ? num(r[fatIdx]) : null;
    if (fat !== null) fat = fatIsPercent ? fat : (fat * fatToKg) / kg * 100;
    out.push({ ts, date: ts.slice(0, 10), kg: r1(kg), fat: fat && fat > 0 && fat < 80 ? r1(fat) : null });
  }
  if (!out.length) throw new Error('Keine gültigen Messungen in der Datei gefunden.');
  return out;
}

function importWeights(list) {
  const seen = new Set(state.weights.map(w => `${w.ts}|${w.kg}`));
  let added = 0, skipped = 0;
  for (const m of list) {
    const key = `${m.ts}|${m.kg}`;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    state.weights.push({ id: uid(), ...m, source: 'withings' });
    added++;
  }
  save();
  return { added, skipped };
}

$('#withingsFile').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const isZip = new DataView(buf).byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50;
    let text;
    if (isZip) {
      text = await readZipEntry(buf, entries => {
        const base = n => n.split('/').pop().toLowerCase();
        return entries.find(x => base(x.name) === 'weight.csv')
          || entries.find(x => /weight|gewicht/.test(base(x.name)) && base(x.name).endsWith('.csv') && !/raw/.test(base(x.name)));
      });
      if (text === null) throw new Error('In der ZIP-Datei wurde keine weight.csv gefunden.');
    } else {
      text = new TextDecoder().decode(buf);
    }
    const { added, skipped } = importWeights(parseWithingsCsv(text));
    render();
    toast(added ? `${added} Messung${added === 1 ? '' : 'en'} importiert${skipped ? `, ${skipped} schon vorhanden` : ''}`
      : `Keine neuen Messungen (${skipped} schon vorhanden)`);
  } catch (err) {
    console.warn(err);
    toast(err.message || 'Datei konnte nicht gelesen werden');
  } finally {
    e.target.value = '';
  }
};

/* ---------- Gerichte ---------- */
const dishDialog = $('#dishDialog');
const dishForm = $('#dishForm');
let dishDraft = null; // { id?, name, portions, ingredients }

// Zutat: { name, unit, amount, per100: {kcal,p,c,f} } oder feste Werte { name, fixed: {kcal,p,c,f} }
function ingValues(i) {
  return i.fixed ? pickN(i.fixed) : scale(i.per100, Number(i.amount) || 0);
}

function dishTotals(d) {
  return d.ingredients.reduce((t, i) => addN(t, ingValues(i)), zeroN());
}

function dishToFood(d) {
  const t = dishTotals(d);
  const n = Math.max(1, Number(d.portions) || 1);
  return {
    kind: 'dish', id: d.id, name: d.name, unit: 'Portion', portion: 1,
    ...mapN(t, v => v / n),
    ingredientCount: d.ingredients.length,
    ingredientNames: d.ingredients.map(i => i.name.replace(/\s*\(.*\)$/, '')).join(', '),
  };
}

function ingredientFromFood(food) {
  if (food.quick) return { name: food.name, fixed: pickN(food) };
  return {
    name: food.name, unit: food.unit || 'g', amount: food.lastAmount || food.portion || 100,
    per100: pickN(food),
  };
}

function ingredientFromEntry(e) {
  const vals = pickN(e);
  if (e.amount > 0 && e.unit && e.unit !== 'Portion') {
    const k = 100 / e.amount;
    return { name: e.name, unit: e.unit, amount: e.amount,
      per100: roundN(mapN(vals, v => v * k)) };
  }
  const label = e.unit === 'Portion' ? `${e.name} (${amountLabel(e)})` : e.name;
  return { name: label, fixed: vals };
}

function openDishEditor(dish = null, prefillIngredients = null) {
  dishDraft = dish
    ? structuredClone(dish)
    : { name: '', portions: 1, ingredients: prefillIngredients || [] };
  $('#dishTitle').textContent = dish ? 'Gericht bearbeiten' : 'Neues Gericht';
  dishForm.elements.name.value = dishDraft.name;
  dishForm.elements.portions.value = dishDraft.portions;
  $('#dishSearch').value = '';
  $('#dishResults').innerHTML = '';
  $('#dishError').textContent = '';
  $('#dishDeleteBtn').hidden = !dish;
  renderDishIngredients();
  dishDialog.showModal();
  if (!dish) setTimeout(() => dishForm.elements.name.focus(), 50);
}

function renderDishIngredients() {
  $('#dishIngredients').innerHTML = dishDraft.ingredients.map((i, idx) => `
    <li>
      <span class="ing-name" title="${esc(i.name)}">${esc(i.name)}</span>
      ${i.fixed ? '<span class="ing-amt"></span>'
        : `<span class="ing-amt"><input type="number" min="0" step="1" inputmode="decimal" data-amt-idx="${idx}" value="${i.amount}" aria-label="Menge">${i.unit}</span>`}
      <span class="ing-kcal" data-kcal-idx="${idx}">${fmt(ingValues(i).kcal)} kcal</span>
      <button type="button" class="del-btn" data-rm-idx="${idx}" aria-label="Zutat entfernen">✕</button>
    </li>`).join('');
  renderDishTotals();
}

function renderDishTotals() {
  const t = dishTotals(dishDraft);
  const n = Math.max(1, Number(dishForm.elements.portions.value) || 1);
  $('#dishTotals').textContent = dishDraft.ingredients.length
    ? `Pro Portion: ${fmt(t.kcal / n)} kcal · E ${fmt1(t.p / n)} g · KH ${fmt1(t.c / n)} g · F ${fmt1(t.f / n)} g` +
      (n > 1 ? `  (gesamt ${fmt(t.kcal)} kcal)` : '')
    : 'Füge Zutaten hinzu, um die Nährwerte zu sehen.';
}

function addIngredient(food) {
  dishDraft.ingredients.push(ingredientFromFood(food));
  $('#dishSearch').value = '';
  $('#dishResults').innerHTML = '';
  $('#dishError').textContent = '';
  renderDishIngredients();
  const inputs = $$('#dishIngredients input');
  const last = dishDraft.ingredients[dishDraft.ingredients.length - 1];
  if (!last.fixed && inputs.length) setTimeout(() => inputs[inputs.length - 1].select(), 30);
}

$('#dishIngredients').addEventListener('input', e => {
  const idx = e.target.dataset.amtIdx;
  if (idx === undefined) return;
  dishDraft.ingredients[idx].amount = parseFloat(e.target.value) || 0;
  $(`[data-kcal-idx="${idx}"]`).textContent = `${fmt(ingValues(dishDraft.ingredients[idx]).kcal)} kcal`;
  renderDishTotals();
});
$('#dishIngredients').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm-idx]');
  if (!rm) return;
  dishDraft.ingredients.splice(Number(rm.dataset.rmIdx), 1);
  renderDishIngredients();
});
dishForm.elements.portions.addEventListener('input', renderDishTotals);

function renderDishResults() {
  const q = $('#dishSearch').value;
  const ul = $('#dishResults');
  if (!q.trim()) { ul.innerHTML = ''; return; }
  const list = filterByQuery(allFoods(), q).slice(0, 12);
  ul.innerHTML = list.length ? list.map((f, i) => foodRowHtml(f, i)).join('')
    : '<li class="empty">Nichts gefunden – lege es unter Einstellungen → Eigene Lebensmittel an oder scanne den Barcode.</li>';
  ul._list = list;
}
$('#dishSearch').addEventListener('input', renderDishResults);
$('#dishResults').addEventListener('click', e => {
  const li = e.target.closest('li[data-i]');
  if (li) addIngredient($('#dishResults')._list[Number(li.dataset.i)]);
});
$('#dishScanBtn').onclick = () => openScanner('dish');

// Enter soll das Formular nicht versehentlich speichern
dishForm.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.type === 'submit') return;
  e.preventDefault();
  if (e.target.id === 'dishSearch') $('#dishResults li[data-i]')?.click();
  else e.target.blur();
});

dishForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = dishForm.elements.name.value.trim();
  const portions = Math.max(1, Math.round(Number(dishForm.elements.portions.value) || 1));
  if (!name) { $('#dishError').textContent = 'Bitte gib dem Gericht einen Namen.'; dishForm.elements.name.focus(); return; }
  if (!dishDraft.ingredients.length) { $('#dishError').textContent = 'Füge mindestens eine Zutat hinzu.'; $('#dishSearch').focus(); return; }
  const dish = {
    id: dishDraft.id || uid(), name, portions,
    ingredients: dishDraft.ingredients.map(i => i.fixed ? i : { ...i, amount: Number(i.amount) || 0 }),
  };
  const idx = state.dishes.findIndex(d => d.id === dish.id);
  if (idx >= 0) state.dishes[idx] = dish; else state.dishes.unshift(dish);
  save();
  dishDialog.close();
  render();
  if (addDialog.open) { setPickSrc('dishes'); }
  else toast(`Gericht „${name}“ gespeichert`);
});

$('#dishDeleteBtn').onclick = () => {
  if (!dishDraft?.id || !confirm(`Gericht „${dishDraft.name}“ löschen?`)) return;
  state.dishes = state.dishes.filter(d => d.id !== dishDraft.id);
  state.recent = state.recent.filter(r => !(r.kind === 'dish' && r.id === dishDraft.id));
  save();
  dishDialog.close();
  render();
  if (addDialog.open) renderResults();
  else toast('Gericht gelöscht');
};

function saveMealAsDish(mealId) {
  const entries = getDay(currentDate).entries.filter(e => e.meal === mealId);
  if (!entries.length) return;
  openDishEditor(null, entries.map(ingredientFromEntry));
}

$('#newDishBtn').onclick = () => openDishEditor();
$('#dishList').addEventListener('click', e => {
  const li = e.target.closest('[data-dish]');
  if (li) openDishEditor(state.dishes.find(d => d.id === li.dataset.dish));
});

for (const d of [addDialog, foodDialog, scanDialog, dishDialog, weightDialog, actDialog]) {
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}
$('#foodSearch').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  $('#foodResults li[data-i]')?.click();
});

// Datum aktualisieren, wenn die App über Mitternacht offen bleibt
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

applyTheme();
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
