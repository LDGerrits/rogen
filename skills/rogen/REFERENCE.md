# Rogen reference

Rogen 2. The full docs are at https://rogen-playfully.vercel.app/docs/v2.

## Routing

`routes` maps a route key to a target, `Service` or `Service/Folder/…`. Only declared keys route, and nothing is built in. Besides a routing folder, a key matches in two ways, which some repos use for a whole feature:

- **Marker file**: an empty `.server` routes its directory and everything below, and that directory keeps its name.
- **Suffix**: `Combat@server.luau` routes one file, and `@server` is stripped from the name. A folder written `Matchmaking@server/` routes and keeps its name, and a bare `@server/` routes and leaves no folder. `@` never changes the script class, so `Combat@server.luau` is a ModuleScript in `ServerScriptService`.
- Rojo's own `.server` and `.client` at the end of a script name set its class (`Script`, `LocalScript`), and also route when a key of that name is declared. No other key routes through a dot: `Types.shared.luau` is named `Types.shared`; write `Types@shared.luau`.
- `-`, `_`, `+` and a capital letter (`CombatServer`) don't route. Such a file falls to `*`, and `rogen where` says `route * (fallback)`.

Matching is exact except for the first letter: key `Server` matches `server/` and `Server/`. `SERVER/` doesn't, and `rogen build` warns about it. An `@` followed by a near miss of a route (`Save@sever.luau`) warns once, naming the route; other `@` names, such as packages, stay silent.

The **governing route** is the first one found walking down from the root directory; every route after it is ignored whole, so a nested `Server/` folder is an ordinary folder that keeps its name and a nested suffix stays in the name. Rogen warns when that ships a server route's modules to clients (`Shared/Server/Datastore.luau`), and when a Script or LocalScript lands where it never runs.

`*` is the fallback for files no route matched. Without it those files are left out, with a warning.

## Variants

A variant swaps a file at build time. Declare every variant in `variants` with whether it is on: `"variants": { "mock": false }`. An undeclared dot part is just part of the name (`Save.spec.luau`), but one a single edit from a declared variant (`Analytics.mok.luau`) warns. Variants are not Roblox instance Tags.

- `Analytics.mock.luau` becomes `Analytics` while `mock` is on, replacing the plain file, and is left out while it is off. It combines with a route in either order (`Analytics.mock@server.luau`); Rojo's `.server` or `.client` stays last.
- A variant folder (`mock/`) or marker file (`.mock`) marks everything inside. `dev/Service.luau` beside `prod/Service.luau` lets the active variant pick which file becomes `Service`.
- Only a dot carries a variant: `HttpMock.luau` and `Http-mock.luau` are ordinary names.
- Two files with active variants at one name are an error; two plain files at one name are a warning.
- `--variant mock` turns a variant on and `--no-variant mock` turns it off, for one build. They have no short flags. For a lasting choice, write a config that extends and flips it.

## Configs

A config is `<name>.rogen.json`, parsed as JSONC. Its fields are `$schema`, `extends`, `rootDirs` (default `["src"]`), `routes`, `variants`, `exclude`, `template`, `syncDir` and `outFile` (default `<name>.project.json`). Unknown keys are errors.

- `extends` merges `routes` and `variants` key by key, and the child replaces lists and strings. `outFile` and `$schema` are never inherited. A child can't remove anything, so invert the chain instead.
- Several `rootDirs` merge into one tree, and the later one wins a clash. A place is a config that extends `default` and adds its own directory: `"rootDirs": ["src", "places/lobby"]`. Add one with `rogen init <name> --json`.
- `exclude` lists globs that are never built, such as `**/*.spec.luau`.
- `template` is a `.project.json` Rogen merges its tree into. It holds what names can't express: the DataModel name, package mounts and `$properties`. The template wins a clash. A template `$path` into a root dir is Rojo's: Rogen skips that folder, so mount vendored code there to sync it as it is.
- `syncDir` is the compiler's output (`out` for roblox-ts, `dist` for Darklua), where emitted `$path`s point.
- With Darklua in a Luau project, `source.rogen.json` has paths into `src` for Darklua's sourcemap, and `default.rogen.json` extends it with `"syncDir": "dist"` for `rojo serve`. Build both.

## Layout

- A `(Name)/` folder groups files on disk and is left out of the tree. `(Server)/` is still a routing folder.
- A directory with an `init` or `index` script is one instance, and Rogen doesn't route its contents.
- A file's `.meta.json` is named after the name Rojo gives it: `Save.server.luau` takes `Save.meta.json`.
- A feature folder's `init.meta.json` (`{ "className": "Actor" }`) applies to every node the folder becomes. In a routing folder that governs, a variant folder or an invisible folder it applies to nothing, and Rogen warns. A `Name@key` folder and a routing folder an outer route outranks are ordinary folders.

## CLI

- `rogen build [config…]` builds every config here, or the named ones: `lobby` is `lobby.rogen.json`, and anything with a `/` or ending in `.json` is a path. `rogen lobby` is an error; a bare `rogen` prints usage.
- `rogen where [path…]` prints where each file lands and why, writes nothing, and places a path that doesn't exist yet as if it did. A directory stands for the files in it, and no path lists every file. An instance as Studio prints it (`ServerScriptService.Inventory.Save:12`) gives the files behind it, or says no file places it. It reads every config here; `--variant` and `--no-variant` pick variants.
- `rogen list [config…] --json` prints each config resolved, with every default and absolute path. `--json` also works on `where`, `build` and `init`: one JSON document on stdout, whatever the exit code, with each diagnostic's stable `code`. Read it instead of parsing text. Each JSON diagnostic has a `url` explaining it. A diagnostic's `fixes` are renames you can apply; after one, update the requires and imports that name the file.
- `-o` overrides `outFile` for one build of one config.
- Diagnostics print as `file:line:col - severity: message`. Exit 0 means done, warnings included, and they still name something to fix; 1 means the project has errors; 2 means the command line is wrong. `rogen help <command>` lists a command's flags with examples.
- `rogen init [name]` writes a starting config. With `-y`, without a terminal, or when it detects an agent or CI, it takes every default without asking: beside an existing `default.rogen.json`, `rogen init <name>` adds the place `<name>` with its code in `places/<name>`. Write a config that extends default yourself: `{ "extends": "./default.rogen.json" }`. With `--json` it never asks, and prints the files it wrote and its next steps.
