# Changelog

All notable changes to Rogen are listed here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Rogen adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 2.0.0 on.

## [Unreleased]

### Added

- Pattern routes: a route key with a wildcard, in Rojo's glob syntax for one name (`*`, `?`, `[Ss]`, `{a,b}`), such as `*.tsx`, `*Controller.*` or `*[Ss]ervice`, routes a file by its file name or instance name when no folder, `@` name or marker routes it. A pattern never matches a folder or an init script, so a script written as a folder routes with its folder. The pattern with more characters that aren't `*` wins (`?` and a class count one, each `{a,b}` word on its own), and a tie between different places is the error `route.patternClash`. Syncback writes a new file's `@` route when a pattern would send its plain name elsewhere.

- The warning `route.folderPattern` for a folder script whose folder a pattern matches, or a folder of files a pattern without a `*` matches (`server/` under `[Ss]erver`), which no pattern routes, with the rename that does.

- The error `config.duplicateKey` for a route key, or one of Rogen's own keys, written more than once in one object, which JSON reads as the last copy only. Rojo's keys still keep their last copy without a word, as Rojo reads them.

- The warning `scan.uncompiled` for a TypeScript file in a project with no `compiledPath`, which Rojo never reads.

### Changed

- `rogen write` and `rogen serve` no longer refresh the Rogen block of `AGENTS.md` under CI, so a pipeline never finds a file changed. They refresh it only once the configs load and, for `serve`, when it has something to serve. With `--json`, they now report a refresh: `write --json` lists the files, by absolute path, under `agentRules` and sets `changed`, and `write --watch --json` and `serve --json` print an `agentRules` line first.
- **Breaking:** a route key matches a folder, `@` name or marker file only when spelled exactly as the key. A folder, marker or `@` that misses a key by its case, or an `@` that misses it by a typo, as `server/`, `@server` or `Save@Sever.luau` under a `Server` route, is an error that stops the write (`route.caseMismatch`, `route.strayAt`), so a server file can't reach clients by a slip. A folder in another case under a route that already governs it is left alone, and a server-named one there warns that its code ships to clients (`route.serverCodeShipped`) unless a marker file in it keeps it there. A folder inside a script folder, such as a library's `Net/server/`, may be a child the script requires, so its error also names that marker. Rojo's `.server` and `.client` still route a key of that name in any case. `rogen init` spells each key as the folders it finds already do, and a key no folder spells in their case when they agree on one, so a lifted Rojo project gets `server`, `client` and `shared`, and renames a folder or name spelled in the case the rest of the code doesn't use, so the project builds.
- `rogen init` writes the project's `name`, the folder's name, as `rojo init` does, so tools that need a name in the project file can read it.
- **Breaking:** an init script's route routes only the script, not its whole folder. `init@server.luau` and `init.server.luau` become the folder on that side, and the folder's other files route by their own paths, so `init@server.luau` and `init@client.luau` give each side its own init script. To route a whole folder, name it for the route or add a marker file.
- **Breaking:** a plain `init.luau` is its folder only where its own route puts it, `*` unless something routes it, and is no longer copied to every side its folder has files on. On the other sides the folder is a plain Folder of those files. Each copy held only its own side's children, the server could load two copies with two states, and luau-lsp checked the script against just one of them.

