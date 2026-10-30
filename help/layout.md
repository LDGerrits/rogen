# Layout

- A `(Name)/` folder groups files on disk and is left out of the tree. `(Server)/` is still a routing folder.
- A directory with an `init` script (`init.luau`, `init.server.luau`, roblox-ts's `index.ts`) is one instance: the script is the folder, and the other files in it are its children, each routed like any other file.
- A script beside a folder of its name (`Dup.luau` and `Dup/`) is one script, and the files in the folder are its children, as an init script and its folder are. Rojo itself would build them as two siblings of the same name.
- An init script's route (`init@server.luau`, or `init.server.luau` with a `server` key) routes its whole folder like a marker file.
- A folder split across routes becomes an instance in each, and each gets a copy of its init ModuleScript with only the files routed there; an init Script is never copied. A copy's children depend on where it sits, not who runs it, and the server may load two copies, so keep a copied init stateless and use `script:FindFirstChild` rather than `RunService` to pick children.
- An init script with no folder of its own to become, in a source path or a plain routing folder, is an error.
- A file's `.meta.json` is named after the name Rojo gives it: `Save.server.luau` takes `Save.meta.json`, and `^Animate.client.luau` takes `^Animate.meta.json`.
- A feature folder's `init.meta.json` (`{ "className": "Actor" }`) applies to every node the folder becomes. In a governing routing folder or an invisible folder it applies to nothing, and Rogen warns. A `Name@key` folder and a routing folder an outer route outranks are ordinary folders.
- A symlink or junction inside a source path is read as the directory it points at, and keeps its own path in the output.
