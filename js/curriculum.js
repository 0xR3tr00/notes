/* =============================================================================
   Notes++ — curriculum.js
   -----------------------------------------------------------------------------
   Curriculum explorer for two catalog years that share one page.

   The views a plan gets are decided by its DATA, not by its year:
     - dataStatus.prerequisitesSourced !== false  →  prerequisite map (+ Plan mode)
     - dataStatus.prerequisitesSourced === false  →  requirements checklist only
     - suggestedStudyPlan present                  →  study plan tab
   Both plans get the Compare tab.

   Sections:
     1. Catalogs + data loading
     2. Graph derivation (prereqs → unlocks, ancestors, descendants)
     3. Layout (which column / row each course goes in)
     4. Render graph (nodes + SVG arrows) and list view
     5. Selection + detail panel
     6. "Passed" tracking (shared) + Plan mode availability (graph plans only)
     7. Checklist view (plans without prerequisite data)
     8. Study plan tab
     9. Compare tab
    10. Tabs, activation, boot

   Relies on main.js for: $, esc, loadCourses, courseUrl.
   ============================================================================= */
'use strict';

/* ---- 1. Catalogs --------------------------------------------------------------
   Labelled by admission year because that's how students know which plan
   they're on. `id` is used to namespace localStorage keys so "passed" ticks
   in one plan never leak into the other (course ids overlap between plans).
---------------------------------------------------------------------------- */
const CATALOGS = [
  { id: '2024', url: 'data/curriculum.json',      label: '2024/2025 or later' },
  { id: '2018', url: 'data/curriculum-2018.json', label: 'Fall 2018 – 2023/2024' },
];
const CATALOG_KEY = 'curriculum.catalog';
const passedKey = () => `curriculum.passed.${CATALOG.id}`;

let CATALOG;                    // the active entry of CATALOGS
let ALL = new Map();            // catalog id -> parsed JSON (both loaded at boot, for Compare)
let DATA;                       // the active catalog's JSON
let BY_ID = new Map();          // id -> course
let UNLOCKS = new Map();        // id -> [ids that list it as a prerequisite]
let NOTES_BY_CODE = new Map();  // "CS201" -> course from courses.json (for the notes link)

const hasGraph = data => !(data.dataStatus && data.dataStatus.prerequisitesSourced === false);
const catOf = c => DATA.categories[c.category] || { label: c.category, accent: '#888' };

/* ---- 2. Graph derivation ---------------------------------------------------- */
function buildGraph(data){
  BY_ID = new Map(data.courses.map(c => [c.id, c]));
  UNLOCKS = new Map(data.courses.map(c => [c.id, []]));
  for(const c of data.courses)
    for(const p of c.prerequisites || [])
      if(UNLOCKS.has(p)) UNLOCKS.get(p).push(c.id);
}

function ancestors(id){
  const seen = new Set(); const queue = [...(BY_ID.get(id).prerequisites || [])];
  while(queue.length){
    const x = queue.shift();
    if(seen.has(x) || !BY_ID.has(x)) continue;
    seen.add(x); queue.push(...(BY_ID.get(x).prerequisites || []));
  }
  return seen;
}

function descendants(id){
  const seen = new Set(); const queue = [...UNLOCKS.get(id)];
  while(queue.length){
    const x = queue.shift();
    if(seen.has(x)) continue;
    seen.add(x); queue.push(...UNLOCKS.get(x));
  }
  return seen;
}

/* ---- 3. Layout ---------------------------------------------------------------
   Columns = levels. Inside a level, a course that needs another course *of the
   same level* moves one sub-column right so every arrow points left → right.
   Rows are ordered by the average row of a course's prerequisites (barycenter).
---------------------------------------------------------------------------- */
const NODE_W = 126, NODE_H = 54;   // keep in sync with .cnode in CSS
const SUB_GAP = 36, LEVEL_GAP = 56, ROW_H = 64, PAD = 24;

let LAYOUT = new Map();            // id -> { x, y }
let COLUMNS = [];                  // [{ level, sub, ids, x }]
let GRAPH_W = 0, GRAPH_H = 0;

function depthInLevel(c, memo){
  if(memo.has(c.id)) return memo.get(c.id);
  const same = (c.prerequisites || []).map(p => BY_ID.get(p)).filter(p => p && p.level === c.level);
  const d = same.length ? 1 + Math.max(...same.map(p => depthInLevel(p, memo))) : 0;
  memo.set(c.id, d);
  return d;
}

