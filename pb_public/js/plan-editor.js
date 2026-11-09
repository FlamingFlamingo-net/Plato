// plan-editor.js — dishes inside a diet's meals (spec "Feature: Diets using dishes, slice (c)"), used by the patient page.
// Holds the plan being edited, one snapshot per dish (what the diet saved; the server keeps it until "Actualizar") and the dish list.
import { h, icon, num } from './ui.js';
import { normText } from './tags.js';
import { KEYS, MAX_PER_SLOT, MIN_SERVINGS, MAX_SERVINGS, validServings, fmtServings, slotLines, dayTotals } from './plan-math.js';

export function createPlanEditor({ dishes, closed, onChange }) {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  let plan = {}, snap = {};
  const refresh = new Set();
  const stats = (n) => `${num(n.kcal, 0)} kcal · P ${num(n.protein_g)} g · G ${num(n.fat_g)} g · C ${num(n.carbs_g)} g · Fibra ${num(n.fiber_g)} g`;
  const perServing = (d) => Object.fromEntries(KEYS.map((k) => [k, Number(d.nutrition?.[k]) || 0]));
  const snapOf = (d) => ({ name: d.name, serving_unit: d.serving_unit, per_serving: perServing(d) });
  const changed = (id) => {   // the dish today differs from what this diet saved
    const d = byId.get(id), s = snap[id];
    return !!(d && s && KEYS.some((k) => Math.abs((Number(s.per_serving?.[k]) || 0) - (Number(d.nutrition?.[k]) || 0)) > 0.0005));
  };
  const usedIds = () => [...new Set(Object.values(plan).flatMap((day) => Object.values(day).flat()).map((l) => l.dish))];

  function load(p, calc) {
    plan = structuredClone(p || {}); snap = structuredClone(calc?.dishes || {}); refresh.clear();
    for (const l of Object.values(plan).flatMap((day) => Object.values(day).flat())) l.name = snap[l.dish]?.name || l.name;
  }
  // a template's plan lands in the editor as new lines of THIS diet (new snapshot = the dishes as they are now)
  function adopt(p, calc) {
    load(p, calc);
    for (const id of usedIds()) if (byId.has(id)) { snap[id] = snapOf(byId.get(id)); refresh.add(id); }
  }
  const clean = () => {
    const out = {};
    for (const [d, slots] of Object.entries(plan)) for (const [k, lines] of Object.entries(slots)) {
      if (lines.length) (out[d] ||= {})[k] = lines.map((l) => ({ dish: l.dish, servings: Number(l.servings) }));
    }
    return out;
  };
  const hasBad = () => Object.values(plan).some((day) => Object.values(day).some((ls) => ls.some((l) => l._bad)));
  const stale = () => usedIds().filter(changed);
  const hasGone = () => usedIds().some((id) => !byId.has(id));
  const copyDay = (from) => { const src = plan[from] || {}; for (let d = 1; d <= 7; d++) if (d !== from) plan[d] = structuredClone(src); };
  const refreshIds = (ids) => { for (const id of ids) if (byId.has(id)) { snap[id] = snapOf(byId.get(id)); refresh.add(id); } };

  // ---- one meal's dish lines + the "Agregar receta" panel
  function slotEl(day, key, label) {
    const box = h('div', { class: 'plato-plan-slot', dataset: { slot: key } });
    const list = h('ul', { class: 'plato-plan-lines', 'aria-label': `Recetas de ${label}` });
    const panel = h('div', { class: 'plato-plan-panel', hidden: true });
    const mine = () => ((plan[day] ||= {})[key] ||= []);
    let open = false;

    const paintLines = () => {
      const lines = slotLines(plan, day, key);
      list.hidden = !lines.length;
      list.replaceChildren(...lines.map((l, i) => {
        const s = snap[l.dish], gone = !byId.has(l.dish);
        const kcal = h('span', { class: 'plato-plan-kcal' });
        const paintKcal = () => { kcal.textContent = l._bad ? '' : `= ${num(l.servings * (Number(s?.per_serving?.kcal) || 0), 0)} kcal`; };
        const input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: String(MIN_SERVINGS), max: String(MAX_SERVINGS), step: '0.25', value: String(l.servings), 'aria-label': `Porciones de ${l.name}`, disabled: closed ? true : null });
        input.addEventListener('input', () => {
          const v = Number(input.value);
          l._bad = input.value === '' || !validServings(v);
          input.setAttribute('aria-invalid', String(l._bad));
          if (!l._bad) l.servings = v;
          paintKcal(); onChange(day, key);
        });
        paintKcal();
        return h('li', { class: `plato-plan-line${gone ? ' is-gone' : ''}`, dataset: { dish: l.dish } },
          h('div', { class: 'plato-plan-name' }, h('strong', { text: l.name }),
            gone ? h('span', { class: 'badge', 'data-variant': 'outline', text: 'receta borrada' }) : null,
            !gone && changed(l.dish) ? h('span', { class: 'plato-plan-changed' }, h('span', { class: 'badge', 'data-variant': 'secondary', text: 'La receta cambió' }),
              closed ? null : h('button', { class: 'btn', 'data-variant': 'link', 'data-size': 'sm', type: 'button', 'data-action': 'refresh', 'aria-label': `Actualizar ${l.name} con los valores de hoy`,
                onclick: () => { refreshIds([l.dish]); repaintAll(); onChange(day, key, true); } }, 'Actualizar')) : null),
          h('div', { class: 'plato-plan-ctl' },
            h('span', { class: 'plato-muted', 'aria-hidden': 'true', text: '×' }), input,
            h('span', { class: 'plato-muted plato-small', text: s?.serving_unit || '' }), kcal,
            closed ? null : h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'data-action': 'remove', 'aria-label': `Quitar ${l.name}`,
              onclick: () => { mine().splice(i, 1); paint(); onChange(day, key, true); } }, icon('trash', 16))));
      }));
    };

    const paintPanel = () => {
      panel.hidden = !open;
      if (!open) { panel.replaceChildren(); return; }
      if (!dishes.length) {
        panel.replaceChildren(h('p', { class: 'plato-muted plato-small', style: 'margin:0' }, 'Aún no tienes recetas activas. Créalas en ', h('a', { href: '/dishes.html', text: 'Catálogo → Recetas' }), '.'));
        return;
      }
      const results = h('ul', { class: 'plato-dish-results', 'data-role': 'results' });
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Buscar receta', autocomplete: 'off', 'aria-label': `Buscar una receta para ${label}` });
      const paintResults = () => {
        const needle = normText(q.value), used = new Set(slotLines(plan, day, key).map((l) => l.dish));
        const found = dishes.filter((d) => !d.archived_at && !used.has(d.id) && (!needle || normText(d.name).includes(needle))).slice(0, 6);
        results.replaceChildren(...(found.length ? found.map((d) => h('li', {}, h('button', { class: 'plato-dish-result', type: 'button', onclick: () => add(d) },
          h('strong', { text: d.name }), h('span', { class: 'plato-muted plato-small', text: ` por 1 ${d.serving_unit}: ${num(d.nutrition?.kcal, 0)} kcal` }))))
          : [h('li', { class: 'plato-muted plato-small', text: needle ? 'Ninguna receta coincide.' : 'No hay más recetas para agregar.' })]));
      };
      q.addEventListener('input', paintResults);
      q.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); results.querySelector('button')?.click(); }
        if (e.key === 'Escape') { e.stopPropagation(); open = false; paintPanel(); addBtn.focus(); }
      });
      panel.replaceChildren(q, results);
      paintResults();
      q.focus();
    };

    function add(d) {
      if (mine().length >= MAX_PER_SLOT) return;
      if (!snap[d.id]) snap[d.id] = snapOf(d);
      mine().push({ dish: d.id, servings: 1, name: d.name });
      open = false; paint(); onChange(day, key, true);
      list.lastElementChild?.querySelector('input')?.select();
    }
    const addBtn = h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'data-action': 'add-dish', 'aria-expanded': 'false',
      'aria-label': `Agregar receta a ${label}`, onclick: () => { open = !open; addBtn.setAttribute('aria-expanded', String(open)); paintPanel(); } }, icon('plus', 16), 'Agregar receta');
    const paint = () => { paintLines(); addBtn.hidden = closed || slotLines(plan, day, key).length >= MAX_PER_SLOT; addBtn.setAttribute('aria-expanded', String(open)); paintPanel(); };
    box.repaint = paint;
    paint();
    box.append(list, addBtn, panel);
    return box;
  }
  const mounted = new Set();
  const repaintAll = () => { for (const b of document.querySelectorAll('.plato-plan-slot')) b.repaint?.(); };

  // ---- the day's totals (live; the server stores the official ones on save)
  function totalsEl(day, meals, snacksShown) {
    const t = dayTotals(plan, meals, day, snacksShown, snap);
    if (!t) return null;
    return h('div', { class: 'plato-plan-totals', id: 'plan-totals', 'aria-live': 'polite' },
      h('strong', { text: 'Total del día' }), h('span', { text: stats(t.total) }),
      t.free_text ? h('span', { class: 'plato-muted plato-small', text: 'Sin contar el texto libre de las comidas.' }) : null);
  }

  return { load, adopt, clean, hasBad, hasGone, stale, copyDay, refreshIds, slotEl, totalsEl, repaintAll, refreshList: () => [...refresh], get plan() { return plan; }, get snap() { return snap; }, used: usedIds };
}
