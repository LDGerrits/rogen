<div>&nbsp;</div>

<div align="center">
	<img src="https://raw.githubusercontent.com/LDGerrits/rogen/main/docs/public/icon.png" alt="Rogen" width="100" />
</div>

<div align="center">
    <a href="https://rogen-playfully.vercel.app"><strong>documentation</strong></a>
</div>

---

<div align="center">
    A CLI tool that enables feature-based architecture for Roblox
</div>

Rogen lets you organise Roblox code **by feature** instead of by environment. One feature folder holds its server, client and shared code, and Rogen writes the Rojo project file that places each script in the service where it runs. Rojo or Argon syncs it into Studio.

```
src/Inventory/Server/InventoryService.luau    ->  ServerScriptService/Inventory/InventoryService
src/Inventory/Client/InventoryController.luau ->  StarterPlayer/StarterPlayerScripts/Inventory/InventoryController
src/Inventory/InventoryTypes.luau             ->  ReplicatedStorage/Shared/Inventory/InventoryTypes
```

## Features

- **Feature folders:** A feature's server, client and shared code live in one folder, named after what it does in your game.
- **Routes:** Declare where each kind of code goes. A file can also pick its place with a folder, a marker file or an `@` suffix (`Save@server.luau`).
- **A Rojo superset:** `default.rogen.json` is a Rojo project file with a `rogen` block added, so Rojo's keys and docs still apply. A plain Rojo project runs under Rogen's commands as it is, and the commands take Rojo's names and flags. See [Coming from Rojo](https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo).
- **Several outputs and places:** `dist.rogen.json` writes `dist.project.json`, such as a Darklua build or a release without the specs. A repository with several places gives each place a folder and a `default.rogen.json` of its own.
- **Shared code:** List several source paths. The later one wins a clash, so shared code can be overridden.
- **Watch mode:** `rogen serve` writes again as files change, reloads when the config does, and starts Rojo.
- **Toolchains:** Luau, roblox-ts and Darklua. `rogen init` finds them and writes them into the config; Darklua's own `.darklua.json` stays yours.
- **Made for agents:** `--json` on every command, `rogen help --json`, and `rogen init` adds the rules to your `AGENTS.md`. See [Working with agents](https://rogen-playfully.vercel.app/docs/v2/agents).

## Getting started

```bash
rogen init
rogen serve
```

`rogen init` writes a starting config and prints the commands your setup needs. `rogen serve` writes the project file, starts Rojo and writes again on changes.

| Command                              | What it does                                                             |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `rogen write`                        | Writes the project file of every config, such as `default.project.json`. |
| `rogen build`, `sourcemap`, `upload` | Write the project file, then run Rojo's command of the same name.        |
| `rogen where <file>`                 | Prints where a file lands in the game, and why.                          |
| `rogen check`                        | Prints the diagnostics, and exits 1 when there are any.                  |

Read the [documentation](https://rogen-playfully.vercel.app) for routing, the other commands and every setup.

## Support

Rogen is free and MIT. If it is useful to you or your studio, you can [sponsor its development](https://github.com/sponsors/LDGerrits).

## Contributing

Pull requests are welcome!
Read the [contribution guidelines](CONTRIBUTING.md) to set up your local environment, run tests, and submit code changes.

## License

See the [licence](LICENSE.md) for details.
