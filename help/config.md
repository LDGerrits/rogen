# Configs

A folder's config is `rogen.json` (or `rogen.jsonc`), parsed as JSONC. It is a Rojo project file plus Rogen's keys: `sourcePaths` (default `["src"]` when `routes` exist), `routes` and `syncPath`. Rojo's keys (`name`, `tree`, `servePort`, `servePlaceIds`, `emitLegacyScripts`, `globIgnorePaths`, `$schema` and the rest) pass through to the project file Rogen writes beside it, `default.project.json`. A key on neither list passes through with a warning, since Rojo will reject the written file by that name. A command given no folder reads the `rogen.json` here, or in the nearest folder above that has one.

- `tree` is the instance tree Rogen merges its generated nodes into, as in any Rojo project file. It holds what names can't express: the DataModel name, package mounts and `$properties`. The tree wins a clash. A `$path` into a source path is Rojo's: Rogen skips that folder, so mount vendored code there to sync it as it is. With `routes`, the tree's root must be a DataModel; without them any root is valid and the file is written as it is.
- Without `routes`, nothing is routed and no source path is scanned, and `sourcePaths` is an error. Rogen warns when `src` holds files the tree doesn't mount.
- Several `sourcePaths` merge into one tree, and the later one wins a clash. Paths are relative to the folder of `rogen.json`.
- `globIgnorePaths` lists globs, relative to the folder, that Rojo ignores and Rogen keeps out of routing, such as `**/*.spec.luau`. It never drops a mounted node: an ignored mount stays as an empty Folder.
- `syncPath` is the compiler's output (`out` for roblox-ts, `dist` for Darklua), where emitted `$path`s point.
- `syncRules` isn't supported yet and is an error. `extends`, `template`, `outFile` and `exclude` are errors that name what replaces them.

The project file carries `name` only when `rogen.json` sets one; Rojo names the project after its folder otherwise.

Ownership:

- `rogen build` overwrites `default.project.json`: put changes in `rogen.json`.
- The `syncPath` is compiler output: edit the sources in the source paths.
