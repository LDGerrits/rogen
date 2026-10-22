---
name: rogen
description: Rogen places Roblox code by folder and file name, and writes the Rojo project file from them. Use when a .rogen.json is present and you add, move or rename source files, write a require or import, or edit a .rogen.json.
---

<!-- rogen -->
## Rogen

Rogen writes the Rojo project file from the folders and names under each `.rogen.json`'s `rogen.sourcePaths`. Folders decide where code runs, so the disk path is not the instance path.

- Edit code and `.rogen.json` files, never a `*.project.json` that Rogen writes (`X.rogen.json` writes `X.project.json`): change the `.rogen.json`, whose `tree` holds what names can't express.
- After editing a `.rogen.json`, run `rogen list` in its folder: it shows how the other `.rogen.json` files there (`dist`, `release`) differ from `default`. Each file is complete and none reads another, so keep them in step.
- To change the setup (a route, source path, package mount, Darklua, the workspace file), edit the `.rogen.json` in place, so its comments stay, then run `rogen check`. `rogen init` starts a project, or adds a place with `rogen init places/<name>`; it never changes a config that exists.
- Put a new file where the repo keeps files like it. Server-only code never goes under a shared route.
- Run `rogen where <path>` to see where a file lands, before or after it exists.
- After adding, moving or renaming files, run `rogen check <paths>` and fix what it prints. From the repo root it works for a place's file; a file in `places/shared` has no config and is skipped with a note, so check it through a place (`rogen check places/lobby`).
- Every other command reads only the current folder. Run it where the `.rogen.json` is, or name it (`rogen serve places/lobby`, `rogen build dist`).
- After adding a feature folder, run `rogen build`: `default.project.json` is as fresh as its last build.
- Leave `rogen build --watch` to the user: it never exits.
- To sync to Studio, start `rogen serve --json` in the background. It exits 0 at once if another `rogen serve` already serves the project, or non-zero with diagnostics if it can't serve; otherwise it prints a `serving` line once Studio can connect, and keeps running until that server stops. When that line has `"reportsConnections": true`, a `connected` line follows once Studio connects: wait for it before you count on Studio having your edits, and if it doesn't come, ask the user to press Connect in the Studio plugin once (Rojo's Auto Reconnect setting does it in later sessions). `rogen list --json` shows the same later as `serving.clients`, without the process that printed it.
- Before placing files or writing requires, read `rogen doc routing`. Before guessing a flag or parsing output, run `rogen help --json` (every command) or `rogen help <command> --json` (its options and the shape of its `--json` document). `rogen help <code> --json` explains one diagnostic code, and `rogen help codes <module> --json` lists the codes of one module, such as `route`, offline.
<!-- /rogen -->
