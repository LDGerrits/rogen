# Changelog

All notable changes to Rogen are listed here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Rogen adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 2.0.0 on.

## [Unreleased]

### Added

- `rogen init` migrates a Rogen 1 project. Beside a v1 `.rogen.json`, or a named one such as `lobby.rogen.json`, it writes a config for each mode that ran, named after the mode's `output`. The routes put every file where v1 did, with v1's wrapper folders, `casing`, `unwrap`, `aliases` and the services the source folders name, such as `"Server": "ServerScriptService/server"`. The tree comes from the config's `project`, not from the `default.project.json` that v1 generated. It renames each file that v1 routed by a word in its name to the `@` form (`Combat_Server.luau` to `Combat@Server.luau`), each marker file such as `.server` to `@Server`, and the v1 config to `.rogen.json.v1`. Before, `init` stopped with `legacy.config`, and once the v1 config was set aside, it lifted the generated tree, so every feature folder stayed mounted in the tree. What it can't carry over is a warning: tags (`legacy.tags`), `.structure`, `.unwrap` and `.sync` (`legacy.marker`), roblox-ts files with a routing word in their name (`legacy.typeScriptName`), and files that v1 placed by the deepest routing word (`legacy.outrankedRoute`). `--dry-run` and the summary list every rename, and `--json` lists them under `moves`.

### Changed

- A script beside a folder of its own name, such as `Dup.luau` beside `Dup/`, is now always one script with the folder's files as its children. Before, a route folder that Rogen gave Rojo whole as one `$path` built them as two siblings named `Dup`, and the same files built one script when Rogen mounted them one by one. A file that files from another folder land in, such as a loose `src/Server/Inv.luau` beside the `Inv` feature, or a `^Shop.luau` that hoists into the `Shop` feature, now warns with `tree.instanceClash`.
- A Rojo error keeps every line Rojo wrote. `rojo.commandFailed` reads `Rojo couldn't build this project:`, and each line of Rojo's message and each `Caused by:` cause follows on an indented line of its own, with paths relative to the working folder. In `--json`, the diagnostic's `details` array and each message's `details` hold those lines. Before, the lines were joined with `: ` and the causes were dropped. In `--watch`, a failed Rojo prints once, relative to the working folder. A Rojo that can't be found or started is `rojo.notFound`, `rojo.notInstalled` or `rojo.unusable` for every command; before, it was `serve.noServer`, `serve.notInstalled` or `serve.serverFailed`, even on `build`.
- `legacy.config` now says to run `rogen init` to migrate the config.
- Rojo's commands print one line for each thing done, in place of Rojo's progress lines and Rogen's header. `rogen build -o game.rbxl` prints `Wrote default.project.json.` when the project file changed, then `Built game.rbxl.`; a project file left as it was, and Rojo's own `Building project` and `Built project to` lines, show only under `--verbose`. A line Rojo prints that Rogen doesn't know shows as `Rojo: <line>`. The header stays for several configs and for `--watch`. These lines go to the stream where Rojo prints its own: stdout for `build`, `upload`, `plugin` and `sourcemap -o`, stderr for `syncback` and a printed sourcemap. `fmt-project` prints nothing when it succeeds, as Rojo does. In a terminal, a command that draws no frame prints plain lines.
- On a plain Rojo project, which has no config, Rojo's commands no longer warn with `scan.unmountedSource`, because Rojo says nothing about files that nothing mounts. `rogen check` still reports them. In `--watch` and `serve`, a broken plain project file now prints `Waiting until default.project.json loads.`, not `Still writing from the last valid default.project.json.`, since Rogen never writes that file.

