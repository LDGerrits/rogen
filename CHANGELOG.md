# Changelog

All notable changes to Rogen are listed here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Rogen adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from 2.0.0 on.

## [Unreleased]

### Added

- `rogen init` migrates a Rogen 1 project. It writes a config for each mode, renames files such as `Combat_Server.luau` to `Combat@Server.luau`, and warns about what it can't carry over. See [Migrating from v1](https://rogen-roblox.vercel.app/docs/v2/migrating-from-v1). ([#285](https://github.com/LDGerrits/rogen/pull/285))
- `rogen syncback` runs on a project with a `compiledPath`. It writes what it can, and lists each compiled change for you to make in the source files. ([#257](https://github.com/LDGerrits/rogen/pull/257))
- `rogen fmt-project` formats a config with comments, and keeps them. ([#284](https://github.com/LDGerrits/rogen/pull/284))
- `rogen where` prints how to require a JSON, TOML or YAML module. ([#291](https://github.com/LDGerrits/rogen/pull/291))
- The `route.scriptSuffixBeforeAt` warning, for a name such as `Start.server@client.luau`, which Rojo makes a ModuleScript. ([#291](https://github.com/LDGerrits/rogen/pull/291))

### Changed

- **Breaking:** A Rojo that can't be found or started is `rojo.notFound`, `rojo.notInstalled` or `rojo.unusable` in every command. Before, it was `serve.noServer`, `serve.notInstalled` or `serve.serverFailed`. ([#286](https://github.com/LDGerrits/rogen/pull/286))
- **Breaking:** Ctrl+C now exits every `--watch` with 130, and SIGTERM with 143, as in `serve`. ([#286](https://github.com/LDGerrits/rogen/pull/286))
- Rojo's commands print one line for each thing done, such as `Wrote default.project.json.` and `Built game.rbxl.`. Rojo's progress lines show under `--verbose`. ([#286](https://github.com/LDGerrits/rogen/pull/286))
- `rogen serve` prints where it serves as Rojo does. ([#286](https://github.com/LDGerrits/rogen/pull/286))
- A Rojo error keeps every line and cause Rojo wrote. ([#286](https://github.com/LDGerrits/rogen/pull/286))
- `rogen build --watch` and `rogen sourcemap --watch` run Rojo's own `--watch`, so a change anywhere the project mounts, such as `Packages/`, builds again. ([#286](https://github.com/LDGerrits/rogen/pull/286))
- A script beside a folder of its own name, such as `Dup.luau` beside `Dup/`, is always one script with the folder's files as its children, as in Rojo. ([#286](https://github.com/LDGerrits/rogen/pull/286))
- `rogen init` writes a `*` route, so only the files that run on one side need marking. ([#259](https://github.com/LDGerrits/rogen/pull/259))
- `rogen init` adds the agent hook only with `--agent-hook`. ([#264](https://github.com/LDGerrits/rogen/pull/264))
- On a plain Rojo project, Rojo's commands no longer warn about files nothing mounts. `rogen check` still does. ([#286](https://github.com/LDGerrits/rogen/pull/286))

### Removed

- **Breaking:** The `rogen init` flags for what is one line in the config: `--route`, `--unmatched`, `--package`, `--source-path`, `--project-file`, `--darklua` and `--compiled-path`, with their questions, and `--sample` and `--no-agent-hook`. Init finds the source path, always lifts an existing `default.project.json`, and no longer sets up Darklua. ([#264](https://github.com/LDGerrits/rogen/pull/264))

### Fixed

- `rogen syncback` puts a new feature, and a change to a feature folder, where the next build reads them, also with several source paths. ([#283](https://github.com/LDGerrits/rogen/pull/283))
- `rogen syncback` keeps a new instance under a `tree` node with no `$path`, and removes the folders it empties. ([#283](https://github.com/LDGerrits/rogen/pull/283))
- `rogen syncback` no longer reports every instance of a place that Studio saved as changed. ([#269](https://github.com/LDGerrits/rogen/pull/269))
- `rogen syncback` handles nested projects, YAML files and names such as `Rates.model@Server.json` as Rojo does. ([#289](https://github.com/LDGerrits/rogen/pull/289))
- `rogen syncback --json` says `changed: false` when nothing changed. ([#288](https://github.com/LDGerrits/rogen/pull/288))
- With a `compiledPath`, code compiled after Rojo started now syncs, also for a new feature while serving. ([#252](https://github.com/LDGerrits/rogen/pull/252))
- The watches check the compiled path again each time the compiler writes, so its warnings and builds are no longer one compile behind. ([#269](https://github.com/LDGerrits/rogen/pull/269), [#270](https://github.com/LDGerrits/rogen/pull/270))
- An empty folder, or one with only a `.gitkeep` or a `README.md`, is an empty Folder, as Rojo builds it. ([#265](https://github.com/LDGerrits/rogen/pull/265))
- An `init.meta.json` that `globIgnorePaths` matches applies to its folder, as in Rojo. ([#268](https://github.com/LDGerrits/rogen/pull/268))
- A value Rojo can't read, such as a `servePort` over 65535 or a UDim2 written as nested lists, is an error at the value. Before, Rojo failed later without naming it. ([#265](https://github.com/LDGerrits/rogen/pull/265), [#268](https://github.com/LDGerrits/rogen/pull/268), [#284](https://github.com/LDGerrits/rogen/pull/284))
- `rogen fmt-project` refuses a config that `rogen check` refuses, and writes what `rojo fmt-project` writes. ([#284](https://github.com/LDGerrits/rogen/pull/284))
- `rogen init` reads a roblox-ts source path from `rootDir` in `tsconfig.json`. ([#264](https://github.com/LDGerrits/rogen/pull/264))
- The Baseplate that `rogen init` writes no longer changes on the first syncback. ([#260](https://github.com/LDGerrits/rogen/pull/260))
- `rogen write` no longer warns about `rbxts.copyfiles.json` in the compiled path. ([#255](https://github.com/LDGerrits/rogen/pull/255))

### Security

- Rogen escapes control characters in the names it prints, so a file name can't change your terminal or issue a GitHub Actions command. ([#288](https://github.com/LDGerrits/rogen/pull/288))

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
