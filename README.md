# Notes++

A static course-notes site. No build step, no frameworks — plain HTML, CSS and JS.

## Run it locally

The pages load `data/courses.json` with `fetch()`, which browsers block on `file://` URLs.
So don't double-click `index.html` — serve the folder instead:

```
python -m http.server
```

then open <http://localhost:8000>. GitHub Pages serves it the same way, so nothing changes on deploy.

## Layout

```
index.html         home: search (live results), 'Your plan' dashboard, start-here cards, 5 recent notes
courses.html       all courses grouped by year, with search + level filter
course.html        one course — driven by ?course=<id>
curriculum.html    curriculum explorer for both catalog years (see below)
resources.html     general links (department site, study sites) from data/resources.json
viewer.html        one PDF — driven by ?course=<id>&note=<filename>
css/style.css      all styles; design tokens at the top, light theme right below
js/i18n.js         translation engine + language toggle
js/main.js         all behaviour; one init function per page
js/curriculum.js   the curriculum explorer
data/courses.json  all course + note + course-link content
data/resources.json  general (non-course) links, grouped
data/ui.json       every interface string, in English and Arabic
fonts/             Watad (Arabic web font), self-hosted
img/               the Notes++ wordmark, as outlined SVG + PNG
pdfs/              the PDF files referenced by courses.json
tools/stamp_pdfs.py    renames + stamps new PDFs to the site template (needs pip install pypdf)
tools/make_wordmark.py rebuilds the outlined wordmark (build-time only)
```

## Add a course

1. Add an object to the `courses` array in `data/courses.json`:
   `id` (used in URLs — lowercase, no spaces), `code`, `name`, `description`,
   `category` (Core/Elective), `level` (year 1-4, used for grouping), `color`
   (any CSS colour — currently one per level), `icon` (1-2 characters), `notes: []`, `links: []`.
2. That's it — the grid, the terminal `ls`, and the course page all pick it up.

## Add a note (lecture, lab, problem set…)

1. Name the PDF with the site template and drop it into `pdfs/`:

   `<CODE> - <Course name> - <Note title> - Notes++.pdf`

   e.g. `CS321 - Operating Systems - Lecture 03 - CPU Scheduling - Notes++.pdf`
   or   `CS321 - Operating Systems - Lab 02 - Threads - Notes++.pdf`

   Or skip the naming: drop the file in with any name, add the JSON entry, then run
   `python tools/stamp_pdfs.py` — it renames the file to the template, writes
   Title/Author metadata (`Notes++`) inside the PDF, and updates the JSON for you.
2. Add an object to that course's `notes` array:

   ```json
   {
     "title": "Lecture 3 — CPU scheduling",
     "type": "lecture",
     "description": "FCFS, SJF, round robin, MLFQ.",
     "tags": ["scheduling"],
     "filename": "CS321 - Operating Systems - Lecture 03 - CPU Scheduling - Notes++.pdf",
     "dateAdded": "2026-10-01"
   }
   ```

   `type` must be one of `syllabus`, `lecture`, `lab`, `problem-set`, `review`, `exam`, `reference`, `other`.
   The course page shows a separate section for each type, so lectures and labs
   never mix. Lectures/labs/problem sets sort by title (number-aware: "Lecture 2"
   before "Lecture 10"), so start titles with "Lecture N" / "Lab N".

Dates are ISO strings on purpose: they sort correctly with a plain string compare.

## Curriculum

`curriculum.html` serves two catalog years from one script (`js/curriculum.js`):

| File | Plan | Views |
|---|---|---|
| `data/curriculum.json` | 2024 (admitted 2024/25+) | prerequisite map, Plan mode, study plan, compare |
| `data/curriculum-2018.json` | 2018 (admitted 2018–2023) | requirements checklist, compare |

