# Rogen reference

Rogen 2. The full docs are at https://rogen-playfully.vercel.app/docs/v2.

## Routing

`routes` maps a route key to a target, `Service` or `Service/Folder/…`. Only declared keys route, and nothing is built in. Besides a routing folder, a key matches in two ways, which some repos use for a whole feature:

- **Marker file**: an empty `.server` routes its directory and everything below, and that directory keeps its name.
- **Suffix**: `Combat-server`, `Combat.server`, `Combat_server`, `Combat@server` or `CombatServer` routes one file, and the suffix is stripped from the name. Outside a routing folder this fires by accident: `Net/HttpClient.luau` becomes the client module `Http`, and `rogen build` warns. A separator (`Http-client.luau`) routes on purpose without a warning; the warning suggests a dot, or a dash where Rojo reads the suffix itself (`.server`, `.client`, `.plugin`).

Matching is exact except for the first letter: key `Server` matches `server/` and `Server/`. `SERVER/` doesn't, and `rogen build` warns about it.

The **governing route** is the first one found walking down from the root directory; routes nested inside it are ignored.

`*` is the fallback for files no route matched. Without it those files are left out, with a warning.

Rojo also reads `.server` and `.client` at the end of a script name as its class (`Script`, `LocalScript`). To route a ModuleScript by suffix, use another separator: `Combat-server.luau`.

## Tags

A tag marks a variant. Declare every tag in `tags` with whether it is on: `"tags": { "mock": false }`. An undeclared suffix is just part of the name.

- `Analytics.mock.luau` becomes `Analytics` while `mock` is on, replacing the untagged file, and is left out while it is off.
- A tag folder (`mock/`) or marker file (`.mock`) tags everything inside. `dev/Service.luau` beside `prod/Service.luau` lets the active tag pick which file becomes `Service`.
- A capital suffix (`HttpMock`) matches a tag too: it is pruned, without a warning, while the tag is off. Check `rogen where` before naming a file after a word that is also a tag.
- Two files with active tags at one name are an error; two untagged files at one name are a warning.
- `-t mock` turns a tag on and `-T mock` turns it off, for one build. For a lasting variant, write a config that extends and flips it.

## Configs

A config is `<name>.rogen.json`, parsed as JSONC. Its fields are `$schema`, `extends`, `rootDirs` (default `["src"]`), `routes`, `tags`, `exclude`, `template`, `syncDir` and `outFile` (default `<name>.project.json`). Unknown keys are errors.

- `extends` merges `routes` and `tags` key by key, and the child replaces lists and strings. `outFile` and `$schema` are never inherited. A child can't remove anything, so invert the chain instead.
- Several `rootDirs` merge into one tree, and the later one wins a clash. A place is a config that extends `default` and adds its own directory: `"rootDirs": ["src", "places/lobby"]`.
- `exclude` lists globs that are never built, such as `**/*.spec.luau`.
- `template` is a `.project.json` Rogen merges its tree into. It holds what names can't express: the DataModel name, package mounts and `$properties`. The template wins a clash.
- `syncDir` is the compiler's output (`out` for roblox-ts, `dist` for Darklua), where emitted `$path`s point.
- With Darklua in a Luau project, `source.rogen.json` has paths into `src` for Darklua's sourcemap, and `default.rogen.json` extends it with `"syncDir": "dist"` for `rojo serve`. Build both.

## Layout

- A `(Name)/` folder groups files on disk and is left out of the tree. `(Server)/` is still a routing folder.
- A directory with an `init` or `index` script is one instance, and Rogen doesn't route its contents.
- A file's `.meta.json` is named after the name Rojo gives it: `Save.server.luau` takes `Save.meta.json`.
- A feature folder's `init.meta.json` (`{ "className": "Actor" }`) applies to every node the folder becomes. In a routing, tag or invisible folder it applies to nothing, and Rogen warns.

## CLI

- `rogen build [name…]` builds `<name>.rogen.json`, or `default` when bare, and `--all` builds every config here. `-c <path>` builds a config the name rule can't reach. `rogen lobby` is an error.
- `rogen where [path…]` prints where each file lands and why, writes nothing, and places a path that doesn't exist yet as if it did. A directory stands for the files in it, and no path maps the whole tree. `-t`, `-T`, `-c` and `--all` pick tags and configs.
- `rogen list [name…] --json` prints each config resolved, with every default and absolute path. `--json` also works on `where` and `build`: one JSON document on stdout, whatever the exit code, with each diagnostic's stable `code`. Read it instead of parsing text.
- `-o`, `-s` and `--template` override `outFile`, `syncDir` and `template` for one build.
- Diagnostics print as `file:line:col - severity: message`. Errors exit 1; warnings exit 0 and still name something to fix.
- `rogen init [name]` writes a starting config. Without a terminal, or with `--no-input`, it takes every default without asking. Pass `--no-input` when your shell is a pseudo-terminal.
