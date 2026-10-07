# Output

Diagnostics print as `file:line:col - severity: message`, on stderr. Errors stop every config in the run from being written. Warnings don't, and still name something to fix.

Exit codes: 0 done, warnings included; 1 the project has errors (an invalid config, build errors, a failed write, a cancelled init); 2 the command line is wrong (an unknown command, option or name, or a combination that isn't allowed). `--json` keeps the same codes.

Plain lines (in pipes, CI and under an agent) put results on stdout and warnings, errors and diagnostics on stderr. `--json` on `build`, `where`, `list` and `init` prints one JSON document on stdout, whatever the exit code, and nothing else. Read it instead of parsing text.

- `build --json`: `{ "configs": [{ "config", "file", "outFile", "outcome", "diagnostics" }] }`, where `outcome` is `wrote`, `unchanged` or `notWritten`.
- `where --json`: `{ "locations": [...] }`, one entry per config and path, with `config`, `source` and `status`; a placed file adds `instancePath`, `route`, `routeMatch` and `variants`.
- `list --json`: `{ "configs": [...] }`, one entry per config with `config`, `file`, `status` (`valid` or `broken`), `extends`, then the resolved values (`projectName` is the Rojo project's name) with every default and absolute path, and `diagnostics`.
- `init --json`: the files it wrote, its notes, and its `nextSteps`.
- A command that fails before it has anything else to show prints `{ "diagnostics": [...] }` or `{ "error": "..." }`.

An entry that is a config has `config` (the name every command takes, `lobby` for `lobby.rogen.json`) and `file` (its absolute path); an entry that belongs to a config has `config`. Identity comes first and `diagnostics` last.

Each JSON diagnostic has `file`, `line` and `column` (when it has a position), `severity`, a stable `code` to match on, `message`, and a `url` to the code's docs. `rogen help <code>` prints the same section offline. A diagnostic whose fix is one rename has `fixes`: `[{ "rename": { "from", "to" } }]`, one for every name it covers. Rogen never applies them; after a rename, update the requires and imports that name the file.

`rogen where` is `build`'s dry run: it computes the same tree and writes nothing, so it shows where a file lands, and why a file is left out (pruned, replaced, excluded, displaced or mounted), before you build.

`rogen build` is safe beside a running `rogen watch`: it writes only bytes that changed.
