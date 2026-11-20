# Routing

Rogen reads the folder and file names under each config's `sourcePaths` and writes the Rojo project file. Folders decide where code runs, so the disk path is not the instance path.

`routes` maps a route key to a target, `Service` or `Service/Folder/...`. Only declared keys route, and nothing is built in.

Route with folders. Give each feature one folder per side, named after the config's route keys, and put every file inside one of them:

  src/Inventory/Server/InventoryService.luau   -> ServerScriptService/Inventory/InventoryService
  src/Inventory/Client/InventoryController.luau -> StarterPlayer/StarterPlayerScripts/Inventory/InventoryController
  src/Inventory/Shared/InventoryTypes.luau     -> ReplicatedStorage/Shared/Inventory/InventoryTypes

A key routes a file in four ways:

- Routing folder: `Server/` (the key's name) sends everything inside to the key's target and leaves no folder.
- Suffix: `Combat@Server.luau` routes one file, and `@Server` comes off the name. `Matchmaking@Server/` routes a folder and keeps its name; a bare `@Server/` routes and leaves no folder. `@` never changes the script class, so `Combat@Server.luau` is a ModuleScript in ServerScriptService.
- Marker file: an empty `@Server` routes its directory and everything below, and the directory keeps its name. A dot-file like `.server` routes nothing and warns.
- Rojo's `.server` and `.client` at the end of a script name set its class (Script, LocalScript), and also route when a key of that name is declared. So does a sync rule whose `suffix` spells the class its `use` gives, such as `.server.lang` with `serverScript`, or with a `compiledPath` any rule that reads the extension. No other key routes through a dot, and nothing but a script does: `Types.shared.luau` is named `Types.shared` and `Config.server.json` is `Config.server`, and both warn; write `Types@Shared.luau` and `Config@Server.json`.

`-`, `_`, `+` and a capital letter (`CombatServer`) don't route by a name key. Such a file goes to a pattern route its name matches, then to `*`, or is unrouted in a config without `*`; `rogen where` says `route * (fallback)`.

A key with a `*` is a pattern on a file's name or the name of the instance it makes, such as `*.tsx`, `*Controller` or `*Controller.*`. It routes only a file that no folder, `@` suffix, marker or `.server`/`.client` routes, and it keeps the name: `ShopController.luau` stays `ShopController`. It never matches a folder or an init script, which is its folder, so `InputController/init.luau` routes with the rest of its folder; name the folder `InputController@Client/` to route it. The pattern with more characters that aren't `*` wins (`*.story.tsx` over `*.tsx`); a tie between different targets is an error. Patterns match letter case exactly and never a path.

Matching is exact: key `Server` matches `Server/`, not `server/` or `SERVER/`, and `rogen write` warns about those. Only Rojo's lower-case `.server` and `.client` route a key of that name in any case. An `@` that nearly spells a route (`Save@sever.luau`, `Save@server.luau` under `Server`, or a marker `@server`) is an error naming the closest key, since an `@` only means a route; other `@` names, such as packages, stay silent.

The governing route is the first one found walking down from the source path. Every route after it is ignored whole: a nested `Server/` folder is an ordinary folder that keeps its name. A nested `@key` naming another route is an error (`Server/Util@Client.luau`), and one restating the governing route is fine. So `Shared/Server/Datastore.luau` stays in ReplicatedStorage; never put server code under `Shared/`. Rogen warns when that ships server modules to clients (a `Shared/Server/@Shared` marker says the folder is meant to), and when a Script or LocalScript lands where it never runs.

A file no route matches goes to the `*` route, which `init` writes. In a config without `*`, such a file is left out, with a warning that names the routing folders of its feature to move it into.

A file's instance path is its route's target, then its folders without the routing folder, then its name as Rojo reads it (`Save.server.luau` is `Save`). A name that starts with `^` (`^Animate.client.luau`, or a folder `^Hud/`) lands directly at the target instead, dropping every folder in between; quote it in a shell. `^init.luau` is an error: hoist the folder.

Requires and imports:

- `Shared/` code runs on both sides, so it can't require anything in `Server/`: the client can't see ServerScriptService.
- Luau: require by instance path (`ReplicatedStorage.Shared.Inventory.InventoryTypes`). `rogen where <file>` prints the exact expression under the file's line (`--json` has it in `require`), with names that aren't identifiers written as indexes; under the Starter containers, whose contents are cloned at runtime, and for scripts, it says why there is none, and it prints nothing for roblox-ts sources. String requires resolve against the instance tree, so `./` only reaches files routed into the same folder.
- roblox-ts: import by relative file path; `rbxtsc` resolves it through the project file, so run `rogen write` before compiling.
- Keep the import boundaries the repo states. A crossed boundary means the code is in the wrong place: move it, don't add an exception.

`rogen where <path>` prints where a file lands and why, before or after it exists. Given an instance as Studio prints it (`ServerScriptService.Inventory.Save:12`), it prints the file behind it.

The docs page: https://rogen-roblox.vercel.app/docs/v2/routing