- `rogen init` now writes a `*` route by default, so a file that matches no route goes to the shared route. Only the files that run on one side need marking, such as with `@Server`. To leave such files out with a warning instead, remove `*` from `routes` in the config.
- `rogen init` lifts a Rojo project whose code Darklua writes to a folder of its own, such as `build`, into a `default.rogen.json` that reads the source and a `dist.rogen.json` with that folder as its `compiledPath`, and its next steps serve `dist`. It looks for a `.darklua.json` or `.darklua.json5` and for mounts that repeat the source path. Before, the lifted config kept the mounts of that folder, so Rojo synced each script twice.
- In `rogen init --json`, each `decided` entry names the flag that changes the choice, as the agent skill reads it: `--no-sample` for the sample init writes, `--places` for one place. Before, it named the flag that keeps the choice. The text line names each choice with the same flag: "Took the defaults, each with the flag that changes it: a place (--kind), luau (--language), one place (--places), …".
- `rogen init` adds the agent hook only when `--agent-hook` is given, or when it is chosen under Customise. Before, pressing Create in a terminal added it where a coding agent was in use, while `-y` didn't. Where one is in use, a note says that `rogen init --agent-hook` adds it, and running it where the hook is registered already says so.
- The `output.nothingEmitted` warning for one source path now reads `source path "src" has no output under "out"`. Before, it read `nothing emitted for source path "src" exists under "out"`.
- `rogen syncback` runs on a project with a `compiledPath`. It writes the changes outside the compiled path, such as the folders the tree mounts, and lists each changed, removed or new instance that the project compiles as a `syncback.compiledPath` warning, for you to make in the source files. Before, it stopped with `syncback.compiledPath` and wrote nothing. In a terminal, the warnings about what syncback leaves out now come before it asks to write the rest.

- `rogen fmt-project` formats a `.rogen.jsonc` and a config with comments, and keeps the comments. A comment on its own line moves with the entry after it, a comment at the end of a line with the entry on that line, and a comment before a closing `}` or `]` stays at the end of that object or array. Before, it refused every `.rogen.jsonc` and every config with a comment (`format.commentsLost`), which is gone, and `rojo fmt-project` deletes them.

### Removed

- `rogen init` no longer has flags or questions for what is one line in the config. `--route`, `--unmatched`, `--package`, `--source-path`, `--project-file`, `--darklua` and `--compiled-path` are gone, and so are their questions. Edit the config instead. `--sample` and `--no-agent-hook` are gone too, as they only repeated a default; each is now a usage error that names the flag that changes it. The entries below say what each one did and what init does now.
- `rogen init` no longer asks which routes, packages or unmatched files to start with (`--route`, `--package` and `--unmatched`). It writes the server, client, shared and `*` routes, or the routes a lifted `default.project.json` mounts, and mounts the package folders that are installed or that a `wally.toml` or `pesde.toml` says are coming. Its next steps say to change `routes` and the `tree` in the config, or in each `.rogen.json` where there are several. In `--json`, `decided` no longer lists `routes`, `unmatched` or `packages`, and a `value` is never a list.
- `rogen init` no longer asks for the source path (`--source-path`): it finds it. When it lifts a Luau project, the source path is the closest folder that holds every folder of code the project file mounts, so `code/server` and `code/client` give `code`. A folder named after a route, such as `src/server` alone, gives its parent `src` when the routes put the code where the project file did. Folders mounted from the top of the project, such as `server/` and `shared/`, stay mounted in the tree, with a note. Package folders, `"."` and a compiler's output are never source paths. Code that no source path holds and the tree doesn't mount gets an `init.codeOutsideSourcePaths` warning, also in `--json` `warnings`. Before, a lifted project whose code wasn't in `src` got an empty `src`, and Rogen placed nothing, with no warning.
- `rogen init` no longer asks whether to lift a hand-written `default.project.json` or start a new tree (`--project-file`): it always lifts it into `default.rogen.json`. Starting a new tree replaced the file and lost its tree with no warning. To start a new one, move `default.project.json` away first. Beside it, `--places`, and `--kind model` or `--kind plugin` when the file is a place's, are a usage error that says so.
- `rogen init` no longer sets up Darklua for a new project (`--darklua` and `--compiled-path`): it writes no `.darklua.json`, Darklua pin, `dist.rogen.json` or `.gitignore` entry for Darklua's output, and its next steps run no `darklua process`. `rogen write` still knows Darklua's output in a `compiledPath`, and warns about it as before.

### Fixed