function computeLayout(){
  const levels = [...new Set(DATA.courses.map(c => c.level))].sort((a, b) => a - b);
  const memo = new Map();
  COLUMNS = [];
  for(const level of levels){
    const inLevel = DATA.courses.filter(c => c.level === level);
    const maxSub = Math.max(...inLevel.map(c => depthInLevel(c, memo)));
    for(let sub = 0; sub <= maxSub; sub++){
      const ids = inLevel.filter(c => depthInLevel(c, memo) === sub)
        .sort((a, b) => a.category.localeCompare(b.category) || a.short.localeCompare(b.short))
        .map(c => c.id);
      COLUMNS.push({ level, sub, ids });
    }
  }
  const row = new Map();
  for(const col of COLUMNS){
    col.ids.forEach((id, i) => row.set(id, i));
    const key = id => {
      const placed = (BY_ID.get(id).prerequisites || []).filter(p => row.has(p) && !col.ids.includes(p));
      return placed.length ? placed.reduce((s, p) => s + row.get(p), 0) / placed.length : row.get(id);
    };
    col.ids.sort((a, b) => key(a) - key(b) || a.localeCompare(b));
    col.ids.forEach((id, i) => row.set(id, i));
  }
  const tallest = Math.max(...COLUMNS.map(c => c.ids.length));
  GRAPH_H = PAD * 2 + 30 + tallest * ROW_H;
  let x = PAD;
  LAYOUT = new Map();
  COLUMNS.forEach((col, i) => {
    if(i > 0) x += (col.level !== COLUMNS[i - 1].level) ? LEVEL_GAP : SUB_GAP;
    col.x = x;
    const offset = (tallest - col.ids.length) * ROW_H / 2;
    col.ids.forEach((id, r) => LAYOUT.set(id, { x, y: PAD + 30 + offset + r * ROW_H }));
    x += NODE_W;
  });
  GRAPH_W = x + PAD;
}

/* ---- 4. Render graph / list ------------------------------------------------- */
function nodeHTML(c){
  const unlocks = UNLOCKS.get(c.id).length;
  const hasNotes = NOTES_BY_CODE.has(c.short);
  return `
    <button type="button" class="cnode ${unlocks >= 5 ? 'choke' : ''}" data-id="${esc(c.id)}"
            style="--cat:${esc(catOf(c).accent)}"
            aria-label="${esc(c.short)} ${esc(c.name)}, ${c.credits} credits${unlocks ? `, unlocks ${unlocks}` : ''}">
      <span class="code">${esc(c.short)}${c.conditions?.length ? ' <span class="cond" title="has a condition">!</span>' : ''}</span>
      <span class="name">${esc(c.name)}</span>
      <span class="meta">${c.credits} cr${unlocks ? ` · unlocks ${unlocks}` : ''}${hasNotes ? ' · ≡' : ''}</span>
    </button>`;
}

function renderGraph(){
  const graph = $('#graph'), nodes = $('#nodes'), svg = $('#edges');
  graph.style.width = GRAPH_W + 'px'; graph.style.height = GRAPH_H + 'px';
  svg.setAttribute('viewBox', `0 0 ${GRAPH_W} ${GRAPH_H}`);
  svg.setAttribute('width', GRAPH_W); svg.setAttribute('height', GRAPH_H);

  const levels = [...new Set(COLUMNS.map(c => c.level))];
  const headers = levels.map(level => {
    const cols = COLUMNS.filter(c => c.level === level);
    const x0 = cols[0].x, x1 = cols.at(-1).x + NODE_W;
    return `<div class="level-label" style="left:${x0}px;width:${x1 - x0}px;top:${PAD}px">${level}-level</div>`;
  }).join('');
  nodes.innerHTML = headers + COLUMNS.flatMap(col => col.ids).map(id => {
    const p = LAYOUT.get(id);
    return nodeHTML(BY_ID.get(id)).replace('style="', `style="left:${p.x}px;top:${p.y}px;`);
  }).join('');

  const defs = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
  const paths = DATA.courses.flatMap(c => (c.prerequisites || []).map(p => {
    const a = LAYOUT.get(p), b = LAYOUT.get(c.id);
    if(!a || !b) return '';
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
    const dx = Math.max(30, (x2 - x1) / 2);
    return `<path class="edge ${c.verify ? 'verify' : ''}" data-from="${esc(p)}" data-to="${esc(c.id)}"
              d="M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" marker-end="url(#arrow)"/>`;
  }));
  svg.innerHTML = defs + paths.join('');
}

