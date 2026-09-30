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

- Read the keys and their targets once from the config's `routes`, since a repo can rename or add them; `rogen build --show-config` resolves an `extends` chain.
- A file's instance path is its route's target, then its folders without the routing folder, then its name as Rojo reads it (`Save.server.luau` is `Save`).
- Inside a routing folder, a route key at the end of a name is ignored: `Shared/HttpClient.luau` stays `HttpClient`.
- `rogen where <path>` prints where a file lands and why, before or after it exists; `rogen where | grep <Instance>` finds the file behind an instance.

## After a batch of changes

- Run `rogen where` on the paths you added, moved or renamed, and check each lands where you meant. It also shows files left out without a warning: pruned by a dormant tag, or replaced by another file.
- Then run `rogen build --all` once and fix every warning that names your files.
- Leave `rogen watch` and `rojo serve` to the user: they never exit, and `rogen build` is safe beside them.

## Requires and imports

- `Shared/` code runs on both sides, so it can't require anything in `Server/`: the client can't see `ServerScriptService`.
- Luau: require by instance path (`ReplicatedStorage.Shared.Inventory.InventoryTypes`); string requires resolve against the instance tree, so `./` only reaches files routed into the same folder.
- roblox-ts: import by relative file path; `rbxtsc` resolves it through the project file, so run `rogen build` before compiling.

## Ownership

- `rogen build` overwrites the `*.project.json` each config writes: put changes in the config, or in the `template` it merges into.
- The `syncDir` (`out`, `dist`) is compiler output: edit the sources in the root directories.

For tags and variants (`Foo.mock.luau`), marker files, suffixes, `.meta.json`, extra configs and CLI flags, read [REFERENCE.md](REFERENCE.md).
