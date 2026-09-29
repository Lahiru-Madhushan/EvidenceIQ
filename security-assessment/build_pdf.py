"""Render the assessment report to a submission-ready PDF.

Converts EvidenceIQ-IR-Security-Assessment.md to styled, print-optimised HTML and then
prints it to PDF with headless Edge or Chrome - the same route the team's existing
docs/EvidenceIQ-Database-Guide.pdf was produced by, so it needs no extra toolchain.

Re-run this after filling in your name, ID and date in the Markdown, and after adding
screenshots, so the PDF stays in step with the source.

    cd d:/SliitProject/IWRA/EvidenceIQ/security-assessment
    ../backend/venv/Scripts/python.exe build_pdf.py

Requires the `markdown` package. If it is not importable, the script points at a
--target install so the project virtual environment is never modified:

    ../backend/venv/Scripts/python.exe -m pip install --target .pylibs markdown pymdown-extensions
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "EvidenceIQ-IR-Security-Assessment.md"
OUTPUT = HERE / "EvidenceIQ-IR-Security-Assessment.pdf"

# A local --target install, if one was used to avoid touching the project venv.
_LOCAL_LIBS = HERE / ".pylibs"
if _LOCAL_LIBS.is_dir():
    sys.path.insert(0, str(_LOCAL_LIBS))

try:
    import markdown
except ImportError:  # pragma: no cover - environment guidance, not logic
    sys.exit(
        "The `markdown` package is required.\n\n"
        "Install it WITHOUT modifying the project venv:\n"
        f"    {sys.executable} -m pip install --target {_LOCAL_LIBS} markdown pymdown-extensions"
    )


BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def find_browser() -> str:
    for candidate in BROWSERS:
        if Path(candidate).is_file():
            return candidate
    for name in ("msedge", "chrome", "chromium"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit(
        "No Chromium-based browser found. Install Microsoft Edge or Google Chrome, "
        "or convert with Pandoc instead:\n"
        "    pandoc EvidenceIQ-IR-Security-Assessment.md -o report.pdf"
    )


# --------------------------------------------------------------------------------------
# Print stylesheet
#
# Sized against the report's actual content: the widest ASCII architecture diagram is
# 78 characters, and the widest code line about 95, both of which fit inside the 174mm
# text column at 8.5pt monospace without wrapping. pre-wrap is kept as a safety net so
# nothing is ever clipped off the page edge.
# --------------------------------------------------------------------------------------

CSS = """
@page {
  size: A4;
  margin: 18mm 16mm 18mm 16mm;
}

:root {
  --ink:        #111827;
  --muted:      #4b5563;
  --rule:       #d1d5db;
  --rule-soft:  #e5e7eb;
  --accent:     #1d4ed8;
  --code-bg:    #f6f8fa;
  --th-bg:      #eef2f7;
  --crit-bg:    #fef2f2;
  --crit-edge:  #dc2626;
}

* { box-sizing: border-box; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  font-family: "Segoe UI", "Calibri", Arial, sans-serif;
  font-size: 10.2pt;
  line-height: 1.52;
  color: var(--ink);
  margin: 0;
}

/* ---------- cover ---------- */

.cover {
  page-break-after: always;
  height: 252mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
  padding: 0 8mm;
}
.cover .eyebrow {
  font-size: 10pt;
  letter-spacing: 2.4px;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10mm;
}
.cover h1 {
  font-size: 27pt;
  line-height: 1.22;
  margin: 0 0 5mm;
  border: none;
  padding: 0;
  color: var(--ink);
}
.cover h2 {
  font-size: 14pt;
  font-weight: 600;
  color: var(--accent);
  margin: 0 0 12mm;
  border: none;
  padding: 0;
  page-break-before: auto;
}
.cover .rule {
  width: 62mm;
  height: 2.5px;
  background: var(--accent);
  margin: 0 auto 12mm;
}
.cover .module { font-size: 11.5pt; color: var(--muted); margin-bottom: 3mm; }
.cover .lecturer { font-size: 10.5pt; color: var(--muted); margin-bottom: 10mm; }

.cover table {
  width: 118mm;
  margin: 0 auto;
  font-size: 10pt;
  border: 1px solid var(--rule);
}
.cover table td { padding: 2.6mm 4mm; text-align: left; }
.cover table td:first-child { font-weight: 600; width: 44mm; background: var(--th-bg); }

.cover .footnote {
  margin-top: 16mm;
  font-size: 9pt;
  color: var(--muted);
}

/* ---------- headings ---------- */

h1, h2, h3, h4, h5, h6 {
  page-break-after: avoid;
  page-break-inside: avoid;
  color: var(--ink);
  font-weight: 700;
}

/* Each numbered section starts a fresh page. */
h2 {
  font-size: 16pt;
  margin: 0 0 6mm;
  padding-bottom: 2.5mm;
  border-bottom: 2.2px solid var(--accent);
  page-break-before: always;
}
h2:first-of-type { page-break-before: avoid; }

h3 {
  font-size: 12.6pt;
  margin: 8mm 0 3mm;
  padding-bottom: 1.6mm;
  border-bottom: 1px solid var(--rule-soft);
}

