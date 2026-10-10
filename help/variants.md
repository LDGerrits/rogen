# Variants

A variant swaps a file at build time. Declare every variant by name in `variants`: `"variants": ["mock", "debug"]`. A variant is off unless the active mode lists it or `--variant` turns it on. An undeclared dot part is just part of the name (`Save.spec.luau`), but one a single edit from a declared variant warns, in a name, a folder or a marker file (`Analytics.mok.luau`, `.mok/`, `.mok`). Variants are independent switches, not Roblox instance Tags. For one environment with exactly one value, like dev or prod, use modes (`rogen help modes`), which turn variants on.

- `Analytics.mock.luau` becomes `Analytics` while `mock` is on, replacing the plain file, and is left out while it is off. It combines with a route in either order (`Analytics.mock@server.luau`); Rojo's `.server` or `.client` stays last.
- A variant folder (`mock/`) or marker file (`.mock`) marks everything inside. `dev/Service.luau` beside `prod/Service.luau` lets the active variant pick which file becomes `Service`. With both off, `Service` is missing, and Rogen warns.
- `Analytics.mock/` carries the variant and keeps the name `Analytics`.
- Only a dot carries a variant: `HttpMock.luau` and `Http-mock.luau` are ordinary names, and `Analytics@mock.luau` warns.
- A variant has to land where the plain file beside it does: `Analytics.mock@server.luau` beside `Analytics.luau` is an error, since both would ship. Route and hoist them the same way.
- Where a file lands never depends on which variants are on, and a mistake in a name is reported even while its variant is off.
- Of the files at one name, the active one with the most variants wins, if it has every variant the others have: `mock/Service.dev.luau` replaces `mock/Service.luau`, which replaces `Service.luau`. Two that each lack one of the other's variants (`Service.mock.luau`, `Service.dev.luau`) are an error; two plain files are a warning. Nesting means "and": `mock/dev/` needs both on.
- A variant is on when the active mode lists it or `--variant` adds it, and off when `--no-variant` removes it, which applies last. `--variant dev` for a mode named `dev` is an error that suggests `--mode dev`.
- `--variant mock` and `--no-variant mock` last for one run and have no short flags. For a lasting choice, list the variant in a mode.
- `conflicts` lists groups of variants of which at most one may be on: `"conflicts": [["halloween", "christmas"]]`. Two on is an error, from a mode, `--variant` or both. `--variant christmas` never turns `halloween` off; use `--no-variant halloween --variant christmas`. A group names variants, never a mode.
- `variants` was a map of on and off in earlier betas; a map is a config error.
- `rogen list` shows every config's variants with their state.
