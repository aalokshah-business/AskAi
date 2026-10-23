"""Render the generated AskAI command sheet to a searchable PDF.

Run after ``node scripts/gen-docs.js``. Requires PyMuPDF.
"""
from pathlib import Path
import hashlib
import re

import pymupdf


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs" / "CHEAT_SHEET.md"
OUTPUT = ROOT / "docs" / "CHEAT_SHEET.pdf"
WIDTH, HEIGHT = pymupdf.paper_size("a4")
LEFT, RIGHT, TOP, BOTTOM = 43, 43, 47, 48
INK = (0.10, 0.15, 0.22)
MUTED = (0.38, 0.44, 0.50)
ACCENT = (0.02, 0.48, 0.48)
RULE = (0.83, 0.87, 0.90)


def clean(value):
    value = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", value)
    value = value.replace("`", "").replace("**", "")
    return value.replace("…", "...").replace("—", "-").replace("→", "->").replace("·", "-")


def wrap(value, width, size, font="helv"):
    words = clean(value).split()
    lines, line = [], ""
    for word in words:
        candidate = (line + " " + word).strip()
        if pymupdf.get_text_length(candidate, fontname=font, fontsize=size) <= width or not line:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines or [""]


doc = pymupdf.open()
page = None
y = 0


def new_page():
    global page, y
    page = doc.new_page(width=WIDTH, height=HEIGHT)
    page.draw_rect(pymupdf.Rect(0, 0, WIDTH, 10), color=None, fill=ACCENT)
    y = TOP


def space(height):
    if page is None or y + height > HEIGHT - BOTTOM:
        new_page()


def paragraph(value, size=9, color=INK, gap=7):
    global y
    lines = wrap(value, WIDTH - LEFT - RIGHT, size)
    line_height = size * 1.43
    space(len(lines) * line_height + gap)
    for line in lines:
        page.insert_text((LEFT, y + size), line, fontname="helv", fontsize=size, color=color)
        y += line_height
    y += gap


def heading(value, level):
    global y
    size = 21 if level == 1 else 13
    gap = 14 if level == 1 else 10
    space(size * 2.8)
    if level == 2:
        page.draw_line((LEFT, y), (WIDTH - RIGHT, y), color=RULE, width=0.8)
        y += 9
    page.insert_text((LEFT, y + size), clean(value), fontname="hebo", fontsize=size, color=INK)
    y += size + gap


def table_row(cells, header=False):
    global y
    count = len(cells)
    available = WIDTH - LEFT - RIGHT
    ratios = [0.34, 0.66] if count == 2 else [0.25, 0.34, 0.41] if count == 3 else [1 / count] * count
    widths = [available * ratio for ratio in ratios]
    size = 8.0 if count <= 3 else 7.4
    lines = [wrap(cell, widths[i] - 13, size, "hebo" if header else "helv") for i, cell in enumerate(cells)]
    height = max(len(part) for part in lines) * (size * 1.37) + 12
    space(height)
    if header:
        page.draw_rect(pymupdf.Rect(LEFT, y, WIDTH - RIGHT, y + height), color=None, fill=INK)
    else:
        page.draw_line((LEFT, y + height), (WIDTH - RIGHT, y + height), color=RULE, width=0.5)
    x = LEFT
    for i, part in enumerate(lines):
        for j, line in enumerate(part):
            page.insert_text((x + 6, y + 7 + size + j * size * 1.37), line,
                             fontname="hebo" if header else "helv", fontsize=size,
                             color=(1, 1, 1) if header else INK)
        x += widths[i]
    y += height


new_page()
in_mermaid = False
table_header = True
for raw in SOURCE.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if line == "```mermaid":
        in_mermaid = True
        continue
    if in_mermaid:
        if line == "```":
            in_mermaid = False
        continue
    if not line:
        table_header = True
        continue
    if line.startswith("# "):
        heading(line[2:], 1)
    elif line.startswith("## "):
        heading(line[3:], 2)
    elif line.startswith("|---"):
        continue
    elif line.startswith("|"):
        cells = [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip("|"))]
        table_row(cells, table_header)
        table_header = False
    else:
        paragraph(line, color=MUTED if line.startswith("Legacy spellings") else INK)

for number, sheet in enumerate(doc, 1):
    label = f"AskAI command sheet  -  {number}/{len(doc)}"
    sheet.draw_line((LEFT, HEIGHT - 35), (WIDTH - RIGHT, HEIGHT - 35), color=RULE, width=0.7)
    sheet.insert_text((LEFT, HEIGHT - 23), label, fontname="helv", fontsize=8, color=MUTED)

digest = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
doc.set_metadata({"title": "AskAI command sheet", "subject": "Generated from docs/CHEAT_SHEET.md", "keywords": f"askai-md-sha256:{digest}"})
doc.save(OUTPUT, garbage=4, deflate=True)
print(f"wrote {OUTPUT} ({len(doc)} pages)")