function renderList(){
  const levels = [...new Set(COLUMNS.map(c => c.level))];
  $('#nodes').innerHTML = levels.map(level => `
    <section class="list-level">
      <h3 class="group-head">${level}-level</h3>
      ${COLUMNS.filter(c => c.level === level).flatMap(c => c.ids).map(id => {
        const c = BY_ID.get(id);
        const needs = (c.prerequisites || []).map(p => BY_ID.get(p)?.short || p).join(', ');
        return `<div class="list-row">${nodeHTML(c)}<span class="needs">${needs ? 'needs ' + esc(needs) : 'no prerequisites'}${c.verify ? ' · <em>unconfirmed</em>' : ''}</span></div>`;
      }).join('')}
    </section>`).join('');
  $('#edges').innerHTML = '';
}

function renderLegend(){
  const cats = Object.values(DATA.categories).map(c =>
    `<span class="legend-item"><i style="background:${esc(c.accent)}"></i>${esc(c.label)}</span>`).join('');
  $('#legend').innerHTML = cats + `
    <span class="legend-item"><i class="legend-choke"></i>chokepoint (unlocks 5+)</span>
    <span class="legend-item"><i class="legend-dash"></i>unconfirmed prerequisite</span>
    <span class="legend-item"><i class="legend-cond">!</i>extra condition</span>
    <span class="legend-item"><i class="legend-cond">≡</i>has notes on this site</span>`;
}

/* ---- 5. Selection + detail panel ------------------------------------------- */
let selected = null;

function select(id){
  selected = (selected === id) ? null : id;
  applyHighlight(); renderDetail();
}

function applyHighlight(){
  const nodes = document.querySelectorAll('.cnode'), edges = document.querySelectorAll('.edge');
  if(!selected){
    nodes.forEach(n => n.classList.remove('sel', 'up', 'down', 'dim'));
    edges.forEach(e => e.classList.remove('hl', 'dim'));
    return;
  }
  const up = ancestors(selected), down = descendants(selected);
  nodes.forEach(n => {
    const id = n.dataset.id;
    n.classList.toggle('sel', id === selected);
    n.classList.toggle('up', up.has(id));
    n.classList.toggle('down', down.has(id));
    n.classList.toggle('dim', id !== selected && !up.has(id) && !down.has(id));
  });
  const inSet = id => id === selected || up.has(id) || down.has(id);
  edges.forEach(e => {
    const on = inSet(e.dataset.from) && inSet(e.dataset.to);
    e.classList.toggle('hl', on); e.classList.toggle('dim', !on);
  });
}

function courseChip(id){
  const c = BY_ID.get(id);
  if(!c) return `<span class="note-tag">${esc(id)}</span>`;
  return `<button type="button" class="note-tag chip-link" data-jump="${esc(id)}" style="--cat:${esc(catOf(c).accent)}">${esc(c.short)}</button>`;
}

