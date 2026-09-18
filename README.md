# Notes·Hub

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
index.html         homepage: course grid, search, recently added
course.html        one course — driven by ?course=<id>
viewer.html        one PDF — driven by ?course=<id>&note=<filename>
css/style.css      all styles; design tokens at the top, light theme right below
js/main.js         all behaviour; one init function per page
data/courses.json  ALL content lives here
pdfs/              the PDF files referenced by courses.json
```

## Add a course

1. Add an object to the `courses` array in `data/courses.json`:
   `id` (used in URLs — lowercase, no spaces), `code`, `name`, `description`,
   `category`, `color` (any CSS colour), `icon` (one character), `notes: []`.
2. That's it — the grid, the terminal `ls`, and the course page all pick it up.

## Add a note

1. Drop the PDF into `pdfs/`.
2. Add an object to that course's `notes` array: `title`, `description`, `tags`,
   `filename` (must match the file in `pdfs/` exactly), `dateAdded` (`YYYY-MM-DD`).

Dates are ISO strings on purpose: they sort correctly with a plain string compare.

## Later phases (not built yet)

Look for `LATER (...)` comments in `main.js` and the HTML — each marks where a
future piece (backend, uploads, admin, analytics, CLI) would attach.
