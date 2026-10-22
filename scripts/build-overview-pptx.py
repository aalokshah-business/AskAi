"""Build docs/AskAI-overview.pptx. Requires python-pptx."""
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

OUT = Path(__file__).resolve().parents[1] / "docs" / "AskAI-overview.pptx"
NAVY = RGBColor(0x14, 0x32, 0x4F)
INK = RGBColor(0x1C, 0x28, 0x33)
MUTED = RGBColor(0x5D, 0x6D, 0x7E)
TEAL = RGBColor(0x1A, 0x7A, 0x72)
PAPER = RGBColor(0xF4, 0xF7, 0xFB)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

SLIDES = [
    {
        "kicker": "AskAI",
        "title": "Make an AI coding subscription last longer",
        "lead": "One setup for Claude Code, Cursor, Codex, and Antigravity. It wires tools you already use. It does not sit between you and the model.",
    },
    {
        "kicker": "The cost",
        "title": "Three things decide how fast usage runs out",
        "bullets": [
            ("The chat is re-sent every turn", "Long sessions are the expensive ones. A week that hit a plan limit spent most of it on calls over 150K tokens of context."),
            ("The model is the biggest lever", "Across measured comparisons, a smaller model was the repeated large saving. Claude Code otherwise tends toward the most expensive model."),
            ("Reads, extra agents, and idle work", "File reads dominate tool use. Each extra agent starts with its own context. Loops and check-ins spend while you are away."),
        ],
    },
    {
        "kicker": "What it supports",
        "title": "Four hosts, one project pack",
        "bullets": [
            ("Hosts", "Claude Code, Cursor, OpenAI Codex, and Google Antigravity. Windows, macOS, Linux, and WSL."),
            ("A project pack", "A short map of the repo: what it is, where code lives, how to build and test. The agent reads that instead of rediscovering the tree."),
            ("Two chat commands", "/askai-cli reviews the pack and opens the AskAI terminal. /askai-plugins finishes one-time plugin setup. Terminal commands do not spend model tokens."),
        ],
    },
    {
        "kicker": "Default install",
        "title": "The coding profile is what you get if you do not choose",
        "bullets": [
            ("Rules that stay short", "Token rules, a terse reply style, and lean settings: fewer idle drains and capped output. Loaded for the kind of file you are in."),
            ("Claude Code defaults", "Sonnet 5.5 at high effort for the main session. Haiku for subagents. A model you already chose is left as you set it."),
            ("Navigation and a spend report", "Serena, so the agent can jump to a symbol instead of reading whole files. ccusage, so you can see what Claude Code spent."),
            ("Reminders, not a proxy", "A status line and a couple of in-session reminders. No router, no proxy, and no change to how you are billed."),
        ],
    },
    {
        "kicker": "Each repository",
        "title": "The pack is how the next session starts smaller",
        "bullets": [
            ("Instruction files", "AGENTS.md, CLAUDE.md, and GEMINI.md. Short notes the host already loads. Edits under the managed block are kept."),
            ("docs/ai", "Project map, architecture, features, and a source index. The agent searches the index instead of opening the whole tree."),
            ("What stays out", ".cursorignore leaves dependencies, build output, and secrets out of context."),
            ("A handoff", "After a break, the next chat starts from the files named in the handoff, not from the old transcript."),
        ],
    },
    {
        "kicker": "Not in the default",
        "title": "The max profile is a choice, not the starting point",
        "bullets": [
            ("Added only when you ask", "Context7, Graphify, Headroom, Repomix, RTK, Context Mode, document conversion, and ripgrep, jq, and gh where they are missing."),
            ("Why they are not default", "Independent measurements found RTK, Context Mode, and Headroom can cost more, not less. The default installs the pieces that measured a saving."),
            ("Graphify", "The program can be installed with max. Building the graph is a separate step, /askai-plugins, and it spends tokens once."),
            ("Claude LSP", "Official code-intelligence plugins are for Claude Code. A Cursor-only install does not add them."),
        ],
    },
    {
        "kicker": "How the goal is met",
        "title": "Set up once, then measure",
        "bullets": [
            ("Shorter context", "The pack and the handoff replace a long chat. Clear between tasks. Compact stays a tip, not an automatic cut."),
            ("Less wasted reading", "Search, then read a range. Serena for symbols. Ignore rules for trees that are not the product."),
            ("Fewer idle spends", "Lean settings in every profile. askai break lists work that is still running."),
            ("A number you can check", "askai usage and askai setup. A plugin’s own “tokens saved” counter is not the bill."),
        ],
    },
    {
        "kicker": "Start",
        "title": "Preview, install, open the project",
        "bullets": [
            ("Need", "Node.js 18 or newer, and Git. Sign in to the host you use. An API key overrides a subscription, so remove it unless you mean to pay per token."),
            ("Default command", "The installer dry-run lists every change. The install uses the coding profile unless you pass --profile max."),
            ("Then", "Restart the host. Open the project folder itself. Type / and choose askai-cli. Type / and choose askai-plugins once."),
            ("Where", "github.com/aalokshah-business/AskAi — docs/INSTALL.md and docs/ASKAI_GUIDE.md"),
        ],
    },
]