function renderDetail(){
  const box = $('#detail');
  if(!selected){ box.innerHTML = `<div class="empty">Select a course to see its details.</div>`; return; }
  const c = BY_ID.get(selected), unlocks = UNLOCKS.get(c.id), notes = NOTES_BY_CODE.get(c.short);
  const status = mode === 'plan' ? availability(c.id) : null;
  box.innerHTML = `
    <div class="detail-head" style="--cat:${esc(catOf(c).accent)}">
      <div class="code">${esc(c.short)} · ${esc(c.id)}</div>
      <h3>${esc(c.name)}</h3>
      ${c.nameAr ? `<div class="ar" lang="ar" dir="rtl">${esc(c.nameAr)}</div>` : ''}
      <div class="facts"><span>${c.credits} credits</span><span>·</span><span>${c.level}-level</span><span>·</span><span>${esc(catOf(c).label)}</span></div>
    </div>
    ${status ? `
    <label class="passed-toggle"><input type="checkbox" data-passed="${esc(c.id)}" ${passed.has(c.id) ? 'checked' : ''}> I've passed this course</label>
    <div class="status status-${status.state}">${esc(status.text)}</div>` : ''}
    ${c.note ? `<p class="detail-note">${esc(c.note)}</p>` : ''}
    ${c.verify ? `<p class="detail-verify">⚠ Unconfirmed: ${esc(c.verify)}</p>` : ''}
    <dl>
      <dt>Prerequisites</dt>
      <dd>${c.prerequisites?.length ? c.prerequisites.map(courseChip).join(' ') : '<span class="muted">none</span>'}</dd>
      ${c.conditions?.length ? `<dt>Conditions</dt><dd>${c.conditions.map(x => `<span class="note-tag">${esc(x.label)}</span>`).join(' ')}</dd>` : ''}
      <dt>Unlocks <span class="muted">(${unlocks.length} direct · ${descendants(c.id).size} total)</span></dt>
      <dd>${unlocks.length ? unlocks.map(courseChip).join(' ') : '<span class="muted">nothing — a leaf course</span>'}</dd>
      <dt>Full chain</dt>
      <dd class="muted">${ancestors(c.id).size} course${ancestors(c.id).size === 1 ? '' : 's'} before it</dd>
    </dl>
    ${notes ? `<a class="btn btn-ghost btn-sm" href="${courseUrl(notes)}">notes for ${esc(c.short)} →</a>` : ''}`;
}

/* ---- 6. Passed tracking (shared) + Plan mode (graph plans only) -----------
   `passed` is a Set mirrored to localStorage under a per-catalog key.
   Availability needs prerequisite edges, so it is only ever computed for
   plans that have them; the checklist just sums credits.
---------------------------------------------------------------------------- */
let mode = 'explore';
let passed = new Set();

function loadPassed(){
  try{ passed = new Set(JSON.parse(localStorage.getItem(passedKey()) || '[]')); }catch(_){ passed = new Set(); }
}
function savePassed(){ try{ localStorage.setItem(passedKey(), JSON.stringify([...passed])); }catch(_){} }
function creditsPassed(){ return [...passed].reduce((s, id) => s + (BY_ID.get(id)?.credits || 0), 0); }

function togglePassed(id, on){
  on ? passed.add(id) : passed.delete(id);
  savePassed(); refreshPassedViews();
}
function resetPassed(){
  if(!confirm('Clear all passed courses for this plan?')) return;
  passed.clear(); savePassed(); refreshPassedViews();
}
/** Re-render whatever is showing passed state for the active plan. */
function refreshPassedViews(){
  if(hasGraph(DATA)){ applyPlanClasses(); renderDetail(); }
  else renderChecklist();
}

function availability(id){
  const c = BY_ID.get(id);
  if(passed.has(id)) return { state: 'passed', text: 'Passed' };
  const missing = (c.prerequisites || []).filter(p => !passed.has(p)).map(p => BY_ID.get(p)?.short || p);
  if(missing.length) return { state: 'locked', text: `Locked — still need ${missing.join(', ')}` };
  for(const cond of (c.conditions || [])){
    if(cond.type === 'credits-passed' && creditsPassed() < cond.minimum)
      return { state: 'locked', text: `Locked — ${cond.label} (you have ${creditsPassed()})` };
    if(cond.type === 'approval') return { state: 'conditional', text: `Prerequisites met — ${cond.label}` };
  }
  return { state: 'available', text: 'Available — you can take this now' };
}

function applyPlanClasses(){
  const nodes = document.querySelectorAll('.cnode');
  if(mode !== 'plan'){ nodes.forEach(n => n.classList.remove('p-passed', 'p-available', 'p-conditional', 'p-locked')); return; }
  let available = 0;
  nodes.forEach(n => {
    const { state } = availability(n.dataset.id);
    n.classList.remove('p-passed', 'p-available', 'p-conditional', 'p-locked');
    n.classList.add('p-' + state);
    if(state === 'available') available++;
  });
  $('#plan-credits').textContent = creditsPassed();
  $('#plan-available').textContent = available;
}

function setMode(next){
  mode = next;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('#plan-summary').hidden = mode !== 'plan';
  applyPlanClasses(); renderDetail();
}

