# Projects and terminal selection

AskAI installs tool integrations once per user. `askai init` creates each repository's `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `docs/ai/` knowledge pack, agent files and `.ai-work/` session state. It also records a short name and canonical path in `~/.askai/projects.json`. The registry stores paths only; it contains no credentials or project contents. Use `ASKAI_HOME` to relocate the registry for tests or a managed setup.

## Register two projects

```powershell
askai init --name app-a --path 'C:\code\AppA' --yes
askai init --name app-b --path 'C:\code\AppB' --yes
askai projects
askai infra --project app-a
askai todo -p app-b
askai check --project app-a
```

`askai install --project 'C:\code\AppA'` also initializes and registers that project. Existing repositories that were initialized before the registry was introduced still work from their own directory. Run `askai init <folder> --yes --name NAME` once to register them; existing content is preserved. A duplicate name or a second name for the same folder is rejected.

Init analyzes each folder's README, manifest, entry point and source layout to fill project map purposes, data flow, features and documented constraints. It does not run a model or web search. `askai init --project NAME --refresh --yes` refreshes unedited generated docs after the repository changes; user-edited docs stay intact. Check `askai infra --project NAME` for coverage and `askai todo --project NAME` for facts still needing review. The current work order and architectural decisions require the project owner's input.

## Select once in a terminal

The AskAI-only terminal keeps selection in its process:

```text
askai cli
askai> set project app-a
askai> infra
askai> todo
askai> set project app-b
askai> check
askai> set project --clear
```

For an ordinary PowerShell terminal, enable the shell function for this session:

```powershell
Invoke-Expression (& askai shell init powershell)
askai set project app-a
askai infra
```

For Bash or Zsh, run `eval "$(askai shell init bash)"` or `eval "$(askai shell init zsh)"`. The function sets `ASKAI_PROJECT` in that terminal only. A plain child process cannot change its parent shell's environment, so `askai set project` without this function or `askai cli` does not persist selection after the process exits. Separate terminals can select separate projects. To install the function for future terminals, use `install.ps1 -ShellIntegration` on Windows or `bash install.sh --shell-integration` on macOS, Linux or WSL. These options make a managed, reversible shell-profile edit. A full `askai uninstall` removes that edit; it leaves the project registry and project files intact.

Selection order: an explicit `--project NAME` or `-p NAME` (or a positional folder), `ASKAI_PROJECT`, a registered project containing the current directory, an initialized ancestor, then an optional default. When none matches, older commands retain their current-directory behavior; `check` still runs machine checks. `askai set default NAME` sets a fallback across terminals; `askai set default --clear` removes it. An invalid active name or missing registered path produces an error instead of silently selecting another project.

## Manage a registration

```text
askai project show
askai project rename OLD NEW
askai project path NAME NEW_PATH
askai project remove NAME
askai project switch NAME
```

`project remove NAME` unregisters only the name. It never deletes project files. The older `askai project [dir] --print|--remove` still manages repository-local Cursor rules. `askai projects --json` shows missing paths, which can be repaired with `askai project path` after moving a folder or restoring the registry on a new laptop. On another operating system, register each restored folder with `askai init --name NAME --path NEW_PATH --yes`; do not assume old absolute paths are valid.

Run `npm run test:commands`, `npm test` and `askai docs check` from the source checkout after changing project behavior. The command suite uses temporary project folders; it does not configure real repositories or start AI agents.
