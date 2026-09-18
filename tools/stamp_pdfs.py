"""
stamp_pdfs.py — bring every PDF referenced in data/courses.json up to the site's
naming template and stamp Notes++ metadata inside the file.

    <CODE> - <Course name> - <Note title> - Notes++.pdf

Workflow when adding material:
  1. Drop the PDF into pdfs/ with ANY name (e.g. "lec3.pdf").
  2. Add its entry to that course's notes[] in data/courses.json, with
     "filename": "lec3.pdf".
  3. Run:  python tools/stamp_pdfs.py
     -> the file is renamed to the template, Title/Author metadata is written,
        and courses.json is updated to the new filename.

Safe to run repeatedly: files that are already correct are skipped.
Needs:  pip install pypdf
"""
import json, os, sys
from pypdf import PdfReader, PdfWriter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "courses.json")
PDFS = os.path.join(ROOT, "pdfs")
BRAND = "Notes++"

# What the note type contributes to the filename. Types not listed use the note title.
TYPE_LABEL = {"syllabus": "Course Description"}


def safe(s):
    """Strip characters that Windows and URLs reject in filenames."""
    return "".join(ch for ch in s if ch not in '\\/:*?"<>|').strip()


def target_name(course, note):
    code = course["code"].replace(" ", "")               # "CS 321" -> "CS321"
    label = TYPE_LABEL.get(note["type"], note["title"])
    return safe(f"{code} - {course['name']} - {label} - {BRAND}.pdf")


def already_stamped(path):
    try:
        meta = PdfReader(path).metadata or {}
        return meta.get("/Author") == BRAND
    except Exception:
        return False


def main():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)

    changed = 0
    for course in data["courses"]:
        for note in course["notes"]:
            src = os.path.join(PDFS, note["filename"])
            if not os.path.exists(src):
                print(f"  MISSING  {note['filename']}  (referenced by {course['code']})")
                continue

            new_name = target_name(course, note)
            dst = os.path.join(PDFS, new_name)
            if new_name == note["filename"] and already_stamped(src):
                continue                                  # nothing to do

            writer = PdfWriter()
            writer.append(PdfReader(src))
            writer.add_metadata({
                "/Title": f"{course['code']} {course['name']} — {TYPE_LABEL.get(note['type'], note['title'])}",
                "/Author": BRAND,
                "/Subject": course["name"],
                "/Creator": BRAND,
            })
            with open(dst, "wb") as f:
                writer.write(f)
            if dst != src:
                os.remove(src)
            note["filename"] = new_name
            changed += 1
            print(f"  stamped  {new_name}")

    if changed:
        with open(DATA, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    print(f"done — {changed} file(s) updated")


if __name__ == "__main__":
    sys.exit(main())
