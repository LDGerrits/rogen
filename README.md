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
	<a href="https://rogen-playfully.vercel.app/docs/v2"><img alt="Documentation" src="https://img.shields.io/badge/docs-rogen-blueviolet?style=flat-square" /></a>
</p>

---

With Rogen, a feature's server, client and shared code live in one folder.

Rogen generates the Rojo project file. It takes the same commands and flags as Rojo.

> For a full overview, visit the [Rogen documentation](https://rogen-playfully.vercel.app/docs/v2).

### Installation

```bash
rokit add ldgerrits/rogen    # Rokit
npm i @ldgerrits/rogen       # npm, then run it as npx rogen
```

Rogen needs Rojo and its Studio plugin. After `rogen init`, run `rokit install` and `rogen plugin install`.

### Usage

```bash
rogen init                 # Start a project, or move a Rojo project to Rogen
rogen serve                # Serve with Rojo and update the project file on changes
rogen build -o game.rbxl   # Update the project file, then run rojo build
rogen write                # Update the project files, as after a fresh clone
rogen where src/Inventory  # Print where each file of a feature lands in the game
rogen check                # Print warnings and errors, and exit 1 on any
```

`rogen sourcemap`, `upload`, `syncback`, `plugin` and `fmt-project` take Rojo's flags too. See the [CLI](https://rogen-playfully.vercel.app/docs/v2/cli) for every command.

### Features

- **Rojo's project file** - `default.rogen.json` is a Rojo project file with a `rogen` block. Rogen generates `default.project.json` from it.
- **Folder names decide the service** - `Server` goes to ServerScriptService, `Client` to StarterPlayerScripts and `Shared` to ReplicatedStorage.
- **More project files** - `dist.rogen.json` generates `dist.project.json`, for Darklua, a release build or another place.
- **Luau, roblox-ts and Darklua** - `rogen init` detects them and sets them up.
- **Agents** - Every command takes `--json`, and `rogen init` adds Rogen's rules to your `AGENTS.md`.

### FAQ

#### Do I still need Rojo?

Yes. Rogen runs Rojo to sync, build and upload.

#### Does Rogen work with Argon?

Yes. Run `rogen write --watch` and serve with Argon.

#### Can I use Rogen in an existing Rojo project?

Yes. Run `rogen init` to move it to Rogen. See [Coming from Rojo](https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo).

### Contributing

If you want to contribute, read the [contributing guide](CONTRIBUTING.md) before you open a pull request.

### Support

Rogen is free and [MIT licensed](LICENSE.md). If it is useful to you or your studio, you can [sponsor its development](https://github.com/sponsors/LDGerrits).
