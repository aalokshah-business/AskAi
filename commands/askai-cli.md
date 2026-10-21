---
description: Set up a project's AskAI knowledge pack with AI review, then open its AskAI terminal.
disable-model-invocation: true
---

Run `askai cli --prepare --json`. If the user named a project or folder, add `--project` or `--path`. If they described the project, including by dictation, add `--about "their words"`. Add `--refresh` when they asked to set up again, and `--offline` only when they asked or the network is unavailable.

Prepare finds the project itself: the named path, otherwise the repository or manifest folder of this chat, otherwise the only registered project. If the JSON has `need` `project`, ask that one `question` and run prepare again with the answer as `--path` or `--project`. If `need` is `about`, ask that question, show `default`, and run prepare again with `--about`. Accept a dictated answer. AskAI cannot open a microphone. If they accept the default, pass that text as `--about`. Do not continue while prepare exits 2. Never initialize an unrelated folder.

If `action` is `launch`, the pack is current. Open the terminal.

If `action` is `review`, prepare already ran `askai init --path <project-folder> --yes` when the pack was missing or source had changed (scan, official docs, project files). Then:
1. Read `docs/ai/SOURCE_INDEX.md` and the other paths in `read`. Check static conclusions against code. Research the detected stack in official docs when web tools exist. Do not send private source to web services.
2. Fill evidence-backed gaps in `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorignore`, `docs/ai/PROJECT_MAP.md`, `ARCHITECTURE.md`, `FEATURES.md`, `MODELS.md`, and the generated agent files and skills. Keep always-loaded instructions short. Preserve user edits. Put the current goal in `WORK_ORDER.md` only if this chat established it. Write `HANDOFF.md` only from actual session progress. Do not invent decisions, security invariants, or feature completion.
3. Ask one bundled question only for `questions` that code and this chat still cannot answer. Run `askai infra --project <name>` and `askai todo --project <name>`. Record `askai review done --project <name>` only after the review. Report remaining evidence gaps.

Then run `askai cli --launch`. Tell the user which project was selected. AI review uses model tokens when first needed or after source changes. Commands in the terminal use none unless they launch an AI agent.