def set_run(paragraph, text, size, color, bold=False):
    paragraph.clear()
    run = paragraph.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = "Calibri"
    paragraph.alignment = PP_ALIGN.LEFT


def add_text(slide, text, x, y, w, h, size, color, bold=False):
    box = slide.shapes.add_textbox(x, y, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = None
    set_run(tf.paragraphs[0], text, size, color, bold)
    return box


def add_rect(slide, x, y, w, h, color):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.fill.background()
    # Drop the default shadow some hosts add.
    sp_pr = shape.fill._xPr.getparent()
    effect = sp_pr.find(qn("a:effectLst"))
    if effect is not None:
        sp_pr.remove(effect)
    return shape


def build():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    prs.core_properties.title = "AskAI overview"
    prs.core_properties.subject = "How AskAI helps, what it supports, and what a default install includes"
    blank = prs.slide_layouts[6]
    total = len(SLIDES)
    for i, slide in enumerate(SLIDES):
        s = prs.slides.add_slide(blank)
        add_rect(s, 0, 0, prs.slide_width, prs.slide_height, WHITE)
        add_rect(s, 0, 0, Inches(0.12), prs.slide_height, TEAL)
        add_text(s, slide["kicker"].upper(), Inches(0.48), Inches(0.28), Inches(10), Inches(0.32), 13, TEAL, True)
        add_text(s, slide["title"], Inches(0.48), Inches(0.58), Inches(12.2), Inches(0.9), 30, NAVY, True)
        if "lead" in slide:
            add_text(s, slide["lead"], Inches(0.48), Inches(2.1), Inches(11.8), Inches(2.2), 22, INK)
            add_text(s, "Shareable overview. Defaults match the coding profile in the product.", Inches(0.48), Inches(6.7), Inches(10), Inches(0.35), 13, MUTED)
        else:
            for n, (head, body) in enumerate(slide["bullets"]):
                y = Inches(1.7) + n * Inches(1.28)
                add_rect(s, Inches(0.48), y, Inches(12.3), Inches(1.16), PAPER)
                add_rect(s, Inches(0.48), y, Inches(0.08), Inches(1.16), TEAL)
                add_text(s, head, Inches(0.74), y + Inches(0.1), Inches(11.8), Inches(0.36), 16, NAVY, True)
                add_text(s, body, Inches(0.74), y + Inches(0.46), Inches(11.8), Inches(0.62), 14, INK)
        add_text(s, f"{i + 1}  /  {total}", Inches(11.6), Inches(7.05), Inches(1.3), Inches(0.3), 12, MUTED)
    prs.save(OUT)
    print(OUT)


if __name__ == "__main__":
    build()
