# Routing

Rogen reads the folder and file names under each config's `rootDirs` and writes the Rojo project file. Folders decide where code runs, so the disk path is not the instance path.

`routes` maps a route key to a target, `Service` or `Service/Folder/...`. Only declared keys route, and nothing is built in. `rogen list` prints each config's resolved routes, in order, as `key -> target`, and `routes: same as <config>` for one that repeats an earlier config's; it follows an `extends` chain.

Route with folders. Give each feature one folder per side, named after the config's route keys, and put every file inside one of them:

  src/Inventory/Server/InventoryService.luau   -> ServerScriptService/Inventory/InventoryService
  src/Inventory/Client/InventoryController.luau -> StarterPlayer/StarterPlayerScripts/Inventory/InventoryController
  src/Inventory/Shared/InventoryTypes.luau     -> ReplicatedStorage/Shared/Inventory/InventoryTypes

A key routes a file in four ways:

- Routing folder: `Server/` (the key's name) sends everything inside to the key's target and leaves no folder.
- Suffix: `Combat@server.luau` routes one file, and `@server` comes off the name. `Matchmaking@server/` routes a folder and keeps its name; a bare `@server/`, or one named by keys alone (`.mock@server/`), routes and leaves no folder. `@` never changes the script class, so `Combat@server.luau` is a ModuleScript in ServerScriptService.
- Marker file: an empty `@server` routes its directory and everything below, and the directory keeps its name. A dot-file like `.server` routes nothing and warns; only variant markers (`.mock`) take a dot.
- Rojo's `.server` and `.client` at the end of a script name set its class (Script, LocalScript), and also route when a key of that name is declared. No other key routes through a dot, and nothing but a script does: `Types.shared.luau` is named `Types.shared` and `Config.server.json` is `Config.server`, and both warn; write `Types@shared.luau` and `Config@server.json`.

`-`, `_`, `+` and a capital letter (`CombatServer`) don't route. Such a file falls to `*`, and `rogen where` says `route * (fallback)`.

Matching is exact except for the first letter: key `Server` matches `server/` and `Server/`. `SERVER/` doesn't, and `rogen build` warns. An `@` that nearly spells a route (`Save@sever.luau`) warns with the closest key; other `@` names, such as packages, stay silent.

The governing route is the first one found walking down from the root directory. Every route after it is ignored whole: a nested `Server/` folder is an ordinary folder that keeps its name. A nested `@key` naming another route is an error (`server/Util@client.luau`), and one restating the governing route is fine. So `Shared/Server/Datastore.luau` stays in ReplicatedStorage; never put server code under `Shared/`. Rogen warns when that ships server modules to clients (a `Shared/Server/@shared` marker says the folder is meant to), and when a Script or LocalScript lands where it never runs.

`*` is the fallback for files no route matched. Without it those files are left out, with a warning.

A file's instance path is its route's target, then its folders without the routing folder, then its name as Rojo reads it (`Save.server.luau` is `Save`). A name that starts with `^` (`^Animate.client.luau`, or a folder `^Hud/`) lands directly at the target instead, dropping every folder in between; quote it in a shell. `^init.luau` is an error: hoist the folder.

Requires and imports:

- `Shared/` code runs on both sides, so it can't require anything in `Server/`: the client can't see ServerScriptService.
- Luau: require by instance path (`ReplicatedStorage.Shared.Inventory.InventoryTypes`). `rogen where <file>` prints the exact expression under the file's line (`--json` has it in `require`), with names that aren't identifiers written as indexes; under the Starter containers, whose contents are cloned at runtime, and for scripts, it says why there is none, and it prints nothing for roblox-ts sources. String requires resolve against the instance tree, so `./` only reaches files routed into the same folder.
- roblox-ts: import by relative file path; `rbxtsc` resolves it through the project file, so run `rogen build` before compiling.
- Keep the import boundaries the repo states. A crossed boundary means the code is in the wrong place: move it, don't add an exception.

`rogen where <path>` prints where a file lands and why, before or after it exists. Given an instance as Studio prints it (`ServerScriptService.Inventory.Save:12`), it prints the file behind it.
