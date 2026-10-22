---
name: rogen
description: Rogen places Roblox code by folder and file name, and writes the Rojo project file from them. Use when a .rogen.json is present and you add, move or rename source files, write a require or import, or edit a .rogen.json.
---

<!-- rogen -->
## Rogen

Rogen writes the Rojo project file from the folders and names under each `.rogen.json`'s `rogen.sourcePaths`. Folders decide where code runs, so the disk path is not the instance path.

- Edit code and `.rogen.json` files, never a `*.project.json` that Rogen writes (`X.rogen.json` writes `X.project.json`).
- Put what names can't express in the `.rogen.json`'s `tree`.
- Each `.rogen.json` is complete and none reads another: make a change to routes, source paths or tree in each one it should apply to (`dist`, `release`, other places).
- To change the setup (a route, source path, package mount, Darklua), edit the `.rogen.json` in place so its comments stay, then run `rogen check`.
- `rogen init` starts a project, in the folder it is given as `rojo init` does; it never changes a config that exists.
- Put a new file where the repo keeps files like it. Server-only code never goes under a shared route.
- Run `rogen where <path>` to see where a file lands, before or after it exists.
- After adding, moving or renaming files, run `rogen check <paths>` and fix what it prints.
- `rogen check` works from the repo root for a file of any place, shared code in `src/common` included.
- `rogen check` skips, with a note on stderr, a file no config holds (roblox-ts `projects/common`) and a file in none of its config's source paths; `--json` lists both under `skipped`. Check shared code through a place (`rogen check projects/lobby`, or `rogen check lobby.rogen.json`).
- Every other command reads only the current folder. Run it where the `.rogen.json` is, or name it (`rogen serve projects/lobby`, `rogen build lobby`, `rogen build dist`).
- After adding a feature folder, run `rogen build`: `default.project.json` is as fresh as its last build.
- Leave `rogen build --watch` to the user: it never exits.
- To sync to Studio, start `rogen serve --json` in the background.
- `rogen serve` exits 0 at once if another already serves the project, and non-zero with diagnostics if it can't serve; otherwise it prints a `serving` line once Studio can connect, and runs until that server stops.
- When the `serving` line has `"reportsConnections": true`, wait for the `connected` line before you count on Studio having your edits; if it doesn't come, ask the user to press Connect in the Studio plugin once (Rojo's Auto Reconnect setting does it in later sessions).
- Before placing files or writing requires, read `rogen doc routing`.
- Before guessing a flag or parsing output, run `rogen help --json` (every command) or `rogen help <command> --json` (its options and the shape of its `--json` document).
- `rogen help <code> --json` explains one diagnostic code, and `rogen help codes <module> --json` lists the codes of one module, such as `route`, offline.
<!-- /rogen -->
