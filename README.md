<p align="center">
	<a href="https://rogen-playfully.vercel.app">
		<img src="https://raw.githubusercontent.com/LDGerrits/rogen/main/docs/public/icon.png" alt="Rogen logo" width="100" />
	</a>
</p>
<p align="center">Rogen is a superset of Rojo that generates Rojo project files.</p>
<p align="center">
	<a href="https://www.npmjs.com/package/@ldgerrits/rogen"><img alt="npm" src="https://img.shields.io/npm/v/@ldgerrits/rogen?style=flat-square" /></a>
	<a href="https://github.com/LDGerrits/rogen/actions/workflows/test.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/LDGerrits/rogen/test.yml?style=flat-square&label=build" /></a>
	<a href="LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/LDGerrits/rogen?style=flat-square" /></a>
	<a href="https://discord.com/channels/385151591524597761/1503801029232295996"><img alt="Discord" src="https://img.shields.io/badge/discord-chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
</p>
<p align="center">
	<a href="https://rogen-playfully.vercel.app/docs/v2">Documentation</a> |
	<a href="https://rogen-playfully.vercel.app/docs/v2/installation">Installation</a> |
	<a href="https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo">Coming from Rojo</a> |
	<a href="https://rogen-playfully.vercel.app/docs/v2/cli">CLI</a>
</p>

---

With Rogen, a feature's server, client and shared code live in one folder.

Rogen generates the Rojo project file. It takes the same commands and flags as Rojo.

### Installation

```bash
rokit add ldgerrits/rogen    # Rokit
npm i @ldgerrits/rogen       # npm, then run it as npx rogen
```

Rogen needs Rojo and its Studio plugin. After `rogen init`, run `rokit install` and `rogen plugin install`.

### Usage

```bash
rogen init                     # Start a project, or move a Rojo project to Rogen
rogen serve                    # Serve with Rojo and update the project file on changes
rogen build -o game.rbxl       # Update the project file, then run rojo build
rogen write                    # Update the project files, as after a fresh clone
rogen check                    # Print warnings and errors, and exit 1 on any
rogen where src/Inventory/Server/InventoryService.luau
# src/Inventory/Server/InventoryService.luau -> ServerScriptService/Inventory/InventoryService · route Server (folder)
```

`rogen sourcemap`, `upload`, `syncback`, `plugin` and `fmt-project` take Rojo's flags too. See the [CLI](https://rogen-playfully.vercel.app/docs/v2/cli) for every command.

### Features

- **Rojo's project file** - You edit `default.rogen.json`, a Rojo project file with a `rogen` block. Rogen generates `default.project.json` from it, and updates it when you add, move or rename files.
- **Folder names decide the service** - A file under a `Server` folder goes to ServerScriptService, under `Client` to StarterPlayerScripts, and under `Shared` to ReplicatedStorage. You set the names in `default.rogen.json`.
- **More project files** - `dist.rogen.json` generates `dist.project.json`. Use one for Darklua's output, a release without the specs, or each place of a game. Name it to use it: `rogen serve dist`.
- **Luau, roblox-ts and Darklua** - `rogen init` detects them and writes them into the config.
- **Agents** - Every command takes `--json`. `rogen init` adds Rogen's rules to your `AGENTS.md`.

### FAQ

#### Do I still need Rojo?

Yes. Rogen uses Rojo to sync, build and upload. You run every command through Rogen: it updates the project file, then calls Rojo with the same flags.

#### Does Rogen work with Argon?

Yes. Run `rogen write --watch` to keep the project file up to date, and serve it with Argon. Argon doesn't read a project file with `syncRules`.

#### Can I use Rogen in an existing Rojo project?

Yes. Rogen's commands run on a plain `default.project.json` as it is. To move to feature folders, run `rogen init`. It moves your project file into `default.rogen.json`, and the project builds as it did. See [Coming from Rojo](https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo).

### Documentation

For setups and configuration, [head over to the docs](https://rogen-playfully.vercel.app/docs/v2).

### Contributing

If you want to contribute, read the [contributing guide](CONTRIBUTING.md) before you open a pull request.

### Support

Rogen is free and [MIT licensed](LICENSE.md). If it is useful to you or your studio, you can [sponsor its development](https://github.com/sponsors/LDGerrits).
