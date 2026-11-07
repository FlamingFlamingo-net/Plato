// tags.js — tags on catalogue items (spec "Feature: Ingredients, slice (a)" → "Tags").
// A tag belongs to ONE item (ingredient or diet template); nothing is inherited between levels.
// Starter tags (platform) come with the data and cannot be removed; "mis etiquetas" are private to this nutritionist.
import { list, create, remove, count, q } from './api.js';
import { h, icon, toast, busy } from './ui.js';

const collator = new Intl.Collator('es', { sensitivity: 'base' });
export const normText = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export async function listAll(name, opts = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await list(name, { ...opts, perPage: 500, page });
    out.push(...r);
    if (r.length < 500) return out;
  }
}

// Tags this nutritionist can see: starter tags first (platform), then their own, each group A–Z.
export async function loadTags() {
  const tags = await listAll('tags', { fields: 'id,name,nutritionist' });
  return tags.sort((a, b) => (!!a.nutritionist - !!b.nutritionist) || collator.compare(a.name, b.name));
}

// Links on a set of items → Map(itemId → Map(tagId → { id, platform })).
export async function linksFor(kind, itemIds) {
  const map = new Map(itemIds.map((i) => [i, new Map()]));
  for (let i = 0; i < itemIds.length; i += 80) {
    const part = itemIds.slice(i, i + 80);
    const rows = await listAll('item_tags', { filter: `kind = ${q(kind)} && (${part.map((x) => `item = ${q(x)}`).join(' || ')})`, fields: 'id,tag,item,nutritionist' });
    for (const l of rows) map.get(l.item)?.set(l.tag, { id: l.id, platform: !l.nutritionist });
  }
  return map;
}

export async function itemsWithTag(kind, tagId) {
  const rows = await listAll('item_tags', { filter: `kind = ${q(kind)} && tag = ${q(tagId)}`, fields: 'item' });
  return new Set(rows.map((r) => r.item));
}
export const tagCount = (kind, tagId) => count('item_tags', `kind = ${q(kind)} && tag = ${q(tagId)}`).catch(() => 0);

// A row of filter chips. counts: Map(tagId → n). Picking several narrows to items that have ALL of them.
export function mountTagChips(el, { tags, counts, selected, onChange, label = 'Filtrar por etiqueta' }) {
  const draw = (focusId) => {
    const keep = focusId || (el.contains(document.activeElement) ? document.activeElement.dataset?.tag : '');
    const shown = tags.filter((t) => (counts.get(t.id) || 0) > 0 || selected.has(t.id));
    el.hidden = !shown.length;
    el.replaceChildren(...[h('span', { class: 'plato-muted plato-small', id: `${el.id}-label`, text: 'Etiquetas:' }),
      ...shown.map((t) => h('button', {
        class: 'plato-chip', type: 'button', 'aria-pressed': String(selected.has(t.id)), 'data-tag': t.id,
        onclick: () => { if (selected.has(t.id)) selected.delete(t.id); else selected.add(t.id); draw(t.id); onChange(); },
      }, `${t.name} `, h('span', { class: 'plato-muted', text: `(${counts.get(t.id) || 0})` }))),
      selected.size ? h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', onclick: () => { selected.clear(); draw(); onChange(); } }, 'Quitar filtros') : null].filter(Boolean));
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', label);
    if (keep) el.querySelector(`[data-tag="${keep}"]`)?.focus();
  };
  draw();
  return { redraw: () => draw(), setCounts: (c) => { counts = c; draw(); } };
}

// Small read-only badges for one item.
export const tagBadges = (tags, linkMap) => h('span', { class: 'plato-tags' },
  ...tags.filter((t) => linkMap?.has(t.id)).map((t) => h('span', { class: 'badge', 'data-variant': 'secondary', text: t.name })));

let dlg;
// The "Etiquetas" dialog of one item: tick to add or remove MY links, starter links show as "incluida", add a new tag by hand.
export async function openTagDialog({ kind, itemId, itemName, tags, myId, onClose }) {
  dlg?.remove();
  const links = (await linksFor(kind, [itemId])).get(itemId);
  const form = h('div', { class: 'plato-tag-list' });
  const error = h('p', { class: 'plato-form-error', role: 'alert', hidden: true });
  const input = h('input', { class: 'input', id: 'tag-new', maxlength: 30, autocomplete: 'off', 'aria-describedby': 'tag-new-help' });
  const addBtn = h('button', { class: 'btn', 'data-variant': 'outline', type: 'submit' }, icon('plus', 16), 'Agregar etiqueta');
  const say = (m) => { error.textContent = m || ''; error.hidden = !m; };
  const draw = () => {
    form.replaceChildren(...tags.map((t) => {
      const l = links.get(t.id), mine = !!t.nutritionist;
      const box = h('input', { type: 'checkbox', id: `tg-${t.id}`, checked: !!l, disabled: l?.platform });
      box.addEventListener('change', async () => {
        say('');
        try {
          if (box.checked) links.set(t.id, { id: (await create('item_tags', { tag: t.id, item: itemId, kind, nutritionist: myId })).id, platform: false });
          else { await remove('item_tags', links.get(t.id).id); links.delete(t.id); }
        } catch (e) { say(e.message); box.checked = !box.checked; }
        draw();
      });
      let del = null;
      if (mine) {
        del = h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Eliminar la etiqueta ${t.name}` }, icon('trash', 14));
        del.addEventListener('click', async () => {
          if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.replaceChildren('¿Quitarla de todo? Eliminar'); return; }
          try { await remove('tags', t.id); } catch (e) { say(e.message); return; }
          tags.splice(tags.indexOf(t), 1); links.delete(t.id); toast('Etiqueta eliminada de todo.'); draw();
        });
      }
      return h('div', { class: 'plato-tag-row' },
        h('label', { for: `tg-${t.id}` }, box, h('span', { text: t.name }), l?.platform ? h('small', { class: 'plato-muted', text: 'incluida' }) : (!mine ? h('small', { class: 'plato-muted', text: 'de ejemplo' }) : null)), del);
    }));
    if (!tags.length) form.replaceChildren(h('p', { class: 'plato-muted', text: 'Aún no hay etiquetas. Crea la primera abajo.' }));
  };
  draw();
  const add = h('form', { class: 'plato-tag-add', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); say('');
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) { say('Escribe el nombre de la etiqueta.'); input.focus(); return; }
    try {
      await busy(addBtn, async () => {
        const existing = tags.find((t) => normText(t.name) === normText(name));
        const tag = existing || await create('tags', { name, nutritionist: myId });
        if (!existing) tags.push({ id: tag.id, name: tag.name, nutritionist: myId });
        if (!links.has(tag.id)) links.set(tag.id, { id: (await create('item_tags', { tag: tag.id, item: itemId, kind, nutritionist: myId })).id, platform: false });
      });
    } catch (err) { say(err.message); return; }
    input.value = ''; draw();
  } },
  h('div', { class: 'field' }, h('label', { for: 'tag-new', text: 'Nueva etiqueta' }), input,
    h('p', { class: 'plato-muted plato-small', id: 'tag-new-help', style: 'margin:0', text: 'Hasta 30 letras. Solo tú la ves.' })), addBtn);
  dlg = h('dialog', { class: 'dialog plato-tag-dialog', id: 'tag-dialog', 'aria-labelledby': 'tag-title' },
    h('div', {}, h('header', {}, h('h2', { id: 'tag-title', text: 'Etiquetas' }), h('p', { text: itemName })),
      h('section', { class: 'plato-form' }, form, error, add),
      h('footer', { class: 'plato-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Listo'))));
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.showModal();
  input.focus();
}
