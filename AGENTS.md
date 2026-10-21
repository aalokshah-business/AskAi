# AskAI development

- Reuse the existing CLI, component, project and documentation modules. Add a new directory only when the current layout cannot hold the feature.
- For every command or configuration change, update its help entry, relevant installer behavior, tests, README or install guide, generated architecture reference and changelog. Run `askai docs check` or `node scripts/gen-docs.js --check` before finishing.
- Keep setup repeatable and idempotent. Preserve user files and settings; never place credentials in project registries, backups, logs or test fixtures.
- Project-aware commands must resolve through `lib/project-registry.js`. Keep global tool configuration separate from project files and `.ai-work` session state.
- Add a regression test for a setup failure once diagnosed. Test new-laptop and uninstall behavior when a change affects either one.
