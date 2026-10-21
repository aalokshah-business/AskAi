---
description: Use the connected token tools for this chat, and finish the one-time setup they still need.
disable-model-invocation: true
---

This command is the one-time plugin setup, including the graph build when this repo has none.

Run `askai plugins ready --json`. If the user named a project or folder, add `--path`.

These tools do not read a prompt by themselves. Serena, Context7, Headroom, and Context Mode start with the app and wait. Call one later in this chat only when its `when` line matches the task. Do not call them now just to prove they work. Leave Headroom's proxy off.

Do the `actions` in order. They belong to this command:
- `run` is `/graphify .`: run that once in the project folder. It reads the repository and spends tokens once. Skip it only if the user said not to build the graph.
- any other `run`: run that command in the terminal. Do not add flags.

Then tell the user, in a few lines, which tools are connected, which you will call when the task matches, and which action you ran.
