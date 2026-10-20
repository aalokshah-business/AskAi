# Contributing to AskAI

Thank you for helping. AskAI's goal is to make AI coding subscriptions last longer without taking risks with your code or your billing, so every change follows four rules:

1. **Evidence first.** A tool is installed by default only when independent measurements support it; otherwise it is opt-in (`--flag` or the `max` profile) and its evidence is recorded in `lib/plugins.js` and the guide.
2. **Never overwrite what a person set.** Settings are added only when absent, every file is backed up before its first change, and `askai uninstall` removes only what AskAI added.
3. **No hidden token cost.** Nothing may inject text into every prompt; reminders go to the person (`systemMessage`), never to the model.
4. **Everything visible in the terminal.** Every command has `askai help`, every plugin has `askai plugins info`, every manual step appears in `askai todo`.

## How changes get in

Only the maintainer can push to this repository. To propose a change, fork it, make the change on a branch in your fork, and open a pull request; the tests run on Ubuntu, macOS and Windows, and the maintainer reviews it (`.github/CODEOWNERS`). Nothing reaches `main` without that review, and `main` cannot be force-pushed or deleted.

## Working on AskAI

```bash
git clone https://github.com/aalokshah-business/AskAi && cd AskAi
node --test test/*.test.js           # unit and CLI tests (Node 20+; no network, nothing outside temp folders)
bash scripts/preview-matrix.sh       # install previews for every OS and tool
node scripts/gen-docs.js             # regenerate docs/ARCHITECTURE.md from the code (CI fails when it is stale)
node askai.js install --dry-run      # try your change without touching your setup
```

On Windows, `scripts/windows-selftest.ps1` runs the PowerShell installer in a temporary folder. GitHub Actions runs all of this on Ubuntu, macOS and Windows for every push and pull request.

## Adding or changing a plugin

1. Add or update its entry in `lib/plugins.js`: what it is, the evidence (measured, claims only, none), and how it is installed.
2. If AskAI installs it, add a component (see `lib/agents.js` for MCP servers, CLIs and plugins) with `detect`, `install`, `update` and `uninstall`, and wire it into every tool it supports.
3. Add its usage guide in `lib/usage-guide.js`: terminal commands, in-agent commands, how to check it works, where to see its savings, how to switch it off.
4. Add any manual step to `lib/todo.js`, and tests in `test/`.

## Reporting a problem

Open an issue with the output of `askai version`, `askai infra` and the failing command (remove anything private first). For security problems see [SECURITY.md](SECURITY.md).
