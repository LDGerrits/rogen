# Output

Diagnostics print as `file:line:col - severity: message`, on stderr. Errors stop every config in the run from being written. Warnings don't, and still name something to fix.

Exit codes: 0 done, warnings included; 1 the project has errors (an invalid config, build errors, a failed write, a cancelled init); 2 the command line is wrong (an unknown command, option or name, or a combination that isn't allowed). `--json` keeps the same codes.

Plain lines (in pipes, CI and under an agent) put results on stdout and warnings, errors and diagnostics on stderr. `--json` on `build`, `where`, `list` and `init` prints one JSON document on stdout, whatever the exit code, and nothing else. Read it instead of parsing text.

- `build --json`: `{ "configs": [{ "config", "file", "outFile", "outcome", "diagnostics" }] }`, where `outcome` is `wrote`, `unchanged` or `notWritten`. A config that doesn't load is an entry too, with `"outFile": null` and its errors in `diagnostics`; a config not written because others failed or didn't load has `blockedBy`, their names.
- `where --json`: `{ "locations": [...], "diagnostics": [...] }` (`diagnostics` holds the errors of a config that didn't load), one entry per config and path, with `config`, `source` and `status`; a placed file adds `instancePath`, `route`, `routeMatch` and `variants`. Each entry ends with `diagnostics`: what a build would raise about that path, narrowed to it.
- `list --json`: `{ "configs": [...] }`, one entry per config with `config`, `file`, `status` (`valid` or `broken`), `extends`, then the resolved values (`projectName` is the Rojo project's name) with every default and absolute path, and `diagnostics`.
- `init --json`: the `files` it wrote, the `directories` it created (root dirs that didn't exist), its notes, and its `nextSteps`.
- A command that fails before it has anything else to show prints `{ "diagnostics": [...] }` or `{ "error": "..." }`.

An entry that is a config has `config` (the name every command takes, `lobby` for `lobby.rogen.json`) and `file` (its absolute path); an entry that belongs to a config has `config`. Identity comes first and `diagnostics` last.

Each JSON diagnostic has `file`, `line` and `column` (when it has a position), `severity`, a stable `code` to match on, `message`, and a `url` to the code's docs. `rogen help <code>` prints the same section offline. A diagnostic whose fix is one rename has `fixes`: `[{ "rename": { "from", "to" } }]`, one for every name it covers. Rogen never applies them; after a rename, update the requires and imports that name the file. A warning about several files has `related`: `[{ "file", "message" }]`, one for every file, uncapped (the text stops at ten). A diagnostic is about a file when its `file` is that file or `related[].file` includes it.

`rogen where` is `build`'s dry run: it computes the same tree and writes nothing, so it shows where a file lands, and why a file is left out (pruned, replaced, excluded, displaced or mounted), before you build. It prints the warnings a build would raise about each path under its line, except the sync dir's.

`rogen build` is safe beside a running `rogen watch`: it writes only bytes that changed.