/* ---- 7. Checklist view ---------------------------------------------------------
   For plans with no prerequisite data. Courses grouped by category with a
   checkbox each; per-category and overall credit totals. `verify` text is
   shown as a grey "unconfirmed" line and never treated as a rule.
---------------------------------------------------------------------------- */
function renderChecklist(){
  const groups = Object.entries(DATA.categories).map(([key, cat]) => {
    const courses = DATA.courses.filter(c => c.category === key)
      .sort((a, b) => a.level - b.level || a.short.localeCompare(b.short));
    const total = courses.reduce((s, c) => s + c.credits, 0);
    const done  = courses.filter(c => passed.has(c.id)).reduce((s, c) => s + c.credits, 0);
    return `
      <section class="check-group" style="--cat:${esc(cat.accent)}">
        <h3 class="group-head">${esc(cat.label)} <span>${done} / ${total} credits</span></h3>
        <ul class="check-list">
          ${courses.map(c => {
            const notes = NOTES_BY_CODE.get(c.short);
            return `
            <li class="check-row ${passed.has(c.id) ? 'is-passed' : ''}">
              <label>
                <input type="checkbox" data-passed="${esc(c.id)}" ${passed.has(c.id) ? 'checked' : ''}>
                <span class="code">${esc(c.short)}</span>
                <span class="name">${esc(c.name)}${notes ? ` <a class="notes-link" href="${courseUrl(notes)}" title="notes on this site">≡</a>` : ''}</span>
                <span class="cr">${c.credits} cr</span>
                <span class="lvl">${c.level}</span>
              </label>
              ${c.note ? `<div class="row-note">${esc(c.note)}</div>` : ''}
              ${c.verify ? `<div class="row-verify">unconfirmed: ${esc(c.verify)}</div>` : ''}
            </li>`;
          }).join('')}
        </ul>
      </section>`;
  }).join('');
  $('#checklist').innerHTML = groups;

  $('#check-credits').textContent = creditsPassed();
  $('#check-total').textContent = DATA.program.totalCredits;
  $('#check-count').textContent = passed.size;

  const r = DATA.program.requirements;
  $('#check-rules').innerHTML = `
    <h3 class="group-head">Elective rules</h3>
    <ul class="rules rules-strong">${DATA.program.electiveRules.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h3 class="group-head">Credit breakdown <span>${DATA.program.totalCredits}</span></h3>
    <ul class="rules">
      <li>University: ${r.university.total} (${r.university.compulsory} compulsory + ${r.university.elective} elective)</li>
      <li>College of Science: ${r.collegeOfScience.total} (${r.collegeOfScience.compulsory} compulsory + ${r.collegeOfScience.elective} elective)</li>
      <li>Department: ${r.department.total} (${r.department.core} core + ${r.department.elective} elective)</li>
      <li>Free electives: ${r.freeElectives}</li>
    </ul>
    <p class="muted-note">University, free and unlisted science electives aren't courses in this file, so the credit count above only covers what's on the list.</p>`;
}

/* ---- 8. Study plan tab -------------------------------------------------- */
function renderStudyPlan(){
  const years = [...new Set(DATA.suggestedStudyPlan.map(t => t.year))];
  $('#study-plan').innerHTML = years.map(year => {
    const terms = DATA.suggestedStudyPlan.filter(t => t.year === year);
    const yearCredits = terms.reduce((s, t) => s + t.credits, 0);
    return `
      <section class="plan-year">
        <h3 class="group-head">Year ${year} <span>${yearCredits} credits</span></h3>
        <div class="plan-terms">
          ${terms.map(t => `
            <div class="plan-term">
              <div class="plan-term-head"><strong>${esc(t.term)}</strong><span>${t.credits} cr</span></div>
              <ul>${t.slots.map(slot => {
                const c = BY_ID.get(slot);
                return c
                  ? `<li class="slot" style="--cat:${esc(catOf(c).accent)}"><button type="button" class="slot-link" data-jump="${esc(c.id)}"><b>${esc(c.short)}</b> ${esc(c.name)}</button><span>${c.credits}</span></li>`
                  : `<li class="slot placeholder"><span>${esc(slot)}</span></li>`;
              }).join('')}</ul>
            </div>`).join('')}
        </div>
      </section>`;
  }).join('');
  const r = DATA.program.requirements;
  $('#plan-rules').innerHTML = `
    <h3 class="group-head">Degree requirements <span>${DATA.program.totalCredits} credits</span></h3>
    <ul class="rules">
      <li>University: ${r.university.total} (${r.university.compulsory} compulsory + ${r.university.elective} elective)</li>
      <li>College of Science: ${r.collegeOfScience.total} (${r.collegeOfScience.compulsory} compulsory + ${r.collegeOfScience.elective} elective)</li>
      <li>Department: ${r.department.total} (${r.department.core} core + ${r.department.elective} elective)</li>
      <li>Free electives: ${r.freeElectives}</li>
      ${DATA.program.electiveRules.map(x => `<li>${esc(x)}</li>`).join('')}
    </ul>`;
}

