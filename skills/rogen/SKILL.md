---
name: rogen
description: Set up Rogen, which places Roblox code by its folder and file names and generates the Rojo project file. Use to start a Roblox project, move a Rojo project onto Rogen, reorganise code into feature folders, or when a repo has a *.rogen.json and its AGENTS.md or CLAUDE.md has no Rogen section.
---

# Setting up Rogen

Rogen's [agent rules](agent-rules.md) belong in the repo's `AGENTS.md`, where every session reads them. This skill gets a repo there. Read the rules before you change any code.

## Start a project, or move a Rojo project onto Rogen

1. Run `rogen init --dry-run --json` in the project folder, or `rogen init <folder> --dry-run --json` for a new one. It writes nothing.
2. Read `decided`, each choice init made with the flag that changes it, and `notes`, what it takes from an existing `default.project.json`. `{"question": "sample", "value": true, "flag": "--no-sample"}` means init writes the Greeter sample, and `--no-sample` leaves it out. Ask the user about each choice the repo doesn't settle: Luau or roblox-ts, one place or several (`--places`), and whether to add the hook that checks changed files when an agent's turn ends (`--agent-hook`).
3. Run `rogen init` with those flags. It writes the `*.rogen.json` and adds the agent rules to `AGENTS.md`.
4. Do what its `nextSteps` say, then run `rogen check` and fix what it prints.

`init` always lifts the tree of a `default.project.json` into `default.rogen.json`, and from then on `rogen write` writes `default.project.json` from the config, so changes go in the config. To start a new tree instead, move `default.project.json` away first. A Rojo project keeps its layout: each folder the project file mounted from `src` becomes a route, so every script stays where it was in the game. When Darklua writes the code to a folder of its own, such as `build`, and a `.darklua.json` is there, `default.rogen.json` reads `src` and `dist.rogen.json` reads that folder; serve it with `rogen serve dist`.

## Add the agent rules to a repo that has Rogen

Run `rogen init --agent-rules` in the folder of the `*.rogen.json`. It adds the rules to `AGENTS.md`, imports them into a `CLAUDE.md` or `GEMINI.md` that is there, and changes no config. Ask the user whether to add the hook too (`--agent-hook`). `rogen write` keeps the rules current after that.

## Reorganise into feature folders

A project moved from Rojo has one folder per side (`src/server`, `src/client`). Grouping it by feature changes instance paths, so agree the feature names with the user first, then for each feature:

1. `git mv` its files into `src/<Feature>/<route key>/`: `src/server/Shop.luau` → `src/Shop/Server/Shop.luau`.
2. Run `rogen where` on each moved file and update every require of it to the expression it prints, `script.Parent` requires included.
3. Run `rogen check src/<Feature>` and fix what it prints.
