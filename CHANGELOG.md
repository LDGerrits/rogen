# Changelog

All notable changes to Rogen. Rogen follows [Semantic Versioning](https://semver.org).

## Unreleased

## [2.0.0-beta.1] - 2026-10-26

Rogen v2 is a complete overhaul. It's now a Rojo superset with file-system routing for feature-based organization. Name a folder or file after a route, and Rogen generates the Rojo project file that sends it there.

### Install

```bash
rokit add ldgerrits/rogen@2.0.0-beta.1
npm i @ldgerrits/rogen@next
```

Rogen v2 needs Rojo 7.5.0 or newer. Run `rogen init` to start a project, or see [Creating a New Game](https://rogen-roblox.vercel.app/docs/v2/new-game). Without a version, `rokit add ldgerrits/rogen` and `npm i @ldgerrits/rogen` still install 1.4.4.

### Highlights

- **A Rojo project file with routes:** `default.rogen.json` takes every Rojo key plus `routes`, and Rogen writes `default.project.json` from it.
- **Routing by folder or by name:** A `Server/` folder, an `@Server` suffix or an `@Server` marker file sends code to that route's target. The outermost route wins. A file that no route covers is left out with a warning, or goes to the `*` fallback route.
- **Rojo's commands:** `serve`, `build`, `upload`, `sourcemap`, `syncback`, `fmt-project` and `plugin` take Rojo's flags and write the project file first.
- **Spotting problems:** `rogen check` reports each problem with a code and its fix, and `rogen where` prints where a file lands and how to require it.
- **Built for coding agents:** `rogen init` adds Rogen's rules to `AGENTS.md`. And there's an optional hook that checks the files an agent changed before it ends its turn. Every command can also print in JSON.
- **A new website:** The docs are rewritten for v2, with a new home page and a new look, at [rogen-roblox.vercel.app](https://rogen-roblox.vercel.app).

### Breaking changes

Rogen v2 reads configs and file names differently from 1.x, and every command stops with `legacy.config` while a v1 `.rogen.json` is in the folder. See [Migrating from v1](https://rogen-roblox.vercel.app/docs/v2/migrating-from-v1) to move a project.

### Feedback

Report if anything breaks in [GitHub Issues](https://github.com/LDGerrits/rogen/issues) or on [Discord](https://discord.com/channels/385151591524597761/1503801029232295996).

[2.0.0-beta.1]: https://github.com/LDGerrits/rogen/releases/tag/v2.0.0-beta.1

## [1.4.4] - 2026-08-20

This patch fixes a regression introduced in 1.4.2.

### Fixes

* **StarterCharacterScripts and StarterPlayerScripts aliases:** Fixed an issue where adding custom aliases for nested services (`StarterCharacterScripts` or `StarterPlayerScripts`) did not generate the correct nodes in the project file.

[1.4.4]: https://github.com/LDGerrits/rogen/releases/tag/v1.4.4

## [1.4.3] - 2026-08-15

This patch fixes a bug where folders with semantic version names were incorrectly removed during build.

### Fixes and Improvements

* **Data File Classification:** Fixed an issue where folders with semantic version names (e.g., `sleitnick_signal@2.0.3`) were incorrectly detected as data files. Rogen now uses a whitelist of supported data extensions (those supported by Rojo and Argon) to prevent this from happening.

[1.4.3]: https://github.com/LDGerrits/rogen/releases/tag/v1.4.3

## [1.4.2] - 2026-08-10

This patch brings major stability fixes for Rojo and Windows users, and smarter project file generation.

### Major Upgrades

* **Rojo Stability & Live Deletions:** Deleting a file or folder during `rojo serve` no longer has any possibility of crashing Rojo. Rogen now builds entries using Rojo's optional path format (`{ "optional": path }`).
* **Windows "Folder in Use" Fix:** Watching now polls for changes (only on Windows). Polling stops editors like VSCode from showing "folder in use" prompts.
* **Stale Instance Cleanup:** Generated folders set `$ignoreUnknownInstances: false` by default.
* **Atomic Writes:** Rogen writes the project file atomically to prevent watchers from reading a half-written file.

### Bug Fixes

* **TypeScript Definitions:** Fixed a bug where Rogen failed to ignore `*.d.ts` files due to a bug introduced in v1.4.0.
* **Glob Ignore Paths:** Improved the project tree structure when you use `globIgnorePaths`.
* **Service Containers:** Fixed a desyncing issue for undefined service containers.
* **Luau Project Deletions:** Fixed a bug where the watcher fired mid-deletion and tried to rebuild deleted paths as empty stubs. Rogen now creates placeholder stubs only for compiled projects (TypeScript or Darklua). In Luau projects, Rogen simply drops the old node.

### Additions

* **Initial Run Log:** Added a log message for the first run even if there were no changes for improved feedback.

[1.4.2]: https://github.com/LDGerrits/rogen/releases/tag/v1.4.2

## [1.4.1] - 2026-08-01

This patch fixes a folder collapsing edge-case and stops raw data files from preventing rebuilds.

### Fixes and Improvements

* **Folder Collapsing:** Fixed an issue where folder collapsing overwrote a parent node's own `$path`. Rogen now skips folder collapsing on nodes with an existing `$path`.
* **Data File Handling:** Rogen no longer stops building `project.json` when it finds an unmapped raw data file. Rogen now removes these files from the tree, finishes the build, and warns you to use `globIgnorePaths` or to wrap them in a folder.

[1.4.1]: https://github.com/LDGerrits/rogen/releases/tag/v1.4.1

## [1.4.0] - 2026-07-31

Introducing a new [documentation website](https://rogen-playfully.vercel.app), major stability fixes for Rojo, and a powerful tag system. If you use an old configuration, Rogen will warn you exactly what to change.

### Breaking Changes

* **Configuration:** Configured paths now resolve relative to the `.rogen.json` file, not your current terminal folder. You can now run Rogen from any directory, which makes managing multi-place projects much easier. (Paths passed via CLI flags still use your terminal folder.)
* **Configuration:** The `.rogen.json` file now uses `project` instead of `template` to define the base tree.
* **Configuration:** The `verbatim` boolean replaces the old `keepRouteNames` setting.
* **CLI:** The `-t` flag now activates tags. It no longer sets the template.
* **CLI:** The `-p` or `--project` flag overrides the project file. This replaces the old `-t` template flag.

### Major Upgrades

* **Rojo Stability:** Improved the generated Rojo structure. This fix significantly reduces Rojo crashes when deleting files or folders.
* **Tag System:** Rogen now supports build-time dependency injection. You can filter test files and mock data from production builds. Define tags in your config, then apply them to files or folders. Rogen removes files with inactive tags from the build entirely.
* **Data Files:** Rogen now properly handles data files like `.json` and `.yml`.
* **Argon Support:** Rogen now fully supports Argon.

### Additions

* **New Config Options:** Use `unwrap` to remove global wrapper folders, and use `globIgnorePaths` to ignore exact file patterns. Use `casing` to set folder formatting to `"camelCase"` or `"PascalCase"` (contributed by @bo-rges)
* **Invisible Folders:** Wrap a folder name in parentheses, like `(inventory)`. Rogen keeps the files together on your machine but removes the folder from Roblox Studio.
* **File Hoisting:** Add a `^` symbol to the start of a file name to place it exactly at the root of a service.
* **New Marker Files:** Drop `.structure`, `.sync`, `.verbatim`, or `.unwrap` into a folder to change how Rogen reads its contents.
* **New Routing Delimiter:** Use the plus symbol (`+`) as a routing delimiter in file names, alongside dots, hyphens, and underscores.
* **Logging & Collision Warnings:** Rogen logs events more clearly and warns you when file paths collide.
* **Exact Keyword Names:** If a file name matches a routing keyword exactly, Rogen treats it as the name, not as a routing affix.
* **CLI Commands:** You can run `watch` and `init` directly as commands. The old `-w`, `--watch`, `-i`, and `--init` flags still work.
* **Version Check:** View the installed version using the new `-v` or `--version` flag.

### Package Manager Support

- You can now install Rogen with npm using `npm i @ldgerrits/rogen`

[1.4.0]: https://github.com/LDGerrits/rogen/releases/tag/v1.4.0

## [1.3.1] - 2026-06-30

- Rogen's code moved to TypeScript. Nothing changes in how you use it.

[1.3.1]: https://github.com/LDGerrits/rogen/releases/tag/v1.3.1

## [1.3.0] - 2026-06-27

- **Marker files:** An empty `.server`, `.client` or `.shared` file routes the folder it is in, and the folder keeps its name.
- **Prefixes:** A routing keyword can start a file name as well as end it, as in `server.data.ts` or `serverData.ts`.
- **File names win:** A file's prefix or suffix now overrides its folder and marker file. Before, the folder won.
- **Renamed:** `keepSuffixes` and `-k, --keepSuffixes` are now `keepRouteNames` and `-k, --keepRouteNames`.

[1.3.0]: https://github.com/LDGerrits/rogen/releases/tag/v1.3.0

## [1.2.2] - 2026-06-15

- **Watching on Linux:** Fixed watching on Linux by replacing `fs.watch` with chokidar.

[1.2.2]: https://github.com/LDGerrits/rogen/releases/tag/v1.2.2

## [1.2.1] - 2026-06-01

- Fixed a bug in watching introduced in 1.2.0.

[1.2.1]: https://github.com/LDGerrits/rogen/releases/tag/v1.2.1

## [1.2.0] - 2026-06-01

- **Several sources:** `source` takes a list of folders, and `-s` can be passed more than once. Rogen merges them into one project: folders with the same route merge, and when two sources hold the same file, the one listed last wins. Useful for multi-place games that share a core.

[1.2.0]: https://github.com/LDGerrits/rogen/releases/tag/v1.2.0

## [1.1.1] - 2026-05-22

- **Init:** `rogen -i` (or `--init`) writes a default `.rogen.json`.
- **Aliases:** The `aliases` key routes your own keywords or folders to a service, such as `"Controller": "ReplicatedStorage"`, and can override the default routing.
- **Keep suffixes:** The `keepSuffixes` key and the `-k` flag keep routing suffixes in script names instead of stripping them.

[1.1.1]: https://github.com/LDGerrits/rogen/releases/tag/v1.1.1

## [1.1.0] - 2026-05-21

- **Config lookup:** Rogen reads `.rogen.json`, or else the first `*.rogen.json` in the folder.
- **CLI:** Fixed `-h` and `-b`, which the help listed but Rogen didn't read.
- Fixed the built-in config Rogen uses when there is no `.rogen.json`.

[1.1.0]: https://github.com/LDGerrits/rogen/releases/tag/v1.1.0

## [1.0.2] - 2026-05-20

- Compiled files that are not there yet get an empty placeholder right away, so Rojo doesn't fail and the compiler has the tree it needs. Before, Rogen waited up to 5 seconds and then dropped them.

[1.0.2]: https://github.com/LDGerrits/rogen/releases/tag/v1.0.2

## [1.0.1] - 2026-05-19

- **Watching:** `rogen -w` regenerates the project file when your files change, so you no longer need chokidar-cli.
- **Help:** `rogen --help` lists every option.
- Waits for compiled output (such as roblox-ts) before writing the project file.

[1.0.1]: https://github.com/LDGerrits/rogen/releases/tag/v1.0.1

## [1.0.0] - 2026-05-19

- First release. Rogen routes your files to Roblox services by folder name (`server`, `client`, `shared` or a service name) or by file-name suffix, and generates the Rojo project file from them. It supports Luau, roblox-ts and Darklua.

[1.0.0]: https://github.com/LDGerrits/rogen/releases/tag/v1.0.0
