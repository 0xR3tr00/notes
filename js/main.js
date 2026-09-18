/* =============================================================================
   Notes·Hub — main.js
   -----------------------------------------------------------------------------
   One script for the whole site. It is organised top-to-bottom as:

     1. Theme toggle            (runs on every page)
     2. Data loading            (fetches data/courses.json)
     3. Small helpers           (escaping, dates, URLs)
     4. HTML "templates"        (functions that turn a course/note into HTML)
     5. Page initialisers       (initHome / initCourse / initViewer)
     6. Boot                    (decides which initialiser to run)

   Each HTML page declares which page it is with <body data-page="home">, and
   the boot section at the bottom uses that to pick the right initialiser.
   ============================================================================= */
'use strict';

/* ---- 1. Theme ---------------------------------------------------------------
   The chosen theme is stored in localStorage under "theme" and applied as
   <html data-theme="light|dark">. CSS does the rest (see :root[data-theme]).

   NOTE: each page also has a tiny inline <script> in its <head> that applies
   the saved theme *before* the page paints. Without that, a light-mode user
   would see a flash of dark background on every page load, because this file
   only runs after the HTML has been parsed.
---------------------------------------------------------------------------- */
const THEME_KEY = 'theme';

function getTheme(){
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function setTheme(theme){
  document.documentElement.dataset.theme = theme;
  try{ localStorage.setItem(THEME_KEY, theme); }catch(_){ /* private mode etc. */ }
  updateThemeButton();
}

function updateThemeButton(){
  const btn = document.querySelector('.theme-toggle');
  if(!btn) return;
  const light = getTheme() === 'light';
  btn.querySelector('.icon').textContent  = light ? '☾' : '☀';
  btn.querySelector('.label').textContent = light ? 'dark' : 'light';
  btn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
}

function initTheme(){
  const btn = document.querySelector('.theme-toggle');
  if(btn) btn.addEventListener('click', () => setTheme(getTheme() === 'light' ? 'dark' : 'light'));
  updateThemeButton();
}

/* ---- 2. Data ----------------------------------------------------------------
   All content comes from one JSON file. This is the single seam where a real
   backend would plug in: swap the URL for an API endpoint and nothing else
   in the site needs to change, as long as the JSON shape stays the same.

   LATER (backend): fetch('/api/courses') instead of the static file.
---------------------------------------------------------------------------- */
const DATA_URL = 'data/courses.json';
const PDF_DIR  = 'pdfs/';

async function loadCourses(){
  const res = await fetch(DATA_URL);
  if(!res.ok) throw new Error(`Could not load ${DATA_URL} (${res.status})`);
  const data = await res.json();
  return data.courses;
}

/* ---- 3. Helpers ------------------------------------------------------------- */

/** Shorthand for document.querySelector. */
const $ = (sel, root = document) => root.querySelector(sel);

/**
 * Escape text before inserting it into an HTML string.
 *
 * IMPORTANT — understand this one. We build HTML with template literals
 * (`<h3>${...}</h3>`). If a note title contained "<img onerror=...>" and we
 * dropped it in raw, the browser would run it. Today the JSON is yours, but
 * once students can upload, every string from data is untrusted. Escaping
 * turns < > & " ' into harmless entities so text is always just text.
 */
function esc(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "2026-09-15" -> "15 Sep 2026". Dates stay ISO in JSON so they sort correctly. */
function formatDate(iso){
  const d = new Date(iso + 'T00:00:00');
  if(isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Read a ?key=value from the current page URL. */
function param(name){
  return new URLSearchParams(location.search).get(name);
}

/** Flatten every course's notes into one list, each note knowing its course. */
function allNotes(courses){
  return courses.flatMap(course => course.notes.map(note => ({ ...note, course })));
}

/** Newest N notes across all courses. ISO dates compare correctly as strings. */
function recentNotes(courses, n){
  return allNotes(courses)
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded))
    .slice(0, n);
}

/** The most recent date inside one course (for the card's "updated" line). */
function latestDate(course){
  return course.notes.map(n => n.dateAdded).sort().at(-1);
}

/* URL builders — kept in one place so changing the routing later is one edit. */
const courseUrl = course => `course.html?course=${encodeURIComponent(course.id)}`;
const viewerUrl = (course, note) =>
  `viewer.html?course=${encodeURIComponent(course.id)}&note=${encodeURIComponent(note.filename)}`;
const pdfUrl = note => PDF_DIR + encodeURIComponent(note.filename);

/** Case-insensitive "does this note match the query" — title, description, tags. */
function noteMatches(note, q){
  if(!q) return true;
  const hay = [note.title, note.description, ...note.tags].join(' ').toLowerCase();
  return hay.includes(q);
}

/** A course matches if its own text matches OR any of its notes do. */
function courseMatches(course, q){
  if(!q) return true;
  const own = [course.name, course.code, course.description, course.category].join(' ').toLowerCase();
  return own.includes(q) || course.notes.some(n => noteMatches(n, q));
}

/* ---- 4. Templates -----------------------------------------------------------
   Pure functions: data in, HTML string out. No DOM access, no side effects.
   That makes them easy to reason about and easy to reuse across pages.
   Note the inline style="--course-accent: ..." — that's how each card gets
   its own colour without generating per-course CSS.
---------------------------------------------------------------------------- */

function courseCardHTML(course){
  const count = course.notes.length;
  const updated = count ? `updated ${formatDate(latestDate(course))}` : 'no notes yet';
  return `
    <a href="${courseUrl(course)}" class="course-card" style="--course-accent:${esc(course.color)}">
      <div class="card-top">
        <span class="tag">${esc(course.category)} · ${esc(course.code)}</span>
        <span class="course-icon" aria-hidden="true">${esc(course.icon)}</span>
      </div>
      <h3>${esc(course.name)}</h3>
      <p>${esc(course.description)}</p>
      <div class="meta">
        <span>${count} ${count === 1 ? 'note' : 'notes'}</span><span>·</span><span>${esc(updated)}</span>
      </div>
    </a>`;
}

/** One note row. `showCourse` adds a "in <course>" link — used on the homepage. */
function noteItemHTML(note, course, { showCourse = false } = {}){
  const tags = note.tags.map(t => `<span class="note-tag">${esc(t)}</span>`).join('');
  const courseLink = showCourse
    ? `<a class="course-link" href="${courseUrl(course)}">${esc(course.code)}</a><span>·</span>`
    : '';
  return `
    <li class="note-item" style="--course-accent:${esc(course.color)}">
      <div>
        <h3><a href="${viewerUrl(course, note)}">${esc(note.title)}</a></h3>
        <p>${esc(note.description)}</p>
        <div class="note-meta">
          ${courseLink}
          <span>${formatDate(note.dateAdded)}</span>
          ${tags}
        </div>
      </div>
      <div class="note-actions">
        <a class="btn btn-ghost btn-sm" href="${viewerUrl(course, note)}">view</a>
        <a class="btn btn-ghost btn-sm" href="${pdfUrl(note)}" download>download</a>
      </div>
    </li>`;
}

/* The "Add a course" card is static for now.
   LATER (admin panel): link this to the admin "new course" form. */
const ADD_COURSE_HTML = `
    <a href="#contribute" class="course-card add">
      <div>
        <div class="plus" aria-hidden="true">+</div>
        <div>Add a course</div>
      </div>
    </a>`;

/* ---- 5. Pages --------------------------------------------------------------- */

/** index.html — course grid, search, recently added. */
function initHome(courses){
  const grid    = $('#course-grid');
  const recent  = $('#recent-list');
  const search  = $('#search');
  const count   = $('#search-count');
  const RECENT_N = 6;

  // Recently added — newest notes across every course.
  recent.innerHTML = recentNotes(courses, RECENT_N)
    .map(n => noteItemHTML(n, n.course, { showCourse: true }))
    .join('') || `<li class="empty">No notes yet.</li>`;

  // Render the grid for a given query (empty query = everything).
  function render(){
    const q = search.value.trim().toLowerCase();
    const shown = courses.filter(c => courseMatches(c, q));

    grid.innerHTML = shown.map(courseCardHTML).join('') + (q ? '' : ADD_COURSE_HTML);

    if(!q){
      count.textContent = '';
    }else if(shown.length === 0){
      count.textContent = `no courses match "${search.value.trim()}"`;
    }else{
      const noteHits = allNotes(shown).filter(n => noteMatches(n, q)).length;
      count.textContent = `${shown.length} course${shown.length === 1 ? '' : 's'} · ${noteHits} matching note${noteHits === 1 ? '' : 's'}`;
    }
  }

  search.addEventListener('input', render);
  render();

  // Fill the fake terminal's `ls` output from real data — small touch, but it
  // means the hero never drifts out of sync with the actual course list.
  const ls = $('#terminal-ls');
  if(ls) ls.innerHTML = courses.map(c => `<div class="out">${esc(c.id)}/</div>`).join('');
}

/** course.html — one course's notes with search + tag filters. */
function initCourse(courses){
  const course = courses.find(c => c.id === param('course'));
  if(!course){
    $('#course-main').innerHTML = `
      <div class="section"><div class="empty">
        Course not found. <a href="index.html">Back to all courses</a>.
      </div></div>`;
    return;
  }

  document.title = `${course.name} — Notes`;

  // Header
  const hero = $('#course-hero');
  hero.style.setProperty('--course-accent', course.color);
  $('#course-icon').textContent = course.icon;
  $('#course-code').textContent = `${course.category} · ${course.code}`;
  $('#course-name').textContent = course.name;
  $('#course-desc').textContent = course.description;

  // Tag filter chips: one per unique tag in this course, in alphabetical order.
  const tags = [...new Set(course.notes.flatMap(n => n.tags))].sort();
  const filters = $('#tag-filters');
  filters.innerHTML = tags
    .map(t => `<button type="button" class="tag-chip" aria-pressed="false" data-tag="${esc(t)}">${esc(t)}</button>`)
    .join('');

  const list   = $('#note-list');
  const search = $('#search');
  const count  = $('#search-count');
  let activeTag = null;   // null = no tag filter

  function render(){
    const q = search.value.trim().toLowerCase();
    const shown = course.notes
      .filter(n => noteMatches(n, q))
      .filter(n => !activeTag || n.tags.includes(activeTag))
      .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));

    list.innerHTML = shown.map(n => noteItemHTML(n, course)).join('')
      || `<li class="empty">No notes match.</li>`;

    count.textContent = `${shown.length} of ${course.notes.length} notes`;
  }

  // Clicking a chip toggles it; clicking the active chip clears the filter.
  // aria-pressed tells screen readers (and our CSS) which chip is active.
  filters.addEventListener('click', e => {
    const chip = e.target.closest('.tag-chip');
    if(!chip) return;
    activeTag = activeTag === chip.dataset.tag ? null : chip.dataset.tag;
    filters.querySelectorAll('.tag-chip')
      .forEach(c => c.setAttribute('aria-pressed', String(c.dataset.tag === activeTag)));
    render();
  });

  search.addEventListener('input', render);
  render();
}

