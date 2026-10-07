# Layout

- A `(Name)/` folder groups files on disk and is left out of the tree. `(Server)/` is still a routing folder.
- A directory with an `init` script (`init.luau`, `init.server.luau`, roblox-ts's `index.ts`) is one instance: the script is the folder, and the other files in it are its children, each routed and varied like any other file.
- An init script with no folder of its own to become, in a root dir or a plain routing folder, is an error.
- A file's `.meta.json` is named after the name Rojo gives it: `Save.server.luau` takes `Save.meta.json`, and `^Animate.client.luau` takes `^Animate.meta.json`.
- A feature folder's `init.meta.json` (`{ "className": "Actor" }`) applies to every node the folder becomes. In a governing routing folder, a variant folder or an invisible folder it applies to nothing, and Rogen warns. A `Name@key` folder and a routing folder an outer route outranks are ordinary folders.
- A symlink or junction inside a root dir is read as the directory it points at, and keeps its own path in the output.
