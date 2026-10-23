---
name: rogen
description: Rogen places Roblox code by its folder and file names and generates the Rojo project file. Use when a repo has a *.rogen.json and you add, move or rename source files, write a require or import, edit a *.rogen.json, or build or serve the game; or to set up Rogen in a new project.
---

<!-- rogen -->
## Rogen

This repo uses Rogen. Each `*.rogen.json` generates the Rojo project file beside it (`game.rogen.json` → `game.project.json`), and places code by its folder and file names. A file's path on disk is not its path in the game.

### Placing code

- Route keys are the names in a config's `rogen.routes`, such as `Server`, `Client` and `Shared`. A folder named after a key (`Shop/Server/`) sends everything in it to that route's target. A file or folder name ending in `@key` (`Save@server.luau`) does the same for itself.
- The outermost route wins: `Shared/Server/Save.luau` still ships to clients. Put server-only code under a server route.
- Put a new file next to similar files. Run `rogen where <path>` to see where it lands and the `require` that reaches it, even before the file exists.
- In roblox-ts, import by relative path.

### Changing the setup

- Edit the `*.rogen.json`. Do not edit the generated `*.project.json`; every write replaces it.
- Configs share nothing. When you change `routes`, `sourcePaths` or `tree`, change it in every `*.rogen.json` it applies to.
- Read `rogen doc routing` before you add a route or a new kind of folder.

### Commands

- After you add, move or rename files or edit a `*.rogen.json`, run `rogen check <paths>` from the repo root and fix what it prints. Check roblox-ts shared code (`projects/common`) through a place that uses it: `rogen check projects/game`.
- Other commands use the `*.rogen.json` files in the current folder. Run them there, or name the config: `rogen write lobby`, `rogen serve projects/lobby`.
- Run `rogen write` after adding files and before compiling with `rbxtsc`.
- Leave `rogen write --watch` to the user; it never exits.
- To build a place file, run `rogen build -o game.rbxl`.
- To sync to Studio, run `rogen serve --json` in the background and keep it running. It rewrites on every change, and after a failed write it waits for your fix. If the project is already served, it says so and exits. With Rojo 7.7 or later, Studio has your edits once it prints a `connected` line; if none comes, ask the user to click Connect in the Rojo plugin.
- For a command's flags and its `--json` output, run `rogen help <command> --json`.
<!-- /rogen -->

## Starting a project

- `rogen init [folder]` starts a project. It never changes a folder that already has a `*.rogen.json`.
- Under an agent it asks nothing. Run `rogen init --dry-run --json` to see the files and choices it would make, then set each choice with its flag (`rogen help init`).
