/* =============================================================================
   Notes++ — main.js
   -----------------------------------------------------------------------------
   One script for the whole site. It is organised top-to-bottom as:

     1. Theme toggle            (runs on every page)
     2. Data loading            (fetches data/courses.json)
     3. Small helpers           (escaping, dates, URLs)
     4. HTML "templates"        (functions that turn a course/note into HTML)
     5. Page initialisers       (initHome / initCourses / initCourse / initViewer)
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
  const hay = [note.title, note.description, note.type, ...note.tags].join(' ').toLowerCase();
  return hay.includes(q);
}

/**
 * Pull the 11-character video id out of any common YouTube URL shape, or
 * return null if this isn't a YouTube link. Handles:
 *   youtube.com/watch?v=ID   youtu.be/ID   youtube.com/shorts/ID   youtube.com/embed/ID
 * Using the URL class (instead of regex on the raw string) means we only ever
 * trust real youtube hosts — "notyoutube.com/watch?v=..." won't match.
 */
function youtubeId(url){
  let u;
  try{ u = new URL(url); }catch(_){ return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if(host === 'youtu.be')                       id = u.pathname.slice(1);
  else if(host === 'youtube.com' || host === 'youtube-nocookie.com'){
    if(u.pathname === '/watch')                 id = u.searchParams.get('v');
    else{
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/);
      if(m) id = m[1];
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** "https://www.example.com/path" -> "example.com" (shown on link cards). */
function domainOf(url){
  try{ return new URL(url).hostname.replace(/^www\./, ''); }catch(_){ return url; }
}

/** A course matches if its own text matches OR any of its notes/links do. */
function courseMatches(course, q){
  if(!q) return true;
  const own = [course.name, course.code, course.description, course.category].join(' ').toLowerCase();
  return own.includes(q)
    || course.notes.some(n => noteMatches(n, q))
    || (course.links || []).some(l => (l.title + ' ' + l.description).toLowerCase().includes(q));
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

/**
 * One "useful link" card. YouTube links get a thumbnail with a play button;
 * everything else gets a compact card with the site's domain.
 *
 * External dependency note: the thumbnail is an <img> from img.youtube.com.
 * It's a plain image (no scripts, no cookies) and loads lazily. The actual
 * player is only embedded when someone clicks play — see initLinks().
 */
function linkCardHTML(link, course){
  const id = youtubeId(link.url);
  const media = id ? `
      <button type="button" class="yt-thumb" data-yt="${esc(id)}" aria-label="Play video: ${esc(link.title)}">
        <img src="https://img.youtube.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy">
        <span class="play" aria-hidden="true">▶</span>
      </button>` : '';
  return `
    <li class="link-card ${id ? 'is-video' : ''}" style="--course-accent:${esc(course.color)}">
      ${media}
      <div class="link-body">
        <h3><a href="${esc(link.url)}" target="_blank" rel="noopener">${esc(link.title)} <span aria-hidden="true">↗</span></a></h3>
        <p>${esc(link.description || '')}</p>
        <div class="link-domain">${id ? 'youtube.com' : esc(domainOf(link.url))}</div>
      </div>
    </li>`;
}

/* The "Add a course" card is static for now.
   LATER (admin panel): link this to the admin "new course" form. */
const ADD_COURSE_HTML = `
    <a href="index.html#contribute" class="course-card add">
      <div>
        <div class="plus" aria-hidden="true">+</div>
        <div>Add a course</div>
      </div>
    </a>`;

/* ---- 5. Pages --------------------------------------------------------------- */

/** Colour for each year-level heading on the homepage (matches the cards). */
const LEVEL_COLOR = { 1: '#F2A93B', 2: '#5FD3C4', 3: '#C98BF2', 4: '#F2765B' };

/**
 * Note types, in the order their sections appear on a course page.
 * `byTitle` sections sort number-aware by title (Lecture 2 before Lecture 10);
 * the rest sort newest-first. A note with an unknown/missing type lands in "other".
 */
const NOTE_TYPES = [
  { id: 'syllabus',    label: 'Syllabus',     byTitle: false },
  { id: 'lecture',     label: 'Lectures',     byTitle: true  },
  { id: 'lab',         label: 'Labs',         byTitle: true  },
  { id: 'problem-set', label: 'Problem sets', byTitle: true  },
  { id: 'other',       label: 'Other',        byTitle: false },
];

/**
 * Level filter chips (100 / 200 / 300 / 400), shared by the home and courses
 * pages. Renders the chips into `container` and calls `onChange` whenever the
 * selection changes. Returns a function that gives the current level (or null).
 * Same toggle behaviour as the tag chips: click the active one to clear.
 */
function initLevelFilter(container, courses, onChange){
  const levels = [...new Set(courses.map(c => c.level))].sort();
  let active = null;
  container.innerHTML = levels.map(l =>
    `<button type="button" class="tag-chip" aria-pressed="false" data-level="${l}"
             style="--course-accent:${esc(LEVEL_COLOR[l] || '')}">${l}00-level</button>`).join('');
  container.addEventListener('click', e => {
    const chip = e.target.closest('.tag-chip');
    if(!chip) return;
    const level = Number(chip.dataset.level);
    active = active === level ? null : level;
    container.querySelectorAll('.tag-chip')
      .forEach(c => c.setAttribute('aria-pressed', String(Number(c.dataset.level) === active)));
    onChange();
  });
  return () => active;
}

/** Course cards grouped by year level, each group under a heading. */
function courseGridHTML(courses){
  const levels = [...new Set(courses.map(c => c.level))].sort();
  return levels.map(level => {
    const cards = courses.filter(c => c.level === level).map(courseCardHTML).join('');
    return `<h3 class="level-head" style="--course-accent:${esc(LEVEL_COLOR[level] || '')}">${level}00-level · year ${level}</h3>${cards}`;
  }).join('');
}

/** index.html — search (live results), recently added. */
function initHome(courses){
  const search  = $('#search');
  const count   = $('#search-count');
  const results = $('#results');
  const RECENT_N = 5;

  // Recently added — newest notes across every course.
  $('#recent-list').innerHTML = recentNotes(courses, RECENT_N)
    .map(n => noteItemHTML(n, n.course, { showCourse: true }))
    .join('') || `<li class="empty">No notes yet.</li>`;

  const getLevel = initLevelFilter($('#level-filters'), courses, render);

  // With an empty query and no level picked, results are hidden and the
  // "recently added" section below does the talking. Otherwise show matching
  // courses and matching notes as two lists.
  function render(){
    const q = search.value.trim().toLowerCase();
    const level = getLevel();
    if(!q && !level){
      results.hidden = true;
      count.textContent = '';
      return;
    }
    const pool = courses.filter(c => !level || c.level === level);
    const hitCourses = pool.filter(c => courseMatches(c, q));
    const hitNotes = allNotes(pool).filter(n => noteMatches(n, q))
      .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));

    $('#results-courses').innerHTML = hitCourses.map(courseCardHTML).join('')
      || `<div class="empty">No matching courses.</div>`;
    $('#results-notes').innerHTML = hitNotes.map(n => noteItemHTML(n, n.course, { showCourse: true })).join('')
      || `<li class="empty">No matching notes.</li>`;
    $('#results-course-count').textContent = hitCourses.length;
    $('#results-note-count').textContent = hitNotes.length;
    results.hidden = false;
    count.textContent = `${hitCourses.length} course${hitCourses.length === 1 ? '' : 's'} · ${hitNotes.length} note${hitNotes.length === 1 ? '' : 's'}`;
  }

  search.addEventListener('input', render);
  render();

  // Fill the fake terminal's `ls` output from real data — small touch, but it
  // means the hero never drifts out of sync with the actual course list.
  // Only the first few — 34 lines would push the hero off the screen.
  const ls = $('#terminal-ls');
  if(ls){
    const shown = courses.slice(0, 4);
    ls.innerHTML = shown.map(c => `<div class="out">${esc(c.id)}/</div>`).join('')
      + `<div class="out">… ${courses.length - shown.length} more</div>`;
  }
}

/** courses.html — the full grid with search + level filter. */
function initCourses(courses){
  const grid   = $('#course-grid');
  const search = $('#search');
  const count  = $('#search-count');
  const getLevel = initLevelFilter($('#level-filters'), courses, render);

  function render(){
    const q = search.value.trim().toLowerCase();
    const level = getLevel();
    const shown = courses
      .filter(c => !level || c.level === level)
      .filter(c => courseMatches(c, q));

    grid.innerHTML = (courseGridHTML(shown) || `<div class="empty">No courses match.</div>`)
      + (q || level ? '' : ADD_COURSE_HTML);
    count.textContent = (q || level) ? `${shown.length} of ${courses.length} courses` : '';
  }

  search.addEventListener('input', render);
  render();
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

  document.title = `${course.name} — Notes++`;

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

  const groups = $('#note-groups');
  const search = $('#search');
  const count  = $('#search-count');
  let activeTag = null;   // null = no tag filter

  // Number-aware title compare: "Lecture 2" < "Lecture 10".
  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true });
  const byDateDesc = (a, b) => b.dateAdded.localeCompare(a.dateAdded);

  function render(){
    const q = search.value.trim().toLowerCase();
    const shown = course.notes
      .filter(n => noteMatches(n, q))
      .filter(n => !activeTag || n.tags.includes(activeTag));

    // One <section> per note type, in NOTE_TYPES order; empty groups are skipped.
    const known = NOTE_TYPES.map(t => t.id);
    groups.innerHTML = NOTE_TYPES.map(type => {
      const items = shown
        .filter(n => (known.includes(n.type) ? n.type : 'other') === type.id)
        .sort(type.byTitle ? byTitle : byDateDesc);
      if(!items.length) return '';
      return `
        <section class="note-group" aria-labelledby="group-${type.id}">
          <h3 class="group-head" id="group-${type.id}">${type.label} <span>${items.length}</span></h3>
          <ul class="note-list">${items.map(n => noteItemHTML(n, course)).join('')}</ul>
        </section>`;
    }).join('') || `<div class="empty">No notes match.</div>`;

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

  initLinks(course);
}

/** Useful links shelf on course.html — render, then wire up click-to-play. */
function initLinks(course){
  const links = course.links || [];
  const list = $('#link-list');
  list.innerHTML = links.map(l => linkCardHTML(l, course)).join('')
    || `<li class="empty">No links yet for this course.</li>`;

  // Click-to-play: swap the thumbnail button for the real YouTube player.
  // Only the video someone actually clicks loads YouTube's player code —
  // the page itself never talks to YouTube beyond the thumbnail images.
  list.addEventListener('click', e => {
    const btn = e.target.closest('.yt-thumb');
    if(!btn) return;
    const frame = document.createElement('iframe');
    frame.className = 'yt-player';
    frame.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.yt}?autoplay=1`;
    frame.title = btn.getAttribute('aria-label').replace('Play video: ', '');
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.setAttribute('allowfullscreen', '');
    btn.replaceWith(frame);
  });
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
const PAGES = { home: initHome, courses: initCourses, course: initCourse, viewer: initViewer };

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
