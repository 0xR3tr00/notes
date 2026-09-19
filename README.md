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
js/main.js         all behaviour; one init function per page
data/courses.json  all course + note + course-link content
data/resources.json  general (non-course) links, grouped
pdfs/              the PDF files referenced by courses.json
tools/stamp_pdfs.py  renames + stamps new PDFs to the site template (needs pip install pypdf)
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

## Later phases (not built yet)

Look for `LATER (...)` comments in `main.js` and the HTML — each marks where a
future piece (backend, uploads, admin, analytics, CLI) would attach.
