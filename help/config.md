# Configs

A config is `<name>.rogen.json`, parsed as JSONC. Its fields are `$schema`, `extends`, `rootDirs` (default `["src"]`), `routes`, `variants`, `modes`, `mode`, `exclude`, `template`, `syncDir` and `outFile` (default `<name>.project.json`). Unknown keys are errors. A command given no names reads every `*.rogen.json` here.

- `extends` merges `routes`, `variants` and `modes` key by key (a mode merges like the config itself), adds a child's `rootDirs` and `exclude` entries after its parent's (a repeated entry keeps its last position), and lets the child replace strings. `outFile` and `$schema` are never inherited. A child adds and never removes, so invert the chain to drop something. Write one by hand: `{ "extends": "./default.rogen.json" }`.
- Several `rootDirs` merge into one tree, and the later one wins a clash. `["src"]` applies only when no config in the chain sets `rootDirs`. A place is a config that extends `default` and adds its own directory: `"rootDirs": ["places/lobby"]`. Add one with `rogen init <name> --json`: it writes the place's config and the extra files Darklua or roblox-ts need, and lists the edits to make in its `nextSteps.setup`.
- `modes` names environments, exactly one active per build (`rogen help modes`). `mode` picks the one a config builds in; `--mode` overrides it.
- `exclude` lists globs, relative to the config, that are never built, such as `**/*.spec.luau`. A glob that matches a template `$path` drops that node too.
- `template` is a `.project.json` Rogen merges its tree into. It holds what names can't express: the DataModel name, package mounts and `$properties`. The template wins a clash. A template `$path` into a root dir is Rojo's: Rogen skips that folder, so mount vendored code there to sync it as it is.
- `syncDir` is the compiler's output (`out` for roblox-ts, `dist` for Darklua), where emitted `$path`s point.
- With Darklua in a Luau project, `default.rogen.json` is rooted at the source for luau-lsp and Darklua, and `sync.rogen.json` extends it with `"syncDir": "dist"` for `rojo serve`. `rogen build` builds both.

Ownership:

- `rogen build` overwrites the `*.project.json` each config writes: put changes in the config, or in the `template` it merges into.
- The `syncDir` is compiler output: edit the sources in the root directories.