Which views a plan gets is decided by its data, not its year: a file whose
`dataStatus.prerequisitesSourced` is `false` gets the checklist only (no graph, no
"what can I take"). `unlocks` is never stored — it's derived by inverting `prerequisites`.
Courses with `verify` are drawn dashed (graph) or marked "unconfirmed" (checklist).
"Passed" ticks are stored per plan in localStorage (`curriculum.passed.<year>`).
The Compare tab is computed from the two files — nothing in it is hand-written.

## Arabic / العربية

The whole interface is bilingual. A toggle in the nav (EN / ع) switches language; the
choice is saved in localStorage and applied before the first paint, so nothing flashes.

| Piece | Where |
|---|---|
| Every UI string, both languages | `data/ui.json` (~210 keys) |
| Translation engine, toggle, RTL switch | `js/i18n.js` |
| Static markup | `data-i18n="key"` attributes in the HTML |
| Generated markup | `t('key')` calls in `main.js` / `curriculum.js` |
| Font | `--sans-ar` in `css/style.css` → Watad, self-hosted |
| RTL layout | `[dir="rtl"]` rules in `css/style.css` §2c |

The English left in the HTML is a **fallback**, not dead weight: if JavaScript fails,
the page still reads correctly in English.

**Adding a language:** add a top-level key to `ui.json` with the same key set, plus an
entry in `_languages`. Nothing else changes. Missing keys fall back to English, so a
half-finished translation degrades gracefully instead of showing blanks.

**Plurals:** add a `key_one` variant where a language needs a singular ("1 note" vs
"3 notes"). It is used only when the *current* language defines it, so a missing Arabic
plural never drags in the English sentence.

**Content vs interface.** The interface is fully translated. Content is translated where
the data has it: all 38 courses have `nameAr`, and both curriculum files carry Arabic
programme and category names. Note titles are still English — add `titleAr` /
`descriptionAr` to any note and it appears. In Arabic, pages lead with the Arabic name
and show the English underneath.

**Direction is per-element, not just per-page.** Data-driven text is rendered with
`dir="auto"`, so an Arabic note title inside an English list still reads correctly.
The prerequisite graph deliberately stays left-to-right even in Arabic: its arrows
encode time (100-level → 400-level), so mirroring it would reverse the meaning.

**Numerals stay Western** (2024, CS201, 3 credits) in both languages, including dates
(`ar-KW-u-nu-latn`) — course codes are Western, and mixing digit systems in one line
reads worse than picking one.

## Fonts and licences

Two Arabic fonts were considered:

| Font | Web embedding | Used for |
|---|---|---|
| **Watad** (Almohtaraf) | `fsType: 0` — installable, no embedding restriction | all Arabic text |
| **Thmanyah Sans** | **Forbidden** by its licence | the wordmark only, as outlines |

Thmanyah's licence prohibits web embedding outright: *"Make the Font Software available
in any manner that allows end users … to extract, download, access … including through
web embedding."* Hosting a `.woff2` does exactly that. It does permit use "in logos,
branding, websites", which is why the wordmark — converted to vector outlines, containing
no font data — is fine. To use Thmanyah for live text you would need written permission
from `ask@thmanyah.com`; with that, changing `--sans-ar` is the whole job.

### The wordmark

`img/wordmark*.svg` is the Notes++ lettering **set in Thmanyah Sans and converted to
vector outlines** — geometry only, no font data, nothing extractable as a typeface.
Regenerate it (only if the wordmark text changes, and only on a machine with the font):

```
pip install fonttools uharfbuzz pymupdf
python tools/make_wordmark.py
```

The script shapes the text with HarfBuzz, then emits each glyph as an SVG path. Output:
cream ink for dark backgrounds, navy for light, plus PNGs. The nav picks the right one
via a CSS theme swap. English-only by choice.

## Later phases (not built yet)

Look for `LATER (...)` comments in `main.js` and the HTML — each marks where a
future piece (backend, uploads, admin, analytics, CLI) would attach.