/* ---- 9. Compare tab -----------------------------------------------------------
   Diff the two catalogs by course code. "Renumbered" = a course that vanished
   under one code and appeared under another with the same name. Nothing here
   is hand-written; change either JSON and the diff follows.
---------------------------------------------------------------------------- */
function renderCompare(){
  const [oldC, newC] = [ALL.get('2018'), ALL.get('2024')];
  if(!oldC || !newC){ $('#compare').innerHTML = `<div class="empty">Both catalogs are needed to compare.</div>`; return; }
  // Ignore cosmetic spelling differences ("&" vs "and", "CS" vs "Computer Science").
  const norm = n => n.toLowerCase().replace(/&/g, 'and').replace(/cs/g, 'computer science').replace(/\s+/g, ' ').trim();
  const sameName = (a, b) => norm(a) === norm(b);
  const byCode = d => new Map(d.courses.map(c => [c.short, c]));
  const O = byCode(oldC), N = byCode(newC);
  const catLabel = (d, c) => d.categories[c.category]?.label || c.category;

  const dropped = [...O.values()].filter(c => !N.has(c.short));
  const added   = [...N.values()].filter(c => !O.has(c.short));
  // Renumbered: same name on both sides under different codes.
  const renumbered = dropped.flatMap(o => added.filter(n => sameName(n.name, o.name)).map(n => ({ from: o, to: n })));
  const renumSet = new Set(renumbered.flatMap(r => [r.from.short, r.to.short]));
  const moved = [...O.values()].filter(c => N.has(c.short) && N.get(c.short).category !== c.category)
    .map(c => ({ c, from: catLabel(oldC, c), to: catLabel(newC, N.get(c.short)) }));
  const renamed = [...O.values()].filter(c => N.has(c.short) && !sameName(N.get(c.short).name, c.name))
    .map(c => ({ code: c.short, from: c.name, to: N.get(c.short).name }));
  const credits = [...O.values()].filter(c => N.has(c.short) && N.get(c.short).credits !== c.credits)
    .map(c => ({ code: c.short, from: c.credits, to: N.get(c.short).credits }));

  const row = (code, name, a, b) => `<tr><td class="mono">${esc(code)}</td><td>${esc(name)}</td><td>${a}</td><td>${b}</td></tr>`;
  const table = (title, head, rows) => rows.length ? `
    <h3 class="group-head">${title} <span>${rows.length}</span></h3>
    <div class="table-scroll"><table class="cmp"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '';

  const rq = (d, k) => d.program.requirements[k];
  $('#compare').innerHTML = `
    <div class="cmp-summary">
      <div><b>${esc(oldC.program.catalogYear)}</b> ${esc(oldC.program.appliesTo)} · ${oldC.program.totalCredits} credits · ${oldC.courses.length} courses</div>
      <div><b>${esc(newC.program.catalogYear)}</b> ${esc(newC.program.appliesTo)} · ${newC.program.totalCredits} credits · ${newC.courses.length} courses</div>
    </div>
    ${table('Credit requirements', ['Area', '', oldC.program.catalogYear, newC.program.catalogYear], [
      row('Total', '', oldC.program.totalCredits, newC.program.totalCredits),
      row('University', '', rq(oldC,'university').total, rq(newC,'university').total),
      row('College of Science', '', rq(oldC,'collegeOfScience').total, rq(newC,'collegeOfScience').total),
      row('Department core', '', rq(oldC,'department').core, rq(newC,'department').core),
      row('Department elective', '', rq(oldC,'department').elective, rq(newC,'department').elective),
      row('Free electives', '', oldC.program.freeElectives ?? rq(oldC,'freeElectives'), newC.program.freeElectives ?? rq(newC,'freeElectives')),
    ])}
    ${table('Moved between categories', ['Code', 'Course', oldC.program.catalogYear, newC.program.catalogYear], moved.map(m => row(m.c.short, m.c.name, esc(m.from), esc(m.to))))}
    ${table('Renumbered', ['Old code', 'Course', 'New code', ''], renumbered.map(r => row(r.from.short, r.from.name, esc(r.to.short), '')))}
    ${table('Renamed', ['Code', '', oldC.program.catalogYear, newC.program.catalogYear], renamed.map(r => row(r.code, '', esc(r.from), esc(r.to))))}
    ${table('Credits changed', ['Code', 'Course', oldC.program.catalogYear, newC.program.catalogYear], credits.map(r => row(r.code, O.get(r.code).name, r.from, r.to)))}
    ${table('Dropped in ' + newC.program.catalogYear, ['Code', 'Course', 'Was', ''], dropped.filter(c => !renumSet.has(c.short)).map(c => row(c.short, c.name, esc(catLabel(oldC, c)), '')))}
    ${table('New in ' + newC.program.catalogYear, ['Code', 'Course', 'Now', ''], added.filter(c => !renumSet.has(c.short)).map(c => row(c.short, c.name, esc(catLabel(newC, c)), '')))}
    <h3 class="group-head">Elective rules</h3>
    <div class="cmp-rules">
      <div><h4>${esc(oldC.program.catalogYear)}</h4><ul class="rules">${oldC.program.electiveRules.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h4>${esc(newC.program.catalogYear)}</h4><ul class="rules">${newC.program.electiveRules.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    </div>`;
}

/* ---- 10. Tabs, activation, boot ------------------------------------------ */
let view = 'graph';

function setView(next){
  view = next;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#graph').classList.toggle('is-list', view === 'list');
  view === 'graph' ? renderGraph() : renderList();
  applyHighlight(); applyPlanClasses();
}

/** Build the tab strip for the active plan and show the first tab. */
function buildTabs(){
  const tabs = [];
  if(hasGraph(DATA)) tabs.push({ id: 'map', label: 'Prerequisite map' });
  else tabs.push({ id: 'checklist', label: 'Requirements checklist' });
  if(DATA.suggestedStudyPlan) tabs.push({ id: 'plan', label: 'Suggested study plan' });
  if(ALL.size > 1) tabs.push({ id: 'compare', label: 'Compare plans' });
  $('#tabs').innerHTML = tabs.map(t =>
    `<button type="button" role="tab" class="tab" id="tab-${t.id}" data-panel="panel-${t.id}" aria-selected="false" aria-controls="panel-${t.id}">${t.label}</button>`).join('');
  showTab('panel-' + tabs[0].id);
}

function showTab(panelId){
  document.querySelectorAll('[role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.panel === panelId)));
  document.querySelectorAll('[role="tabpanel"]').forEach(p => p.hidden = p.id !== panelId);
}

function jumpTo(id){
  showTab('panel-map');
  selected = null; select(id);
  const node = document.querySelector(`.cnode[data-id="${CSS.escape(id)}"]`);
  if(node){ node.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); node.focus({ preventScroll: true }); }
}

/** Switch the page to a catalog: swap DATA, reset state, render its views. */
function activate(catalogId){
  CATALOG = CATALOGS.find(c => c.id === catalogId) || CATALOGS[0];
  DATA = ALL.get(CATALOG.id);
  try{ localStorage.setItem(CATALOG_KEY, CATALOG.id); }catch(_){}
  document.querySelectorAll('[data-catalog]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.catalog === CATALOG.id)));

  buildGraph(DATA);
  loadPassed();
  selected = null; mode = 'explore';

  // Header
  $('#program-name').textContent = `${DATA.program.name} · ${DATA.program.catalogYear} plan`;
  $('#program-meta').textContent = DATA.program.appliesTo;
  $('#source-link').href = DATA.program.source;
  $('#page-title').textContent = hasGraph(DATA) ? 'Which course unlocks what' : 'Your requirements checklist';

  // Missing-data notice (only when the file says prerequisites aren't sourced).
  const notice = $('#data-notice');
  notice.hidden = hasGraph(DATA);
  if(!hasGraph(DATA)) notice.innerHTML = `<strong>No prerequisite data for this plan.</strong> ${esc(DATA.dataStatus.warning)}`;

  // Views
  if(hasGraph(DATA)){
    $('#plan-total').textContent = DATA.program.totalCredits;
    computeLayout(); renderLegend();
    setMode('explore');
    setView(window.matchMedia('(max-width: 700px)').matches ? 'list' : 'graph');
  }else{
    renderChecklist();
  }
  if(DATA.suggestedStudyPlan) renderStudyPlan();
  renderCompare();
  buildTabs();
}

async function initCurriculum(){
  const [jsons, courses] = await Promise.all([
    Promise.all(CATALOGS.map(c => fetch(c.url).then(r => { if(!r.ok) throw new Error(`Could not load ${c.url}`); return r.json(); }))),
    loadCourses().catch(() => []),
  ]);
  CATALOGS.forEach((c, i) => ALL.set(c.id, jsons[i]));
  NOTES_BY_CODE = new Map(courses.map(c => [c.code.replace(' ', ''), c]));

  $('#catalog-buttons').innerHTML = CATALOGS.map(c =>
    `<button type="button" class="tag-chip" data-catalog="${c.id}" aria-pressed="false">${esc(c.label)}</button>`).join('');

  // ?catalog=<id> (from the home page) beats the saved choice; ?mode=plan opens Plan mode.
  const params = new URLSearchParams(location.search);
  let saved = null;
  try{ saved = localStorage.getItem(CATALOG_KEY); }catch(_){}
  activate(params.get('catalog') || saved || CATALOGS[0].id);
  if(params.get('mode') === 'plan' && hasGraph(DATA)) setMode('plan');

  // --- events (delegated)
  document.addEventListener('click', e => {
    const t = e.target;
    const node = t.closest('.cnode');        if(node){ select(node.dataset.id); return; }
    const jump = t.closest('[data-jump]');   if(jump){ jumpTo(jump.dataset.jump); return; }
    const cat  = t.closest('[data-catalog]');if(cat){ activate(cat.dataset.catalog); return; }
    const md   = t.closest('[data-mode]');   if(md){ setMode(md.dataset.mode); return; }
    const vw   = t.closest('[data-view]');   if(vw){ setView(vw.dataset.view); return; }
    const tab  = t.closest('[role="tab"]');  if(tab){ showTab(tab.dataset.panel); return; }
    if(t.closest('[data-reset]')) resetPassed();
  });
  document.addEventListener('change', e => {
    if(e.target.matches('[data-passed]')) togglePassed(e.target.dataset.passed, e.target.checked);
  });
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && selected) select(selected);
    if(e.key === ' ' && mode === 'plan' && e.target.classList?.contains('cnode')){
      e.preventDefault(); togglePassed(e.target.dataset.id, !passed.has(e.target.dataset.id));
    }
  });
}

/**
 * For the home page: a summary of the visitor's saved plan, using the SAME
 * availability rules as the curriculum page (no duplicated logic). Returns
 * null when no plan has been chosen yet. Loads only the chosen catalog file.
 */
async function planSummary(){
  let id = null;
  try{ id = localStorage.getItem(CATALOG_KEY); }catch(_){}
  const cat = CATALOGS.find(c => c.id === id);
  if(!cat) return null;
  const data = await fetch(cat.url).then(r => r.json());
  CATALOG = cat; DATA = data; ALL.set(cat.id, data);
  buildGraph(data); loadPassed();
  const graph = hasGraph(data);
  return {
    catalog: cat,
    total: data.program.totalCredits,
    credits: creditsPassed(),
    passedCount: passed.size,
    hasGraph: graph,
    // Only plans with prerequisite data can say what's available.
    available: graph ? data.courses.filter(c => availability(c.id).state === 'available') : null,
  };
}

// Only boot the full page on curriculum.html; the home page loads this file
// for planSummary() alone.
if(document.body.dataset.page === 'curriculum')
document.addEventListener('DOMContentLoaded', () => {
  initCurriculum().catch(err => {
    console.error(err);
    $('main').innerHTML = `<div class="section"><div class="empty">Couldn't load the curriculum data. If you opened this file directly, serve it with <code>python -m http.server</code>.</div></div>`;
  });
});