h4 {
  font-size: 11.2pt;
  margin: 6.5mm 0 2.5mm;
  color: #1f2937;
}

h5, h6 { font-size: 10.4pt; margin: 5mm 0 2mm; }

/* Each test case and each vulnerability starts its own page: they are read as
   self-contained units and a split one is much harder to mark. The class is applied
   in Python rather than by id selector, so the FIRST item under a group heading can
   be excluded - otherwise every group heading is left stranded on a page of its own. */
h3.pb, h4.pb { page-break-before: always; }

p { margin: 0 0 3.2mm; orphans: 3; widows: 3; }

ul, ol { margin: 0 0 3.4mm; padding-left: 6.5mm; }
li { margin-bottom: 1.4mm; }

a { color: var(--accent); text-decoration: none; }

strong { font-weight: 700; }

hr {
  border: none;
  border-top: 1px solid var(--rule-soft);
  margin: 6mm 0;
}

/* ---------- tables ---------- */

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.1pt;
  margin: 3.5mm 0 5mm;
  page-break-inside: auto;
}
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td {
  border: 1px solid var(--rule);
  padding: 1.9mm 2.6mm;
  text-align: left;
  vertical-align: top;
  word-break: normal;
  overflow-wrap: break-word;
}
th { background: var(--th-bg); font-weight: 700; }
tbody tr:nth-child(even) { background: #fafbfc; }

/* ---------- code ---------- */

pre {
  background: var(--code-bg);
  border: 1px solid var(--rule-soft);
  border-left: 3px solid var(--accent);
  border-radius: 3px;
  padding: 3mm 3.5mm;
  margin: 3mm 0 4.5mm;
  font-size: 8.5pt;
  line-height: 1.38;
  white-space: pre-wrap;
  word-break: normal;
  overflow-wrap: anywhere;
  page-break-inside: avoid;
}
pre code {
  font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
  background: none;
  padding: 0;
  font-size: inherit;
}
/* Long listings must be allowed to break, or they overflow a whole page. */
pre.long { page-break-inside: auto; }

code {
  font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
  background: var(--code-bg);
  border: 1px solid var(--rule-soft);
  border-radius: 2px;
  padding: 0.3mm 1mm;
  font-size: 8.9pt;
}
th code, td code { font-size: 8.4pt; }

/* ---------- callouts ---------- */

blockquote {
  margin: 3.5mm 0 4.5mm;
  padding: 3mm 4mm;
  background: var(--crit-bg);
  border-left: 3.5px solid var(--crit-edge);
  border-radius: 3px;
  page-break-inside: avoid;
}
blockquote p:last-child { margin-bottom: 0; }
blockquote h3 { margin-top: 0; border: none; }

/* ---------- table of contents ---------- */

.toc-block { page-break-after: always; }
.toc-block ol { padding-left: 7mm; }
.toc-block li { margin-bottom: 1.9mm; font-size: 10.5pt; }

img { max-width: 100%; page-break-inside: avoid; border: 1px solid var(--rule-soft); margin: 2mm 0 4mm; }
.cover img.logo { width: 21mm; border: none; margin: 0 auto 3mm; }
.cover .institution { font-size: 12pt; font-weight: 600; margin-bottom: 7mm; }
"""


def build_cover(fields: dict[str, str]) -> str:
    rows = "\n".join(
        f"<tr><td>{label}</td><td>{value}</td></tr>" for label, value in fields.items()
    )
    return f"""
<div class="cover">
  <img class="logo" src="sliit-logo.png" alt="SLIIT">
  <div class="institution">Sri Lanka Institute of Information Technology</div>
  <div class="eyebrow">Individual AI Security Audit &amp; Vulnerability Assessment</div>
  <h1>AI Vulnerability<br>Assessment Report</h1>
  <div class="rule"></div>
  <h2>Information Retrieval and Security Assessment<br>EvidenceIQ Agentic AI System</h2>
  <div class="module">IT3041 &mdash; Information Retrieval and Web Analytics</div>
  <div class="lecturer">Lecturer in Charge: Mr. Samadhi Chathuranga Rathnayake</div>
  <table>{rows}</table>
  <div class="footnote">
    Specialization: Student 4 &middot; 20 test cases &middot; 12 vulnerabilities identified
    &middot; 7 controls verified effective
  </div>
</div>
"""


def extract_cover_fields(text: str) -> tuple[dict[str, str], str]:
    """Pull the metadata table off the top of the report and use it for the cover.

    Returns the fields plus the report body with that front matter removed, so the
    details are not printed twice.
    """
    fields: dict[str, str] = {}
    wanted = {
        "Student Name": "Student Name",
        "Student ID": "Student ID",
        "Group": "Group",
        "Assessment Date": "Assessment Date",
        "Report Version": "Report Version",
    }
    for label in wanted:
        match = re.search(rf"^\|\s*{re.escape(label)}\s*\|\s*(.+?)\s*\|\s*$", text, re.M)
        if match:
            value = match.group(1).replace("_(fill in)_", "&nbsp;").strip()
            fields[label] = value or "&nbsp;"

    fields.setdefault("Student Name", "&nbsp;")
    fields.setdefault("Student ID", "&nbsp;")
    fields.setdefault("Assessment Date", "&nbsp;")
    fields["System Under Test"] = "EvidenceIQ"
    fields["Classification"] = "Internal &mdash; Academic Assessment"

    # Drop everything above the Table of Contents: the cover now carries it.
    marker = text.find("## Table of Contents")
    body = text[marker:] if marker != -1 else text
    return fields, body


def slugify(heading: str) -> str:
    slug = heading.strip().lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    return re.sub(r"[\s_]+", "-", slug).strip("-")


def add_heading_ids(html: str) -> str:
    """Give headings stable ids so cross-references and the TOC resolve."""

    def repl(match: re.Match[str]) -> str:
        level, inner = match.group(1), match.group(2)
        text = re.sub(r"<[^>]+>", "", inner)
        return f'<h{level} id="{slugify(text)}">{inner}</h{level}>'

    return re.sub(r"<h([1-6])>(.*?)</h\1>", repl, html, flags=re.S)


def drop_rules_before_headings(html: str) -> str:
    """Remove `---` separators that sit directly in front of a heading.

    Two reasons. They are redundant - every heading already carries its own rule and
    the major ones start a fresh page. And a rule that lands exactly on a page boundary
    ahead of a `page-break-before: always` heading produces a completely blank page,
    which is what page 84 of the first render was.
    """
    return re.sub(r"<hr\s*/?>\s*(?=<h[1-6][\s>])", "", html)


def mark_page_breaks(html: str) -> str:
    """Start each test case and each vulnerability on its own page.

    A test case or a finding is read as one unit, so splitting one across a page break
    makes it materially harder to mark. The exception is the first item under a group
    heading: breaking there would strand "Group C - Hallucination Due to Retrieval" on
    an otherwise empty page, so that one stays with the heading that introduces it.
    """
    pattern = re.compile(r'<(h3|h4) id="((?:tc|v)-[^"]*)">')

    def repl(match: re.Match[str]) -> str:
        tag, heading_id = match.group(1), match.group(2)
        # Only TC-nn and V-nn headings, not e.g. "v-alidation" or a group heading.
        if not re.match(r"^(tc|v)-\d", heading_id):
            return match.group(0)
        preceding = html[: match.start()].rstrip()
        # Directly after a section or group heading: keep them on the same page.
        if preceding.endswith("</h2>") or preceding.endswith("</h3>"):
            return match.group(0)
        return f'<{tag} class="pb" id="{heading_id}">'

    return pattern.sub(repl, html)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep-html", action="store_true", help="keep the intermediate HTML")
    args = parser.parse_args()

    if not SOURCE.is_file():
        sys.exit(f"Report not found: {SOURCE}")

    raw = SOURCE.read_text(encoding="utf-8")
    fields, body = extract_cover_fields(raw)

    rendered = markdown.markdown(
        body,
        extensions=["tables", "fenced_code", "sane_lists", "attr_list", "md_in_html"],
        output_format="html5",
    )
    rendered = add_heading_ids(rendered)
    rendered = drop_rules_before_headings(rendered)
    rendered = mark_page_breaks(rendered)
    # Keep identifiers such as V-01 or TC-14 on one line inside narrow table cells.
    rendered = re.sub(r"(<td>(?:<strong>)?)((?:TC|V|C|M|EV)-\d\d[a-z]?)", r'\1<span style="white-space:nowrap">\2</span>', rendered)

    # The Table of Contents is a list of links; give it its own page.
    rendered = rendered.replace(
        '<h2 id="table-of-contents">Table of Contents</h2>',
        '<div class="toc-block"><h2 id="table-of-contents">Table of Contents</h2>',
        1,
    ).replace('<h2 id="1-executive-summary">', "</div><h2 id=\"1-executive-summary\">", 1)

    html = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<title>EvidenceIQ - Information Retrieval and Security Assessment</title>"
        f"<base href=\"{HERE.as_uri()}/\"><style>{CSS}</style></head><body>"
        f"{build_cover(fields)}{rendered}"
        "</body></html>"
    )

    with tempfile.TemporaryDirectory() as tmp:
        html_path = (HERE / "report.html") if args.keep_html else (Path(tmp) / "report.html")
        html_path.write_text(html, encoding="utf-8")

        browser = find_browser()
        print(f"Rendering with: {browser}")

        result = subprocess.run(
            [
                browser,
                "--headless",
                "--disable-gpu",
                "--no-sandbox",
                "--no-pdf-header-footer",
                "--run-all-compositor-stages-before-draw",
                "--virtual-time-budget=20000",
                f"--print-to-pdf={OUTPUT}",
                html_path.as_uri(),
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )

        if not OUTPUT.is_file():
            sys.exit(f"PDF was not produced.\n{result.stdout}\n{result.stderr}")

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"Written: {OUTPUT}  ({size_kb:,.0f} KB)")
    if args.keep_html:
        print(f"HTML kept: {HERE / 'report.html'}")


if __name__ == "__main__":
    main()