- `rogen check` now reports a value Rojo can't read as `config.wrongType`, at the value: a `servePort` over 65535, a negative or fractional `placeId`, `gameId` or place ID, a `serveAddress` that is not an IP address such as `localhost`, and a key of `syncbackRules` Rojo doesn't know or of the wrong type. Before, they passed, and `rojo build` failed later with "Failed to deserialize JSON".
- `rogen fmt-project` refuses a config that `rogen check` refuses, with the same diagnostics, such as an unknown key or `config.unnamedProjectFile`, and writes nothing. Before, it wrote the file and exited 0, and named a nameless `lobby.rogen.json` after its folder, which nothing else in Rogen or Rojo does. `default.rogen.json` still takes the folder's name.
- `rogen fmt-project` writes what `rojo fmt-project` writes for a file written by hand: it leaves out an empty `$properties`, `$attributes`, `ignoreTrees`, `ignorePaths`, `ignoreProperties`, `serveAllowedHosts`, `globIgnorePaths` and `syncRules`, writes a `$path` with `/`, keeps each place ID once, prints an IPv6 address in its shortest form, and sorts keys by their UTF-8 bytes.
- `rogen build --watch` and `rogen sourcemap --watch` run Rojo again when the compiler writes to the compiled path, as Rojo's own `--watch` does. Before, they ran Rojo only after a change to the source files, which came before the compiler had written its output, so the place file or sourcemap was one compile behind. These two watches now print a block for each compile, as they do for each change to the source files.
- In `rogen write --watch`, `rogen serve` and the other watches, the compiled path warnings now say what the compiled path holds after each change to it, as `rogen write` does. Rogen watches the compiled path and checks it again when the compiler writes there, without rewriting the project file, and prints a block only when the warnings change. Before, the warnings stayed as they were at the first write, so `output.nothingEmitted` stayed after the compiler had run, and `compiled.orphan` never came until the watch restarted.
- `rogen syncback` no longer warns about instances whose only change is the empty `SerializedOverrides` that Roblox Studio saves on every instance and Rojo doesn't know. Before, each compiled instance became a `syncback.compiledPath` warning, and each node that routing made a `syncback.unplaced` warning, on every syncback of a place Studio saved, so the real edits were lost in the list. The files Rojo writes stay as Rojo writes them.
- `rogen syncback` keeps a new instance that Studio added under a node of the config's `tree` with no `$path`, below a service. One that a node can describe, such as a RemoteEvent, a StringValue or a folder of them, is added to the tree as a child node, and anything else, such as a script, gets a `syncback.unplaced` warning that says to give the node a `$path` or create the file by hand. Before, syncback left it out without a word and said it changed nothing, as Rojo does. Under a service itself, such as `Workspace` or `Lighting`, under a node that only routing made, and under a node with `"$ignoreUnknownInstances": true`, syncback leaves new instances out as Rojo does, so the instances Studio makes there, such as `Terrain`, `Camera` and `Sky`, don't land in the tree or in a warning.
- `rogen syncback` writes a new feature whose script has children, such as a Folder `Quest` holding a ModuleScript `Tracker` with a child, into `src/Quest/Server/Tracker/`, as every other feature is laid out. Before, it wrote it into `src/Server/Quest/`, and did the same when Studio renamed a feature that holds an init folder.
- With several source paths, `rogen syncback` writes a new feature into the source path that already holds a feature folder of its name, else into the place's own source path: the one named for the place, as `src/game` for `game.rogen.json`, else the one inside the config's folder, as `src` for `projects/game/default.rogen.json` beside `../common/src`. Before, it left every new feature out with a `syncback.unplaced` warning, in the layouts that `rogen init --places` makes.
- `rogen syncback` places an instance named `init` that Rojo reads back as a child, such as a StringValue (`init.txt`) or a RemoteEvent (`init.model.json`), as any other new instance. A script named `init`, which Rojo reads as its folder, gets a `syncback.unplaced` warning that says so and names the instance. Before, both were left out with a warning that said a property or attribute had changed, and named the folder or a path of syncback's own, such as `~kept/3/init`.
- When `rogen syncback` writes a Studio edit into an object of the config's `tree` written on one line, such as `"Lighting": { "$properties": { "ClockTime": 14 } }`, the object stays on one line. Before, the edited part came out half spread over several lines.
- A property or attribute set in Studio on the folder of a feature, such as `ServerScriptService/Combat` for `src/Combat/Server`, goes into the feature folder's `src/Combat/init.meta.json` when the feature makes only that instance, or when every instance it makes got the same change. Before, `rogen syncback` wrote it into the routing folder, where the next build ignored it with `meta.appliesToNothing`, or left it out. A change on one side of a feature with several, such as `src/Inventory/Server` beside `src/Inventory/Shared`, is a `syncback.unplaced` warning that names the others.
- `rogen syncback` keeps a new child named `__proto__` that it adds to the config's `tree`. Before, it was left out.
- `rogen init` takes a roblox-ts project's source path from the `rootDir` in `tsconfig.json`, which roblox-ts compiles. Before, it read a `sourcePath` there, which roblox-ts doesn't use.
- The Baseplate that `rogen init` writes gives its color as whole numbers (`Color3uint8`), which a place keeps exactly, so the first `rogen syncback` no longer rewrites it when nothing changed in Studio.
- With a `compiledPath`, code compiled after the project file was written now syncs into a running Rojo. Rojo never watches a mounted path that is missing when it loads the project, so before it writes, Rogen creates each folder the project file mounts in the compiled path and roblox-ts's `include`, and a placeholder script for each Luau file mounted there, which the compiler replaces. This happened on a fresh checkout when Rojo started before the first compile, and to each new feature folder while serving.
- A folder that holds no file Rojo makes an instance from, such as an empty folder or one with only a `.gitkeep`, a `README.md` or a route marker, is now an empty Folder in the game, as Rojo builds it, and a folder with only an `init.meta.json` is the instance its meta names. Before, `rogen write` left it out, so a route folder emptied in Studio, which `rogen syncback` keeps with a `.gitkeep` as Rojo does, was gone on the next build or serve, and the next syncback said it had no folder to take it.
- When Studio removes or renames a folder whose files `rogen syncback` removes, such as a feature that holds both `Server/Bag.luau` and `Save@server.luau`, syncback removes the folders it emptied as well, up to the source path, as Rojo removes a folder it mounts. Before, it left `src/Inventory/Server` empty, or `src/Combat` when Studio removed the whole `Combat` feature, so the next build still made an empty Folder that the place didn't have, and the next syncback changed nothing. A folder Studio leaves empty still keeps its `.gitkeep`, and an empty folder that syncback didn't remove stays. Syncback's count of changes now counts a removed folder once, as `--list` lists it.
- A `{ "Type": value }` whose type Rojo doesn't know, such as `{ "vector3": [1, 2, 3] }`, is now refused at the value by `tree.unreadableValue` and `meta.unreadableValue`, as Rojo refuses it. Before, an object of one key passed whatever its key.
- An `init.meta.json` that `globIgnorePaths` matches now applies to its folder, as Rojo applies it. Before, Rogen left it out, so the folder became an Actor where Rojo read the folder itself and a Folder where Rogen placed it. A glob that matches the folder itself still leaves the folder out.
- A value in the `$properties` or `$attributes` of a node in the config's `tree` that Rojo can't read, such as a UDim2 written as nested lists, is now an error at the value (`tree.unreadableValue`) in `rogen check`, `rogen write` and `rogen fmt-project`. Before, they all passed it, and `rojo build` failed later with "Failed to deserialize JSON", which doesn't name the value.
- A meta file's `properties` and `attributes` may hold an `Attributes` map and a Terrain's `MaterialColors`, which Rojo reads. Before, `meta.unreadableValue` refused every object of several keys.
- When `rogen init` lifts a project file, files that it mounts through a compiled folder (roblox-ts's `out`, Darklua's) or through a folder above the source path (such as `"."`) no longer count as files Rojo ignored (`init.unmountedFiles`).
- `rogen write` no longer warns that `rbxts.copyfiles.json`, which sloptor writes in the compiled path for itself, is a `compiled.orphan`.
- In a project that has a config, `rogen init --agent-rules` and `--agent-hook` add the agent files also with `--skip-git`, `-y`, `-n` or `--json`. Before, `--skip-git` made them stop with `init.configExists`. With a flag that shapes a config, such as `--language`, they now stop with a usage error that names the flag.
- In the README that `rogen init` writes for one place, the paragraph on which folders decide where code runs now follows the one about the feature it means.