/** viewer.html — show one PDF inline, with explicit download + open-in-tab links. */
function initViewer(courses){
  const course = courses.find(c => c.id === param('course'));
  const note   = course && course.notes.find(n => n.filename === param('note'));

  if(!note){
    $('#viewer-main').innerHTML = `
      <div class="section"><div class="empty">
        Note not found. <a href="index.html">Back to all courses</a>.
      </div></div>`;
    return;
  }

  document.title = `${note.title} — ${course.name}`;
  $('#crumb-course').textContent = course.name;
  $('#crumb-course').href = courseUrl(course);
  $('#note-title').textContent = note.title;

  const url = pdfUrl(note);
  $('#open-link').href = url;
  $('#download-link').href = url;

  // The <iframe> asks the browser to use its built-in PDF viewer. Desktop
  // browsers all have one; some mobile browsers don't and will show the
  // fallback text inside the frame — which is why the buttons above exist.
  const frame = $('#pdf-frame');
  frame.src = url;
  frame.title = `PDF: ${note.title}`;
}

/* ---- 6. Boot ----------------------------------------------------------------
   LATER (analytics): a page-view ping would go here, once per load.
   LATER (CLI / tooling): nothing runs in the browser for that — it would be a
   separate script that edits data/courses.json and drops files into pdfs/.
---------------------------------------------------------------------------- */
const PAGES = { home: initHome, course: initCourse, viewer: initViewer };

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  const init = PAGES[document.body.dataset.page];
  if(!init) return;

  try{
    init(await loadCourses());
  }catch(err){
    console.error(err);
    const main = $('main');
    if(main) main.innerHTML = `
      <div class="section"><div class="empty">
        Couldn't load course data.<br><br>
        If you opened this file directly (file://), serve it instead:<br>
        <code>python -m http.server</code> then open http://localhost:8000
      </div></div>`;
  }
});