- A write that a name's error stops still reports every warning, and `rogen where` still places each file and prints its require, as routing reads it, beside the error.
- `rogen check <paths>` exits 1 when an error elsewhere stops the write, and prints it, since it couldn't check the paths past it.
- The agent Stop hook reports a line again once the check stopped printing it and it comes back.
- `rogen write` and `rogen serve` replace an outdated agent hook script, `.agents/hooks/rogen-check.mjs`, as they do the rules, so a project set up with an earlier version gets the hook's fixes, such as checking a git worktree rather than the main checkout. They list it under `agentRules` with `--json`. Delete the script's first line to keep it as your own.
- In a git worktree with no `node_modules`, the agent Stop hook runs the main checkout's Rogen.
- The agent hook runs on Windows without Git Bash. `rogen init --agent-hook` registers it for Claude Code without a shell (Claude Code 2.1.139 or later), for Gemini CLI and Codex in a form PowerShell reads too, and for Copilot under `powershell` as well as `bash`. Gemini CLI's entry failed on every Windows machine, since Gemini quotes the path it puts in `$GEMINI_PROJECT_DIR`. `rogen write` and `rogen serve` replace an entry an earlier version registered for Claude Code, Codex or Gemini CLI.
- A marker file in the wrong case is `route.strayAt`, as every misspelt `@` is, and `route.caseMismatch` is about folders.
- `rogen init --places --language roblox-ts` writes the same layout as Luau: shared code in `src/common`, the first place in `src/game`, `game.rogen.json` at the root with `compiledPath` `out/game`, and `tsconfig.game.json` with `rootDir` `src`, which TypeScript 6 and later need set. A root `tsconfig.json` holds the shared options and refers to each place. The `projects/<place>` layout it wrote before left `rootDir` unset, so it compiles only with TypeScript 5. A folder named `projects` no longer makes several places the default.

- **Breaking:** two files in one source path that make one instance, as `Types.lua` beside `Types.luau`, or two `^` files that hoist to one place, are an error (`tree.instanceClash`): Rojo would keep both, and the project file can name one, so the build lost the other. Two init files of one folder still only warn, as Rojo itself reads one.
- `rogen init` says why it renames a folder or name, and a dry run counts renames rather than files.
- `rogen init` in a terminal shows the plan and asks before it renames anything, even when it has no question to ask. An error about the project's own code, such as `Main.Server.luau`, no longer stops `init`: it writes its files, prints the error with its fix, and exits 1, as a write would. An error about what `init` writes still stops it before it writes, and a dry run stops on both.

- **Breaking:** `route.dotRoute` is an error, and only where a dot can only have meant a route: a dot-file or dot-folder named for a key, such as `.server`, and Rojo's `.server` or `.client` where Rojo doesn't read it, as `Main.Server.luau`, `Config.server.json` or `Net.server/`. Any other key after a dot, such as `Button.story.luau` beside a `Story` route, is a name of its own and no longer warns.
- The warning `route.folderTypo` is gone. A folder one letter from a route key, such as `Servers/` or `Shard/`, is most often a name of its own, and a warning there couldn't be silenced without renaming a correct folder. Rogen now reports only where a name clearly meant a route: an `@`, a wrong letter case, Rojo's `.server` or `.client` where Rojo doesn't read it, or a folder a pattern names but can't route. A file a pattern misses by letter case or a typo falls to `*` without a word, as a pattern is a guess.

- `rogen where` fails only on an error about what you asked. An error about another file that stops the write is printed with a note, and `where` still passes, since `check` is the gate; `where --json` lists it under `stoppedBy`, as `check --json` does.
- In `--json`, the paths a message names are relative to the folder you ran in, as the text writes them; `file` stays absolute.

### Fixed