## [2.0.0-beta.1] - 2026-10-26

### Added

- `default.rogen.json`, a Rojo project file with Rogen's keys `routes`, `sourcePaths` and `compiledPath`. Rogen writes `default.project.json` from it.
- Routing by folder (`Server/`), by name (`Save@Server.luau`) or by marker file (`@Server`).
- The `*` fallback route, for files that no other route covers.
- Rojo's commands through Rogen: `serve`, `build`, `upload`, `sourcemap`, `syncback`, `fmt-project` and `plugin`. They take Rojo's flags and write the project file first.
- In a folder with a plain `default.project.json` and no config, Rojo's commands run on that file as Rojo would.
- `rogen write`, which writes the project file, and with `--watch` writes it on every change.
- `rogen check`, which reports each problem with a code and its fix.
- `rogen where`, which prints where a file lands in the game and how to require it.
- `rogen help`, which prints a command's flags or what a diagnostic code means, and `rogen doc`, which opens the docs or prints a topic offline.
- `rogen init` adds Rogen's rules for coding agents to `AGENTS.md`, and can add a hook that checks the files an agent changed before it ends its turn.
- `--json` on every command, for one JSON document instead of text.
- A new docs site at [rogen-roblox.vercel.app](https://rogen-roblox.vercel.app).

### Changed

- **Breaking:** Rogen needs Rojo 7.5.0 or newer.
- **Breaking:** The outermost route wins. In 1.x the deepest rule won.
- **Breaking:** Only `@` routes a name. Prefixes and suffixes such as `server_Combat.luau` and `Combat_Server.luau` no longer route, and Rojo's `.server` and `.client` keep their meaning.
- **Breaking:** Only the routes you declare exist. A file that no route covers is left out with a warning, instead of going to `ReplicatedStorage`.
- **Breaking:** A `^` file goes to the root of its route's target, not of the service.
- **Breaking:** `rogen build -o` builds a place, as Rojo's does.
- **Breaking:** Every command stops with `legacy.config` while a v1 `.rogen.json` is in the folder. See [Migrating from v1](https://rogen-roblox.vercel.app/docs/v2/migrating-from-v1) to move a project.

### Removed

- **Breaking:** The 1.x config keys and flags. `source` is now `sourcePaths`, `aliases` and the built-in keywords are now `routes`, a mode's `build` is now `compiledPath`, and `project` is now the config's `tree`. `casing`, `unwrap`, `verbatim`, tags and modes are gone; [Migrating from v1](https://rogen-roblox.vercel.app/docs/v2/migrating-from-v1) says what replaces each.
- **Breaking:** The `.structure`, `.sync`, `.verbatim` and `.unwrap` marker files.
- **Breaking:** Several places from one config. Each place has a config of its own.
- **Breaking:** `rogen watch` and `-w`. Use `rogen write --watch`, or `rogen serve`, which writes the project file on every change.

## [1.4.4] - 2026-08-20

### Fixed

- Custom aliases for nested services (`StarterCharacterScripts` or `StarterPlayerScripts`) generate the correct nodes in the project file again. This broke in 1.4.2.

## [1.4.3] - 2026-08-15

### Fixed

- Folders with a version in their name, such as `sleitnick_signal@2.0.3`, were taken for data files and removed from the build. Rogen now only takes the data file extensions that Rojo and Argon support.

## [1.4.2] - 2026-08-10

### Added

- A log line for the first run, even when nothing changed.

### Changed

- Generated entries use Rojo's optional path form (`{ "optional": path }`), so deleting a file or folder during `rojo serve` no longer crashes Rojo.
- Watching polls for changes on Windows, so editors such as VS Code no longer show "folder in use" prompts.
- Generated folders set `$ignoreUnknownInstances: false`.
- The project file is written atomically, so a watcher never reads a half-written file.
- A better project tree when you use `globIgnorePaths`.

### Fixed

- `*.d.ts` files were not ignored. This broke in 1.4.0.
- Undefined service containers went out of sync.
- In Luau projects, the watcher fired in the middle of a deletion and rebuilt deleted paths as empty stubs. Placeholder stubs are now made only for compiled projects (TypeScript or Darklua).

## [1.4.1] - 2026-08-01

### Changed

- An unmapped data file no longer stops the build. Rogen leaves it out of the tree, finishes the build, and warns you to use `globIgnorePaths` or to wrap it in a folder.

### Fixed

- Folder collapsing overwrote a parent node's own `$path`. Rogen now skips folder collapsing on nodes with a `$path`.

## [1.4.0] - 2026-07-31

### Added

- Tags, which leave files out of a build, such as tests and mock data. Define tags in your config and apply them to files or folders.
- The `unwrap` config option, which removes the global wrapper folders.
- The `globIgnorePaths` config option, which ignores files by pattern.
- The `casing` config option, which sets folder names to `"camelCase"` or `"PascalCase"` (contributed by @bo-rges).
- Invisible folders: a folder name in parentheses, like `(inventory)`, keeps its files together on disk but leaves the folder out of Roblox Studio.
- File hoisting: a `^` at the start of a file name places it at the root of a service.
- The `.structure`, `.sync`, `.verbatim` and `.unwrap` marker files, which change how Rogen reads a folder.
- The plus sign (`+`) as a routing delimiter in file names, beside dots, hyphens and underscores.
- Support for data files such as `.json` and `.yml`.
- Full support for Argon.
- Warnings for colliding file paths, and for an old configuration, saying what to change.
- The `watch` and `init` commands. The `-w`, `--watch`, `-i` and `--init` flags still work.
- The `-v` and `--version` flags.
- The npm package: `npm i @ldgerrits/rogen`.
- A [documentation website](https://rogen-playfully.vercel.app).

### Changed

- **Breaking:** Paths in the config are resolved from the `.rogen.json` file, not from your terminal's folder, so Rogen runs from any folder. Paths given as flags still use your terminal's folder.
- **Breaking:** The `project` config option replaces `template` for the base tree.
- **Breaking:** The `verbatim` config option replaces `keepRouteNames`.
- **Breaking:** The `-t` flag activates tags. It no longer sets the template.
- **Breaking:** The `-p` and `--project` flags set the project file, which `-t` used to do.
- A file name that is exactly a routing keyword is now its name, not a routing affix.
- The generated Rojo tree crashes Rojo far less when you delete files or folders.
- Clearer log messages.

## [1.3.1] - 2026-06-30

### Changed

- Rogen's code moved to TypeScript. Nothing changes in how you use it.

## [1.3.0] - 2026-06-27

### Added

- Marker files: an empty `.server`, `.client` or `.shared` file routes the folder it is in, and the folder keeps its name.
- Routing prefixes: a keyword can start a file name as well as end it, as in `server.data.ts` or `serverData.ts`.

### Changed

- **Breaking:** A file's prefix or suffix overrides its folder and its marker file. Before, the folder won.
- **Breaking:** `keepSuffixes` and `-k, --keepSuffixes` are renamed to `keepRouteNames` and `-k, --keepRouteNames`.

## [1.2.2] - 2026-06-15

### Fixed

- Watching on Linux, which now uses chokidar instead of `fs.watch`.

## [1.2.1] - 2026-06-01

### Fixed

- A bug in watching introduced in 1.2.0.

## [1.2.0] - 2026-06-01

### Added

- Several sources: `source` takes a list of folders, and `-s` can be given more than once. Folders with the same route merge, and when two sources hold the same file, the one listed last wins.

## [1.1.1] - 2026-05-22

### Added

- The `-i` and `--init` flags, which write a default `.rogen.json`.
- The `aliases` config option, which routes your own keywords or folders to a service, such as `"Controller": "ReplicatedStorage"`, and can override the default routing.
- The `keepSuffixes` config option and the `-k` flag, which keep routing suffixes in script names.

## [1.1.0] - 2026-05-21

### Changed

- Rogen reads `.rogen.json`, or else the first `*.rogen.json` in the folder.

### Fixed

- The `-h` and `-b` flags, which the help listed but Rogen didn't read.
- The built-in config Rogen uses when there is no `.rogen.json`.

## [1.0.2] - 2026-05-20

### Changed

- Compiled files that are not there yet get an empty placeholder right away, so Rojo doesn't fail and the compiler has the tree it needs. Before, Rogen waited up to 5 seconds and then dropped them.

## [1.0.1] - 2026-05-19

### Added

- The `-w` and `--watch` flags, which regenerate the project file when your files change, so you no longer need chokidar-cli.
- The `--help` flag.

### Changed

- Rogen waits for compiled output, such as roblox-ts's, before it writes the project file.

## [1.0.0] - 2026-05-19

### Added

- Routing files to Roblox services by folder name (`server`, `client`, `shared` or a service name) or by file-name suffix, and generating the Rojo project file from them.
- Support for Luau, roblox-ts and Darklua.

[unreleased]: https://github.com/LDGerrits/rogen/compare/v2.0.0-beta.1...HEAD
[2.0.0-beta.1]: https://github.com/LDGerrits/rogen/compare/v1.4.4...v2.0.0-beta.1
[1.4.4]: https://github.com/LDGerrits/rogen/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/LDGerrits/rogen/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/LDGerrits/rogen/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/LDGerrits/rogen/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/LDGerrits/rogen/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/LDGerrits/rogen/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/LDGerrits/rogen/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/LDGerrits/rogen/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/LDGerrits/rogen/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/LDGerrits/rogen/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/LDGerrits/rogen/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/LDGerrits/rogen/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/LDGerrits/rogen/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/LDGerrits/rogen/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/LDGerrits/rogen/releases/tag/v1.0.0
