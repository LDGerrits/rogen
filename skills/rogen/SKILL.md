---
name: rogen
description: Rogen places Roblox code by folder and file name, and writes the Rojo project file from them. Use when a *.rogen.json is present and you add, move or rename source files, write a require or import, or edit a *.rogen.json.
---

# Rogen

Rogen reads the folder and file names under each config's `rootDirs` and writes the Rojo project file. Folders decide where code runs, so the disk path is not the instance path.

## Placing files

Route with folders. Give each feature one folder per side, named after the config's route keys, and put every file inside one of them:

```
src/Inventory/Server/InventoryService.luau  ->  ServerScriptService/Inventory/InventoryService
src/Inventory/Client/InventoryController.luau  ->  StarterPlayer/StarterPlayerScripts/Inventory/InventoryController
src/Inventory/Shared/InventoryTypes.luau  ->  ReplicatedStorage/Shared/Inventory/InventoryTypes
```

- Read the keys and their targets once from the config's `routes`, since a repo can rename or add them; `rogen list --json` resolves an `extends` chain.
- A file's instance path is its route's target, then its folders without the routing folder, then its name as Rojo reads it (`Save.server.luau` is `Save`).
- Only the outermost route acts. Inside a routing folder, another route is ignored whole: `Shared/Server/Datastore.luau` stays in `ReplicatedStorage`, so never put server code under `Shared/`.
- To route one file without a folder, write `@key` before the extension (`InventoryService@server.luau`). It never changes the script class. Only `.server` and `.client` route through a dot.
- `rogen where <path>` prints where a file lands and why, before or after it exists. Given an instance as Studio prints it (`rogen where ServerScriptService.Inventory.Save:12`), it prints the file behind it.

## After a batch of changes

- Run `rogen where` on the paths you added, moved or renamed, and check each lands where you meant. It also shows files left out without a warning: pruned by a dormant variant, replaced by another file, excluded by a glob, or displaced by a template node.
- Then run `rogen build --all` once and fix every warning that names your files.
- Leave `rogen watch` and `rojo serve` to the user: they never exit, and `rogen build` is safe beside them.

## Requires and imports

- `Shared/` code runs on both sides, so it can't require anything in `Server/`: the client can't see `ServerScriptService`.
- Luau: require by instance path (`ReplicatedStorage.Shared.Inventory.InventoryTypes`); string requires resolve against the instance tree, so `./` only reaches files routed into the same folder.
- roblox-ts: import by relative file path; `rbxtsc` resolves it through the project file, so run `rogen build` before compiling.
- Keep the import boundaries the repo states, in `AGENTS.md` or its lint config. A crossed boundary means the code is in the wrong place: move it, don't add an exception.

## Ownership

- `rogen build` overwrites the `*.project.json` each config writes: put changes in the config, or in the `template` it merges into.
- The `syncDir` (`out`, `dist`) is compiler output: edit the sources in the root directories.
- Add a place with `rogen init <name> --json` rather than by hand: it writes the place's config and the extra files Darklua or roblox-ts need for it. Make every edit in its `nextSteps.setup`, such as roblox-ts's `include`.

For variants (`Foo.mock.luau`), marker files, suffixes, `.meta.json`, extra configs and CLI flags, read [REFERENCE.md](REFERENCE.md).