- `route.caseMismatch` on a folder in a script folder names a route key to add with its marker file when no key routes where `*` does, where it said only to rename the folder, which would move a child the script requires.
- `rogen where` and `rogen check` with a config and a shared file, as `rogen where places/a/default.rogen.json places/shared/M.luau`, no longer note that no config reads the file when the config named beside it does, and leave it out of `skipped`.
- `rogen check <paths>` and `rogen where <paths>` no longer fail on a named config that doesn't load, such as one with an unknown key, when its source paths don't read the paths asked about. One whose source paths can't be read still fails every path, and `rogen check` alone still fails on it.
- `rogen write --watch` and `rogen serve` no longer crash when a watched config's folder can't be read for a moment; they pick it up again once it can.
- `rogen write` and `rogen serve` count Azure Pipelines, Jenkins, TeamCity and Bamboo as CI, as they do any pipeline that sets `CI`, and leave `AGENTS.md` alone there.
- `rogen syncback` no longer hangs when a nested project mounts a folder that shares no folder but the root with the project, such as one under `/mnt/c` beside a project under `/home`.
- A value Rogen passes on to Rojo stays attached to its flag, so `rogen build --output=-x.rbxl` works as `rojo build` does.
- `rogen -q` with no command prints its usage error, where it printed nothing.
- `tree.instanceClash` about two init scripts of one folder, such as `init.luau` beside an `init@Shared.luau` routed to the same place, says to remove one, since a rename can't keep both.
- `rogen where <folder>` fails on an error about a folder inside it, such as `src/A/.server`, where it said none of the errors was about what you asked.
- On Windows and macOS, `compiled.orphan` no longer warns about a compiled file whose folder is spelled in another case than its source's, such as one compiled before `rogen init` renamed `Server/` to `server/`, since the file system and Rojo read them as one.
- `rogen where` no longer says a `.ts` or `.tsx` file is placed in a project with no compiler, where Rojo never reads it.
- `route.unrouted` names a routing folder to move a file into, and `config.invalidRouteKey` says what is wrong with a key that holds a `/`, `**` or `@`.
- A rename that a diagnostic offers no longer leads into another error: under a route that governs it, a misspelt `@` for another route is `route.ignoredAt` with no rename, and no rename is offered onto a name that is there.
- A `^init` script in a routing folder is `tree.initWithoutFolder`, where the advice to put the `^` on the folder went round in circles.
- `tree.deadScript` says when the route a script sits under overrode its `.server` or `.client`, or when no route has the name `.server` or `.client` would route by.
- `rogen check` and `rogen where` on shared code that no config is above, such as `places/shared` or roblox-ts's `projects/common`, name the places that read it and the command that asks through one, where they used to say only that no config reads it. In `--json`, each such entry under `skipped` lists those configs as `readers`.
- The agent rules that `init` writes to `AGENTS.md` are cut from about 350 words to about 130. An eval of the three versions showed the shorter one does as well, and `check`'s own messages now carry the rest, such as where to check shared code from. `rogen write` and `rogen serve` replace the old block.
- The agent Stop hook checks the folder the session works in, so a session in a git worktree no longer checks the main checkout, and it checks every changed file in the repository, not only those below the folder the agent is in. The agent rules no longer tell an agent to run `rogen serve` in a repository that serves with its own script.
- `rogen syncback` keeps a project's layout through a Studio rename: the renamed folder keeps its `@` form, marker files, invisible folders and data files in their own form, and a child added with the rename is named like its siblings. A new feature at a route's target is no longer lost, an emptied side of a suffix layout stays as a bare `@` folder, and an instance whose files routing would put elsewhere, as for a name it reads as a route, is left out with a warning rather than written. Syncback asks routing itself where each new file lands before writing it.
- `rogen syncback` no longer lists a folder as removed when files in it that the place left alone stay; it lists the files it removes.
- `rogen serve`, `build`, `sourcemap` and `upload` on a plain Rojo project file, such as a wrapper another tool writes, first write the project files it nests that a `.rogen.json` writes, and `serve` and `--watch` keep writing them as files change.
- `rogen syncback` puts a property set on a feature folder in that folder's `init.meta.json` when the feature is routed by an `@Server/` or `(Server)/` folder, has an invisible folder around or inside its routing folder, or holds a `^` file.
- `rogen syncback` writes a new instance beside a `^` file where routing places it, and names a new feature's routing folder the way most of the project's are named.
- `rogen syncback` no longer writes a new instance into the folder of an init script beside it, such as `src/Net/` for a new `Settings` folder next to `Net`, where the next build put it inside `Net`.
- A node whose key starts with `$` but isn't one of Rojo's fields, such as `"$Shared": { "$path": "src/Shared" }`, is a child as it is to Rojo. `rogen syncback --dry-run` no longer writes into the folder such a node mounts, and lists the files; `check` and `where` see what it mounts; `fmt-project` sorts it with the other children; and `check` warns about it with `tree.reservedName`, as Rojo does on every build.
- `rogen syncback` no longer writes a new folder whose name routing rejects, such as a Studio folder `server` inside a script folder under a `Server` route, which stopped every later write with `route.caseMismatch`. It leaves the instance out with a `syncback.unplaced` warning.
- `rogen syncback` writes new code that Studio adds at a route's target the project has no code for yet, such as a first `ReplicatedStorage/Shared/Shop/Types` or a LocalScript in `StarterPlayerScripts` of a project with only server code, where routing puts it. It used to say it would change nothing.
- `rogen syncback` keeps a data file's form when Studio renames a feature on one side only, such as `ServerScriptService/Shop` while the feature's other sides keep `Shop`: `src/Shop/Server/Cfg.json` moves to `src/ShopX/Server/Cfg.json` and the other sides' files stay, where it used to write `Cfg.luau`.
- `rogen where` and `rogen check` find a file given in another letter case than it has on disk, such as `src/greeter/server/greeter.server.luau` for `src/Greeter/Server/Greeter.server.luau`, on Windows and macOS, instead of reporting a file that does not exist yet and a route error.
- `rogen check` and `rogen where` report the error for a file in a folder that cannot be read, as they do for the folder, instead of exiting 0 and calling the file new.
- With `--json`, a crash prints only its JSON document: the `Fatal Error` stack no longer follows it on stderr, unless `-v` asks for it.
- A project file with a deeply nested `tree`, a thousand levels or more, no longer fails with an internal error when Rogen writes it, as Rojo builds it, and writing it is several times faster.

