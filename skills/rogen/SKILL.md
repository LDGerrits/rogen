---
name: rogen
description: Rogen places Roblox code by folder and file name, and writes the Rojo project file from them. Use when a *.rogen.json is present and you add, move or rename source files, write a require or import, or edit a *.rogen.json.
---

<!-- rogen -->
## Rogen

Rogen writes the Rojo project file from the folders and names under each `*.rogen.json`'s `rootDirs`. Folders decide where code runs, so the disk path is not the instance path.

- Never edit a `*.project.json` that Rogen writes: change the config or its `template`.
- Put a new file where the repo keeps files like it. Server-only code never goes under a shared route.
- Run `rogen where <path>` to see where a file lands, before or after it exists.
- After adding, moving or renaming files, run `rogen check <paths>` and fix what it prints.
- A config with `modes` builds in one at a time: run `rogen build --mode <name>` for another, and `rogen list` to see them.
- Leave `rogen watch` to the user: it never exits.
- A running `rogen serve` owns its project file: `rogen build --mode <other>` is refused while it runs (`output.servedInOtherMode`). Build another mode to another file, as `rogen build --mode prod -o prod.project.json`.
- To sync to Studio, start `rogen serve --json` in the background. It exits 0 at once if another `rogen serve` already serves the project in the mode and variants you asked for, or non-zero with diagnostics if it can't serve (`serve.otherMode` when that serve runs another mode); otherwise it prints a `serving` line once Studio can connect, and keeps running until that server stops. When that line has `"reportsConnections": true`, a `connected` line follows once Studio connects: wait for it before you count on Studio having your edits, and if it doesn't come, ask the user to press Connect in the Studio plugin once (Rojo's Auto Reconnect setting does it in later sessions). `rogen list --json` shows the same later as `serving.clients`, without the process that printed it.
- Before placing files or writing requires, read `rogen help routing`. `rogen help` lists every command and topic; read a command's help before guessing a flag.
<!-- /rogen -->
