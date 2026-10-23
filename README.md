<div align="center">
	<img src="https://raw.githubusercontent.com/LDGerrits/rogen/main/docs/public/icon.png" alt="Rogen" width="100" />
	<p>Rogen is a superset of Rojo that generates Rojo project files.</p>
	<p>
		<a href="https://rogen-playfully.vercel.app/docs/v2">Documentation</a> |
		<a href="https://rogen-playfully.vercel.app/docs/v2/installation">Installation</a> |
		<a href="https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo">Coming from Rojo</a> |
		<a href="https://rogen-playfully.vercel.app/docs/v2/cli">CLI</a>
	</p>
</div>

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
rogen init                   # Start a project, or move a Rojo project to Rogen
rogen serve                  # Serve with Rojo and rewrite the project file on changes
rogen build -o game.rbxl     # Write the project file, then run rojo build
rogen write                  # Write the project files, as after a fresh clone
rogen where src/Greeter      # Print where each file lands in the game
rogen check                  # Print warnings and errors, and exit 1 on any
```

`rogen sourcemap`, `upload`, `syncback`, `plugin` and `fmt-project` take Rojo's flags too. See the [CLI](https://rogen-playfully.vercel.app/docs/v2/cli) for every command.

### Features

- **Rojo's project file** - You edit `default.rogen.json`, a Rojo project file with a `rogen` block. Rogen writes `default.project.json` from it and replaces it on every write.
- **Folder names decide the service** - A file under a `Server` folder goes to ServerScriptService, under `Client` to StarterPlayerScripts, and under `Shared` to ReplicatedStorage. You set the names in `default.rogen.json`.
- **More project files** - `dist.rogen.json` writes `dist.project.json`. Use one for Darklua's output, a release without the specs, or each place of a game. Name it to use it: `rogen serve dist`.
- **Luau, roblox-ts and Darklua** - `rogen init` finds them and writes them into the config.
- **Agents** - Every command takes `--json`. `rogen init` adds Rogen's rules to your `AGENTS.md`.

### FAQ

#### Does Rogen replace Rojo?

No. Rogen writes the project file, and Rojo syncs it into Studio. `rogen serve` starts Rojo.

#### Can I use Rogen in an existing Rojo project?

Yes. Rogen's commands run on a plain `default.project.json` as it is. To move to feature folders, run `rogen init`. It moves your project file into `default.rogen.json`, and the project builds as it did. See [Coming from Rojo](https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo).

### Documentation

For setups, configuration and every diagnostic, [head over to the docs](https://rogen-playfully.vercel.app/docs/v2).

### Contributing

If you want to contribute, read the [contributing guide](CONTRIBUTING.md) before you open a pull request.

### Support

Rogen is free and [MIT licensed](LICENSE.md). If it is useful to you or your studio, you can [sponsor its development](https://github.com/sponsors/LDGerrits).