## [2.0.0-beta.4] - 2026-11-10

### Added

- With a `compiledPath`, sync rules can read scripts of any language that compiles to Luau.
- Warnings when a sync rule and a script's name disagree on its class, and when a source path holds no file Rojo reads.

### Changed

- **Breaking:** `emitLegacyScripts: false` works as it does in Rojo. Rogen no longer keeps routed client scripts LocalScripts, and warns about the ones in `StarterPlayerScripts` or `StarterCharacterScripts`, where they run twice.
- A failed or stopped `rogen init` puts the folder back as it was.
- A second Ctrl+C stops every process Rogen started at once.

### Fixed

- Many `rogen syncback` fixes, such as for two runs at once, case-only renames and files saved while it runs.
- Many `serve` and `--watch` fixes for files and configs that change while they start.
- Ctrl+C on any command stops Rojo too and exits with 130.
- On Windows, Rogen waits for a project file another program holds instead of failing.
- Routing by `.server` and `.client` works for a sync rule on any extension.
- Fewer false warnings about files the tree mounts.

## [2.0.0-beta.3] - 2026-11-01

### Changed

- `rogen init` asks fewer questions, and shows the plan's warnings before you accept.
- `rogen write --watch` with no project follows every config of the folder.
- `--json` prints nothing on stderr, and a burst of file changes is named only under `--verbose`.

### Fixed

- Many `rogen init` fixes, such as for Rojo's template layout and roblox-ts projects.
- Many `rogen where` and `rogen check` fixes.
- `serve` and `--watch` keep going when Rojo crashes on deleted folders.
- `--watch` no longer misses a folder that comes back or becomes readable.
- The command line is read as Rojo reads it, `--` and repeated options included.

## [2.0.0-beta.2] - 2026-10-31

### Added

- `rogen init` migrates a Rogen 1 project.
- `rogen syncback` works on a project with a `compiledPath`.
- `rogen fmt-project` keeps comments.

### Changed

- **Breaking:** `rogen init` drops the flags for what is one line in the config, and writes a `*` route by default.
- **Breaking:** Rojo failures use the `rojo.*` codes in every command.
- Output is shorter and closer to Rojo's.
- `--watch` runs Rojo's own watch, and Ctrl+C exits with 130.

### Fixed

- Many `rogen syncback` fixes.
- Behaviour that differed from Rojo, such as empty folders and values Rojo can't read.
- File names with control characters are escaped in output.

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

[unreleased]: https://github.com/LDGerrits/rogen/compare/v2.0.0-beta.4...HEAD
[2.0.0-beta.4]: https://github.com/LDGerrits/rogen/compare/v2.0.0-beta.3...v2.0.0-beta.4
[2.0.0-beta.3]: https://github.com/LDGerrits/rogen/compare/v2.0.0-beta.2...v2.0.0-beta.3
[2.0.0-beta.2]: https://github.com/LDGerrits/rogen/compare/v2.0.0-beta.1...v2.0.0-beta.2
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
