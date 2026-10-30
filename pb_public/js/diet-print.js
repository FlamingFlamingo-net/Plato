// diet-print.js — the weekly diet as one landscape A4 sheet. Nutritionist (?id=patient) or patient (own diet).
import { view, list, q, snacksOf } from './api.js';
import { h, offlineBanner } from './ui.js';
import { weekTable, hasDiet } from './week.js';
import { printDocument, requireAnyRole, miniPlate, printedOn } from './printing.js';

offlineBanner();
const { role, me } = await requireAnyRole();
const statusEl = document.getElementById('status');
const sheet = document.getElementById('sheet');
const printBtn = document.getElementById('print');
const back = document.getElementById('back');

const pid = role === 'patients' ? me.id : new URL(location.href).searchParams.get('id') || '';
back.href = role === 'patients' ? '/today.html' : `/patient.html?id=${encodeURIComponent(pid)}&tab=diet`;

try {
  const patient = await view('patients', pid);
  const nutritionist = role === 'nutritionists' ? me : await view('nutritionists', patient.nutritionist).catch(() => null);
  const [diet] = await list('diets', { filter: `patient = ${q(patient.id)}` });
  document.title = `Dieta de ${patient.name} — AHT Fitness`;

  if (!diet || !hasDiet(diet.meals, snacksOf(diet))) {
    statusEl.textContent = 'Aún no hay dieta.';
    printBtn.disabled = true;
    printBtn.hidden = true;
  } else {
    const by = nutritionist ? [`Plan de ${nutritionist.name}`, nutritionist.clinic_name].filter(Boolean).join(' · ') : '';
    sheet.replaceChildren(
      h('header', { class: 'sheet-head' },
        miniPlate(),
        h('div', {},
          h('h1', { id: 'sheet-title', text: diet.title || 'Plan de alimentación' }),
          h('p', { text: patient.name }),
          by ? h('p', { text: by }) : null),
        h('div', { class: 'sheet-meta' }, h('div', { text: printedOn() }), h('div', { text: 'AHT Fitness' }))),
      weekTable(diet.meals, snacksOf(diet)));
    sheet.hidden = false;
    document.getElementById('hint').hidden = false;
    statusEl.textContent = '';
    statusEl.hidden = true;
    printBtn.disabled = false;
    printBtn.addEventListener('click', printDocument);
  }
} catch (e) {
  statusEl.textContent = e.status === 404 ? 'No encontrado. Este paciente no existe o no es tuyo.' : e.message;
  printBtn.hidden = true;
}
