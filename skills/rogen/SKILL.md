---
name: rogen
description: Rogen places Roblox code by its folder and file names and generates the Rojo project file. Use when a repo has a *.rogen.json and you add, move or rename source files, write a require or import, edit a *.rogen.json, or build or serve the game; or to set up Rogen in a new project.
---

<!-- rogen -->
## Rogen

This repo uses Rogen. Each `*.rogen.json` generates the Rojo project file beside it (`game.rogen.json` → `game.project.json`) and places code by its folder and file names. A file's path on disk is not its path in the game.

### Placing code

- Route keys are the names in a config's `rogen.routes`, such as `Server`, `Client` and `Shared`. A folder named after a key (`Shop/Server/`) sends everything in it to that route's target; a name ending in `@` and a key (`Save@Server.luau`) sends that file or folder.
- The outermost route wins: `Shared/Server/Save.luau` still ships to clients. Put server-only code under a server route.
- Put a new file next to similar files, then run `rogen where <path>` to see where it lands and the `require` that reaches it. It works before the file exists.
- roblox-ts code imports by relative path.

### Changing the setup

- Edit the `*.rogen.json`, never the generated `*.project.json`.
- Configs share nothing. A change to `routes`, `sourcePaths` or `tree` goes into every `*.rogen.json` it applies to.
- Read `rogen doc routing` before you add a route or use a naming pattern the repo doesn't use yet.

### Checking

- After you add, move or rename files or edit a `*.rogen.json`, run `rogen check <paths>` from the repo root and fix what it prints. In roblox-ts, check `projects/common` through a place that uses it: `rogen check projects/game`.
- Other commands read the `*.rogen.json` files of the current folder; run them there, or name the config: `rogen write projects/game`.
- roblox-ts: run `rogen write` before `rbxtsc`, which reads the project file.
- To sync to Studio, run `rogen serve --json` in the background and keep it running: it rewrites on every change and waits after a failed write. Studio has your edits once it prints a `connected` line; if none comes, ask the user to click Connect in the Rojo plugin.
- `rogen help <command> --json` lists a command's flags and the shape of its `--json` output.
<!-- /rogen -->

## Starting a project

- `rogen init [folder]` starts a project. It never changes a folder that already has a `*.rogen.json`.
- Under an agent it asks nothing. Run `rogen init --dry-run --json` to see the files and choices it would make, then set each choice with its flag (`rogen help init`).
