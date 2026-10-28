#!/usr/bin/env python3
"""AskAI command cheat sheets: two A3 images and one PDF, built from lib/help.js.

  docs/AskAI-setup-A3.png     Start here (one-time sequence) + Setup, Health, System commands
  docs/AskAI-working-A3.png   Working loop + Work, Project, Cost, Learn commands
  docs/AskAI-cheatsheet.pdf   both sheets, one page each (searchable text)

The command lists come straight from `askai help` (the same categories), so run this after any command change:
  python scripts/build-cheatsheets.py
Needs Pillow and PyMuPDF (python -m pip install pillow pymupdf).
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
PNG_SETUP = DOCS / "AskAI-setup-A3.png"
PNG_WORK = DOCS / "AskAI-working-A3.png"
PDF_OUT = DOCS / "AskAI-cheatsheet.pdf"

W, H = 1412.0, 1997.0          # design units: A3 portrait (1 : 1.4142)
PNG_W = 7016                   # A3 at 600 dpi
PDF_W, PDF_H = 841.89, 1190.55  # A3 in points

NAVY = (20, 45, 69)
TEAL = (18, 126, 118)
PAPER = (244, 247, 250)
WHITE = (255, 255, 255)
MINT = (233, 245, 243)
DESC = (35, 59, 79)
AMBER = (176, 96, 16)
CREAM = (255, 244, 224)
CMD_AMBER = (140, 72, 8)
MUTED = (210, 227, 234)
FOOT = (81, 100, 117)

LEGEND = "[ ] optional     < > required     a|b pick one     Full detail: askai help <command>"

FONT_FILES = {
    "sans": ["calibri.ttf", "Calibri.ttf", "DejaVuSans.ttf", "Arial.ttf", "arial.ttf", "Helvetica.ttc"],
    "sansb": ["calibrib.ttf", "Calibri Bold.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf"],
    "mono": ["consola.ttf", "Consolas.ttf", "DejaVuSansMono.ttf", "Menlo.ttc", "cour.ttf"],
    "monob": ["consolab.ttf", "Consolas Bold.ttf", "DejaVuSansMono-Bold.ttf", "courbd.ttf"],
}
FONT_DIRS = [
    Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/truetype"),
    Path("/usr/share/fonts"), Path("/Library/Fonts"), Path("/System/Library/Fonts"), Path.home() / ".fonts",
]


def find_font(key):
    for name in FONT_FILES[key]:
        for d in FONT_DIRS:
            if (d / name).exists():
                return str(d / name)
            for hit in d.rglob(name) if d.exists() and d != Path("/usr/share/fonts") else []:
                return str(hit)
    raise SystemExit(f"no usable font for {key}: install Calibri/Consolas or DejaVu")


FONTS = {k: find_font(k) for k in FONT_FILES}
_measure = {}


def text_w(s, key, size):
    """Width in design units: measure once at 10 px per unit."""
    if key not in _measure:
        _measure[key] = ImageFont.truetype(FONTS[key], 100)
    return _measure[key].getlength(s) / 100.0 * size


def wrap(text, key, size, max_w):
    lines, cur = [], ""

    def pieces(word):
        if text_w(word, key, size) <= max_w:
            return [word]
        out, buf = [], ""
        for bit in word.replace("|", "|\u0001").replace("/", "/\u0001").split("\u0001"):
            trial = buf + bit
            if buf and text_w(trial, key, size) > max_w:
                out.append(buf)
                buf = bit
            else:
                buf = trial
        if buf:
            out.append(buf)
        return out or [word]

    for word in text.split(" "):
        for part in pieces(word):
            trial = part if not cur else cur + " " + part
            if cur and text_w(trial, key, size) > max_w:
                lines.append(cur)
                cur = part
            else:
                cur = trial
    if cur:
        lines.append(cur)
    return lines or [""]


# ---- content -------------------------------------------------------------------------------------------------------

def load_help():
    js = (
        "const h=require('./lib/help');const out={version:require('./package.json').version,cats:{}};"
        "for(const [k,c] of Object.entries(h.CATEGORIES)){out.cats[k]={title:c.title,commands:c.commands.map(([n])=>({name:n,"
        "usage:(h.H[n]||{}).usage||('askai '+n),summary:(h.H[n]||{}).summary||''}))};}"
        "process.stdout.write(JSON.stringify(out));"
    )
    run = subprocess.run(["node", "-e", js], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if run.returncode != 0:
        raise SystemExit(f"could not read lib/help.js: {run.stderr}")
    return json.loads(run.stdout)


def clean_usage(usage):
    return " ".join(str(usage).split())


def category_items(data, key):
    cat = data["cats"][key]
    items = [("bar", cat["title"], TEAL)]
    for c in cat["commands"]:
        items.append(("card", clean_usage(c["usage"]), " ".join(c["summary"].split()), TEAL, False))
    return items


SETUP_SEQUENCE = [
    ("bar", "START HERE  \u00b7  the one-time sequence", AMBER),
    ("label", "ONCE PER MACHINE"),
    ("step", "1", "curl -fsSL https://raw.githubusercontent.com/aalokshah-business/AskAi/main/get.sh | bash -s -- --yes",
     "Install AskAI (macOS, Linux, WSL, devcontainer). Windows: get.ps1 -Yes. Container: askai bootstrap --repo writes the post-create script.", False),
    ("step", "2", "askai install --retry", "Finish anything that needed a new shell, a package or a sign-in. Finished parts are skipped.", False),
    ("step", "3", "askai check --all  |  askai infra  |  askai status", "Verify: 0 failing, every host, MCP server, plugin and tier listed.", False),
    ("label", "ONCE PER PROJECT"),
    ("step", "4", "askai init", "In the project folder. Scans the code, writes the pack, agents and Cursor commands. No model, no tokens.", False),
    ("step", "5", "Reload the Cursor window, or start a new Claude Code session", "They read the new files only after that.", False),
    ("step", "6", "/askai-cli --review     Codex: $askai-cli --review", "Start here. Opens the AskAI terminal for the project and has the agent review the generated project files and fill the gaps. This is the one step that uses tokens.", True),
    ("step", "7", "/askai-plugins     Codex: $askai-plugins", "Then this. Finishes the one-time plugin setup and says when each tool is called.", True),
    ("step", "8", "askai todo", "The few steps only you can do: sign-ins, restarts, MCP checks. Each clears itself once done.", False),
    ("label", "PREFER A WINDOW?"),
    ("card", "/askai-gui     Codex: $askai-gui", "Opens the Ask AI desktop app (same as askai desktop open). It runs the same commands as the terminal.", AMBER, True),
    ("label", "KEEPING IT CURRENT"),
    ("card", "askai update", "Fetch the latest AskAI, install what is missing, refresh your projects. Then exit and reopen askai cli (or the Ask AI window).", AMBER, False),
]

SETUP_FIXES = [
    ("bar", "WHEN SOMETHING LOOKS WRONG", AMBER),
    ("card", "askai install --retry", "A component failed or needs a new shell: fix the cause it names, then re-run. Finished components are skipped.", AMBER, False),
    ("card", "exit, then askai cli   (GUI: close and reopen the window)", "After askai update the open shell still runs the old version.", AMBER, False),
    ("card", "agent login  (in a terminal), then askai install --retry", "Cursor CLI not signed in: AskAI cannot check which models the account offers.", AMBER, False),
    ("card", "askai project sync", "Agent files or tiers look old in a project.", AMBER, False),
    ("card", "askai restore", "A settings file was changed wrongly: list backups and put one back.", AMBER, False),
]

WORK_LOOP = [
    ("bar", "THE WORKING LOOP", AMBER),
    ("step", "1", "askai next", "At most 3 things to do now and 2 for later.", False),
    ("step", "2", "askai go claude --tier build \"task\"", "Picks the model and effort once for the session. --tier lead for design, chore for cleanup. Codex, Cursor, agy work the same.", True),
    ("step", "3", "askai prompt \"rough ask\"", "Turns a rough request into goal, files, done-when and a tier before you start.", False),
    ("step", "4", "askai run -- <command>   |   askai errors", "Run a noisy command once, keep the log, read only the first errors.", False),
    ("step", "5", "askai break   |   askai handoff   |   askai resume", "Before a break write the handoff; after one, continue or start fresh.", False),
    ("label", "ARCHITECTURE DESIGN, ANALYSIS, SUPERVISION, REVIEW"),
    ("card", "Claude Opus 5.5 (claude-opus-5-5), Extra High effort", "Ask for it explicitly, over Claude only, for bigger work or before a submission. No tier ever picks it automatically.", AMBER, True),
]


def reference_notes(version):
    return [
        "askai savings reads Claude Code and Codex only. Cursor, Claude chat and ChatGPT show usage in their own settings.",
        "AskAI's own folder is ~/.askai on a fresh install (older installs keep ~/.claude/askai). askai models shows the tiers per tool.",
        f"Generated from lib/help.js (askai {version}). Regenerate: python scripts/build-cheatsheets.py",
    ]


# ---- layout --------------------------------------------------------------------------------------------------------

M = 34.0
GAP = 24.0
COLW = (W - 2 * M - GAP) / 2
HEADER_H = 100.0
FOOTER_H = 38.0
TOP = HEADER_H + 24.0
BOTTOM = H - FOOTER_H - 20.0


def build_item(item, k):
    """Return (height, prims-fn) for one item at scale k. prims-fn(x, y) -> list of primitives."""
    kind = item[0]
    if kind == "bar":
        size = 19 * k
        h = 38 * k

        def prims(x, y):
            return [("rect", x, y, COLW, h, item[2]), ("text", x + 14, y + h / 2 + size * 0.33, item[1], "sansb", size, WHITE)]
        return h, prims, True
    if kind == "label":
        size = 13.5 * k
        h = 30 * k

        def prims(x, y):
            return [("text", x + 4, y + h * 0.72, item[1], "sansb", size, AMBER)]
        return h, prims, True
    if kind == "card":
        _, usage, desc, accent, hot = item
        return card(usage, desc, accent, hot, k, badge=None)
    if kind == "step":
        _, num, usage, desc, hot = item
        return card(usage, desc, AMBER if hot else TEAL, hot, k, badge=num)
    if kind == "notes":
        lines = []
        size = 12.5 * k
        for n in item[1]:
            lines += wrap(n, "sans", size, COLW - 8)
        h = 30 * k + len(lines) * size * 1.35 + 6 * k

        def prims(x, y):
            out = [("text", x, y + 18 * k, "Reference notes", "sansb", 17 * k, NAVY)]
            yy = y + 30 * k + size
            for ln in lines:
                out.append(("text", x, yy, ln, "sans", size, FOOT))
                yy += size * 1.35
            return out
        return h, prims, False
    raise ValueError(kind)


def card(usage, desc, accent, hot, k, badge):
    ux = 14.0 + (34.0 if badge else 0.0)            # text inset inside the card
    usize, dsize = 15.0 * k, 15.5 * k
    ukey = "mono"
    ulines = wrap(usage, ukey, usize, COLW - ux - 12)
    dlines = wrap(desc, "sans", dsize, COLW - 14 - 12) if desc else []
    ulh, dlh = usize * 1.3, dsize * 1.32
    uh = len(ulines) * ulh + 14 * k
    dh = (len(dlines) * dlh + 14 * k) if dlines else 0
    h = uh + dh + 6 * k
    ubg, ucol = (CREAM, CMD_AMBER) if hot else (MINT, TEAL)

    def prims(x, y):
        out = [("rect", x, y, COLW, uh + dh, WHITE), ("rect", x + 4, y, COLW - 4, uh, ubg), ("rect", x, y, 4, uh + dh, accent)]
        if badge:
            r = 13 * k
            out += [("circle", x + 24, y + uh / 2, r, accent), ("text", x + 24 - text_w(badge, "sansb", 14 * k) / 2, y + uh / 2 + 5 * k, badge, "sansb", 14 * k, WHITE)]
        yy = y + 7 * k + usize
        for ln in ulines:
            out.append(("text", x + ux, yy, ln, ukey, usize, ucol))
            yy += ulh
        yy = y + uh + 7 * k + dsize
        for ln in dlines:
            out.append(("text", x + 14, yy, ln, "sans", dsize, DESC))
            yy += dlh
        return out
    return h, prims, False


def flow(items, k):
    """Flow items down two columns. Returns the primitives, or None if they do not fit at this scale."""
    col, y = 0, TOP
    i = 0
    prims_all = []
    built = [build_item(it, k) for it in items]
    section = None                                    # the category bar the flow is currently inside
    while i < len(built):
        h, fn, _keep = built[i]
        need = h
        j = i
        while built[j][2] and j + 1 < len(built):   # bars and labels travel with the item after them
            j += 1
            need += built[j][0]
            if not built[j][2]:
                break
        if y + need > BOTTOM:
            if col == 1:
                return None
            col, y = 1, TOP
            if items[i][0] not in ("bar", "label") and section is not None:
                # a category that runs over into the second column gets its title again
                bh, bfn, _ = build_item(("bar", section[1] + "  ·  continued", section[2]), k)
                prims_all += bfn(M + col * (COLW + GAP), y)
                y += bh
            if y + need > BOTTOM:
                return None
        if items[i][0] == "bar":
            section = items[i]
        x = M + col * (COLW + GAP)
        prims_all += fn(x, y)
        y += h
        i += 1
    return prims_all


def fit(items):
    best = None
    k = 1.3
    while k >= 0.55:
        got = flow(items, k)
        if got is not None:
            best = (k, got)
            break
        k -= 0.02
    if best is None:
        raise SystemExit("content does not fit on one A3 sheet")
    return best[1]


def chrome(title, footer, version):
    out = [("rect", 0, 0, W, H, PAPER), ("rect", 0, 0, W, HEADER_H, NAVY)]
    out += [("text", M, 52, title, "sansb", 40, WHITE), ("text", M, 82, LEGEND, "sans", 15, MUTED)]
    out += [("rect", 0, H - FOOTER_H, W, FOOTER_H, NAVY), ("text", M, H - 14, footer, "sans", 14, MUTED)]
    tag = f"askai {version}"
    out.append(("text", W - M - text_w(tag, "sans", 14), H - 14, tag, "sans", 14, MUTED))
    return out


def sheets(data):
    version = data["version"]
    setup = SETUP_SEQUENCE + category_items(data, "setup") + category_items(data, "health") + category_items(data, "system") + SETUP_FIXES
    work = WORK_LOOP + category_items(data, "work") + category_items(data, "project") + category_items(data, "cost") + category_items(data, "learn")
    work.append(("notes", reference_notes(version)))
    return [
        ("AskAI setup & health", "ASKAI  /  SETUP, HEALTH & ENTRY POINTS", version, setup, PNG_SETUP),
        ("AskAI while you work", "ASKAI  /  WHILE YOU WORK", version, work, PNG_WORK),
    ]


# ---- rendering -----------------------------------------------------------------------------------------------------

def render_png(prims, path):
    s = PNG_W / W
    img = Image.new("RGB", (PNG_W, int(round(H * s))), PAPER)
    d = ImageDraw.Draw(img)
    cache = {}
    for p in prims:
        if p[0] == "rect":
            _, x, y, w, h, c = p
            d.rectangle([x * s, y * s, (x + w) * s - 1, (y + h) * s - 1], fill=c)
        elif p[0] == "circle":
            _, cx, cy, r, c = p
            d.ellipse([(cx - r) * s, (cy - r) * s, (cx + r) * s, (cy + r) * s], fill=c)
        else:
            _, x, y, text, key, size, c = p
            f = cache.setdefault((key, size), ImageFont.truetype(FONTS[key], max(1, int(round(size * s)))))
            d.text((x * s, y * s), text, font=f, fill=c, anchor="ls")
    img.save(path, optimize=True)


def render_pdf(sheet_pages, path, version):
    """One A3 page per sheet: the sheet image, plus an invisible text layer so the PDF is searchable and commands copy as plain ASCII."""
    import pymupdf
    doc = pymupdf.open()
    s = PDF_W / W
    for png, prims in sheet_pages:
        page = doc.new_page(width=PDF_W, height=PDF_H)
        page.insert_image(pymupdf.Rect(0, 0, PDF_W, PDF_H), filename=str(png))
        for p in prims:
            if p[0] != "text":
                continue
            _, x, y, text, key, size, c = p
            safe = text.encode("latin-1", "replace").decode("latin-1").replace("?", "-") if any(ord(ch) > 255 for ch in text) else text
            page.insert_text((x * s, y * s), safe, fontname="cour" if key.startswith("mono") else "helv", fontsize=max(4.0, size * s), render_mode=3)
    doc.set_metadata({"title": f"AskAI command cheat sheets (askai {version})", "author": "AskAI", "subject": "setup and health; while you work"})
    doc.save(path, garbage=4, deflate=True)
    doc.close()


def main():
    data = load_help()
    pdf_pages = []
    for title, footer, version, items, png in sheets(data):
        prims = chrome(title, footer, version) + fit(items)
        render_png(prims, png)
        pdf_pages.append((png, prims))
        print(f"wrote {png.relative_to(ROOT)}")
    render_pdf(pdf_pages, PDF_OUT, data["version"])
    print(f"wrote {PDF_OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
