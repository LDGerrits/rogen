<!-- rogen -->
## Rogen

This repo uses Rogen. Each `*.rogen.json` generates the Rojo project file beside it (`game.rogen.json` → `game.project.json`) from folder and file names, so a file's path on disk is not its path in the game, and adding, moving or deleting a file can leave the project file out of date.

After you add, move, rename or delete files, or edit a `*.rogen.json`, run `rogen check <paths>` from the repo root. Fix each line it prints, or tell the user why it stays. When it says to run `rogen write`, run it.

### Placing code

- Name new files like their neighbours: same folders, `@` suffixes and casing. Run `rogen where <path>` to see where a file lands and how to require it.
- A folder or `@` suffix named after a key in `routes` routes its contents: `Shop/Server/`, `Save@Server.luau`.
- The outermost route wins, so `Shared/Server/Save.luau` ships to clients. Keep server-only code under a server route.
- In roblox-ts, import by relative path.

### Changing the setup

- Edit the `*.rogen.json`, never the generated `*.project.json`.
- Put what names can't place, such as packages, in the `tree`; Rogen adds the routed files to it.
- Configs share nothing: apply a change to `routes`, `sourcePaths` or `tree` to every `*.rogen.json` it concerns.
- Read `rogen doc routing` before adding a route or a new naming pattern.

### Commands

- In roblox-ts, check `projects/common` through a place that uses it: `rogen check projects/game`.
- Run other commands in the folder of the `*.rogen.json`, or name it: `rogen write projects/game`.
- To sync to Studio, run `rogen serve --json` in the background and leave it running. `rogen help serve` explains its output.
- `rogen doc <topic>` covers `routing`, `config`, `layout` and `output`; `rogen help <command> --json` lists a command's flags and JSON output.
<!-- /rogen -->
