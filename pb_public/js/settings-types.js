// settings-types.js — Ajustes → "Tipos de consulta" (spec "Feature: Agenda", slice 1).
// Each type has a name and its usual duration; "Nueva cita" fills the duration in when the type is picked.
// Renaming or removing a type doesn't touch existing appointments (they keep what they were saved with).
import { update } from './api.js';
import { h, icon, toast, formError, busy } from './ui.js';
import { typesOf } from './appointments.js';

export function mountTypes(section, getMe, setMe) {
  let types = typesOf(getMe().appointment_types).map((x) => ({ ...x }));
  const listEl = h('ul', { class: 'plato-types', id: 'types-list' });
  const input = h('input', { class: 'input', id: 'type-new', maxlength: 80, placeholder: 'Ej. Consulta deportiva' });
  const minNew = h('input', { class: 'input plato-types-min', id: 'type-new-min', type: 'number', min: 15, max: 240, step: 5, value: 60, inputmode: 'numeric' });
  const form = h('form', { class: 'plato-form', novalidate: true, id: 'types-form' },
    h('div', { class: 'plato-types-head', 'aria-hidden': 'true' }, h('span', { text: 'Tipo' }), h('span', { text: 'Minutos' })),
    listEl,
    h('div', { class: 'plato-types-add' },
      h('div', { class: 'field' }, h('label', { for: 'type-new', text: 'Agregar un tipo' }), input),
      h('div', { class: 'field' }, h('label', { for: 'type-new-min', text: 'Minutos' }), minNew),
      h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', id: 'type-add', onclick: add }, icon('plus', 16), 'Agregar')),
    h('footer', { class: 'plato-actions', style: 'justify-content:flex-end' }, h('button', { class: 'btn', type: 'submit', id: 'types-save' }, 'Guardar tipos')));
  section.append(form);

  const minutesOk = (n) => Number.isInteger(n) && n >= 15 && n <= 240 && n % 5 === 0;
  function add() {
    const v = input.value.trim(), m = Number(minNew.value);
    formError(form, '');
    if (!v) { input.focus(); return; }
    if (types.some((t) => t.name.trim().toLowerCase() === v.toLowerCase())) { formError(form, 'Ese tipo ya está en la lista.'); return; }
    if (!minutesOk(m)) { formError(form, 'La duración va de 15 a 240 minutos, de 5 en 5.'); minNew.focus(); return; }
    if (types.length >= 30) { formError(form, 'Máximo 30 tipos.'); return; }
    types.push({ name: v, minutes: m }); input.value = ''; minNew.value = 60; render(); input.focus();
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  function render() {
    listEl.replaceChildren(...types.map((t, i) => h('li', {},
      h('input', { class: 'input', value: t.name, maxlength: 80, 'aria-label': `Nombre del tipo ${i + 1}`, required: true, oninput: (e) => { types[i].name = e.target.value; } }),
      h('span', { class: 'plato-types-m' },
        h('input', { class: 'input plato-types-min', type: 'number', min: 15, max: 240, step: 5, inputmode: 'numeric', value: t.minutes,
          'aria-label': `Minutos de «${t.name}»`, oninput: (e) => { types[i].minutes = Number(e.target.value); } }),
        h('span', { class: 'plato-muted plato-small', 'aria-hidden': 'true', text: 'min' })),
      h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Quitar «${t.name}»`, disabled: types.length === 1 ? true : null,
        onclick: () => { types.splice(i, 1); render(); listEl.querySelector('input')?.focus(); } }, icon('trash', 16)))));
  }
  render();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, '');
    const clean = types.map((t) => ({ name: t.name.trim(), minutes: Number(t.minutes) }));
    if (clean.some((t) => !t.name)) { formError(form, 'Cada tipo necesita un nombre.'); return; }
    if (clean.some((t) => !minutesOk(t.minutes))) { formError(form, 'La duración va de 15 a 240 minutos, de 5 en 5.'); return; }
    try {
      const me = await busy(document.getElementById('types-save'), () => update('nutritionists', getMe().id, { appointment_types: clean }));
      setMe(me); types = typesOf(me.appointment_types).map((x) => ({ ...x })); render();
    } catch (err) { formError(form, err.status === 0 ? 'Sin conexión. No se guardó.' : err.message); return; }
    toast('Tipos de consulta guardados.');
  });
}
