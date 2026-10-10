# Modes

A mode is a named environment, such as `dev` or `prod`, and exactly one is active per build. Declare them in `modes` and pick one with `mode`: `"modes": { "dev": { "variants": ["mock"] }, "prod": { "exclude": ["**/*.spec.luau", "DevPackages"] } }, "mode": "dev"`. A mode body holds only `variants` (the variants it turns on) and `exclude`; `rootDirs`, `routes`, `template`, `syncDir` and `outFile` are the config's, and every mode shares them. A mode changes which files are in the tree, never where they go or what is written.

- The active mode is `--mode <name>`, else the config's `mode` field, which is required when `modes` is declared. A config without `modes` builds as before, with every variant off unless `--variant` turns it on.
- `--mode` is strict: it applies to every selected config that declares modes, and a config that lacks the named mode is an error, so a release never quietly builds one place in dev. Configs without modes ignore it. `rogen build --mode prod` builds every config in prod; a bare `rogen watch` uses the config's own mode.
- A mode name marks files like a variant does: `Service.prod.luau`, a `prod/` folder, a `.prod` marker file. The active mode's files replace the plain file, its suffix is stripped, and every other mode's files are pruned. Route keys, variants and modes share one namespace, so a name can't be two of them.
- `variants` in a mode must name variants the config declares, and not two of one `conflicts` group. A variant is on when the mode lists it or `--variant` adds it, and off when `--no-variant` removes it.
- A mode's `exclude` adds to the config's, and `exclude` at either level drops template nodes whose `$path` it matches, so a mounted `DevPackages` stays out of prod. Test files belong in `exclude`: an active suffix is stripped, so `Button.spec.luau` would become `Button`.
- `extends` merges `modes` by name, and a mode body's lists add to the parent's: a place's `prod` adds globs to the shared one.
- Every build also checks the other modes, each with the variants it lists, since Rogen reads names only: `mode.missingInstance` and `mode.clash` warn what a build there would lose or refuse.
- To keep both outputs, give a second config `"extends": "./default.rogen.json", "mode": "prod"`.
- `rogen list` shows `mode: dev` and `modes: dev, prod`; `rogen where --mode prod` says `pruned · mode is dev, not prod`; `--json` adds `mode` to `list`, `where` and `build`.
