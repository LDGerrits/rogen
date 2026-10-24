<p align="center">
	<a href="https://rogen-playfully.vercel.app">
		<img src="https://raw.githubusercontent.com/LDGerrits/rogen/main/docs/public/icon.png" alt="Rogen logo" width="100" />
	</a>
</p>
<h1 align="center">Rogen</h1>
<p align="center">Rogen is a superset of Rojo that generates Rojo project files.</p>
<p align="center">
	<a href="https://www.npmjs.com/package/@ldgerrits/rogen"><img alt="npm" src="https://img.shields.io/npm/v/@ldgerrits/rogen?style=flat-square" /></a>
	<a href="https://github.com/LDGerrits/rogen/actions/workflows/test.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/LDGerrits/rogen/test.yml?style=flat-square&label=build" /></a>
	<a href="LICENSE.md"><img alt="License" src="https://img.shields.io/github/license/LDGerrits/rogen?style=flat-square" /></a>
	<a href="https://github.com/LDGerrits/rogen/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LDGerrits/rogen?style=flat-square&logo=github" /></a>
	<br />
	<a href="https://luau.org"><img alt="Luau" src="https://img.shields.io/badge/Luau-00A2FF?style=flat-square&logo=luau&logoColor=white" /></a>
	<a href="https://roblox-ts.com"><img alt="roblox-ts" src="https://img.shields.io/badge/roblox--ts-3178C6?style=flat-square&logo=typescript&logoColor=white" /></a>
	<a href="https://rogen-playfully.vercel.app/docs/v2"><img alt="Documentation" src="https://img.shields.io/badge/docs-rogen-blueviolet?style=flat-square" /></a>
	<a href="https://discord.com/channels/385151591524597761/1503801029232295996"><img alt="Discord" src="https://img.shields.io/badge/discord-chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
</p>

---

With Rogen, each feature's server, client and shared code lives in one folder. Your codebase stays easy to understand as your game grows. Everything you do with Rojo still works, from live sync to building places.

## Why Rogen?

- **Organize by feature** — The inventory's code sits in `src/Inventory`, from server to client. You and your coding agents find the whole feature in one place.
- **Multi-place games** — Write shared code once and use it in every place. A place can still replace any file with its own.
- **Still Rojo** — Rogen runs the Rojo commands you use, with the same flags. One tool, nothing to relearn.

## Example

`default.rogen.json` has the same fields as a Rojo project file, plus a `rogen` block:

```json
{
	"name": "Game",
	"tree": { "$className": "DataModel" },
	"rogen": {
		"routes": {
			"Server": "ServerScriptService",
			"Client": "StarterPlayer/StarterPlayerScripts",
			"Shared": "ReplicatedStorage/Shared"
		}
	}
}
```

A folder or an `@` suffix named after a route sends its code there:

| File                                            | In the game                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `src/Inventory/Server/InventoryService.luau`    | `ServerScriptService/Inventory/InventoryService`                   |
| `src/Inventory/Client/InventoryController.luau` | `StarterPlayer/StarterPlayerScripts/Inventory/InventoryController` |
| `src/Inventory/Shared/InventoryTypes.luau`      | `ReplicatedStorage/Shared/Inventory/InventoryTypes`                |
| `src/Inventory/Save@Server.luau`                | `ServerScriptService/Inventory/Save`                               |

The routes are yours to change. Add `"Gui": "StarterGui"`, and a `Gui` folder or a `@Gui` suffix sends code to StarterGui.

## Installation

```bash
rokit add ldgerrits/rogen
rogen init
rokit install
```

`rogen init` pins Rojo in `rokit.toml`, and `rokit install` fetches it. New to Rojo? Also run `rogen plugin install` to add its Studio plugin. Prefer npm? Run `npm i @ldgerrits/rogen` and use `npx rogen`.

## Usage

```bash
rogen serve                # Serve with Rojo and update the project file on changes
rogen build -o game.rbxl   # Update the project file, then build a place with Rojo
rogen check                # Print warnings and errors, and exit 1 on any
```

`sourcemap`, `upload`, `syncback` and `plugin` take Rojo's flags too. See the [documentation](https://rogen-playfully.vercel.app/docs/v2) for every command.

## FAQ

#### Do I still need Rojo?

Yes. You run everything through Rogen, and Rogen uses Rojo to do it.

#### Does Rogen work with Argon?

Yes. Run `rogen write --watch` and serve with Argon.

#### Does Rogen work with several places?

Yes, and each place can replace any shared file with its own. A place's config lists the shared folder and then its own. The arena can have its own `Damage.luau`, while every other place uses the shared one. See [Several Places](https://rogen-playfully.vercel.app/docs/v2/setups/places).

#### Can I use Rogen in an existing Rojo project?

Yes. Run `rogen init` to move it to Rogen. See [Coming from Rojo](https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo).

## Contributing

Read the [contributing guide](CONTRIBUTING.md) before you open a pull request. You can also star the repo or [sponsor its development](https://github.com/sponsors/LDGerrits).

## License

Rogen is [MIT licensed](LICENSE.md).
