<p align="center">
	<a href="https://rogen-playfully.vercel.app">
		<picture>
			<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/LDGerrits/rogen/main/docs/public/icon.png" />
			<img src="https://raw.githubusercontent.com/LDGerrits/rogen/main/docs/public/icon-dark.png" alt="Rogen logo" width="100" />
		</picture>
	</a>
</p>
<h1 align="center">Rogen</h1>
<p align="center"><strong>Organize your Roblox game by feature.</strong></p>
<p align="center">
	Rogen is a superset of Rojo that generates Rojo project files.
	With file-system routing, the name of a folder or file decides where its code goes.
</p>
<p align="center">
	<a href="https://www.npmjs.com/package/@ldgerrits/rogen"><img alt="Latest release" src="https://img.shields.io/npm/v/@ldgerrits/rogen?style=flat-square&label=latest%20release" /></a>
	<a href="https://rogen-playfully.vercel.app/docs/v2"><img alt="Documentation" src="https://img.shields.io/badge/docs-website-blueviolet?style=flat-square" /></a>
	<a href="https://discord.com/channels/385151591524597761/1503801029232295996"><img alt="Discord" src="https://img.shields.io/badge/discord-chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
	<a href="https://github.com/LDGerrits/rogen/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/LDGerrits/rogen?style=flat-square&logo=github" /></a>
	<a href="https://luau.org"><img alt="Luau" src="https://img.shields.io/badge/Luau-00A2FF?style=flat-square&logo=luau&logoColor=white" /></a>
	<a href="https://roblox-ts.com"><img alt="roblox-ts" src="https://img.shields.io/badge/roblox--ts-3178C6?style=flat-square&logo=typescript&logoColor=white" /></a>
</p>

## Why Rogen?

- **Organize by feature** — The inventory's code sits in `src/Inventory`, from server to client. You and your coding agents find the whole feature in one place.
- **Multi-place games** — Write shared code once and use it in every place. A place can still replace any file with its own.
- **Still Rojo** — Rogen runs the Rojo commands you use, with the same flags. One tool, nothing to relearn.
- **No project file to edit** — In plain Rojo, each feature needs a node in every service its code reaches. Rogen writes them from your folders, and `rogen serve` keeps them current.
- **From file to instance and back** — `rogen where` shows where a file lands and how to `require` it, even before you create it. Paste a Studio error line into `rogen where`, and it prints the file to open.
- **Mistakes caught before you playtest** — Rogen warns when a misspelled `Sever` folder leaves its files out of the game, or a `Server` folder inside `Shared` would ship its code to every client.
- **Rules for coding agents** — `rogen init` adds Rogen's rules to `AGENTS.md`, and Rogen keeps them current. [In our tests](https://rogen-playfully.vercel.app/docs/v2/agents#what-we-measured), agents left the project file stale in 12 of 20 runs without them, and in none with them.

## Example

`default.rogen.json` has the same fields as a Rojo project file, plus a `rogen` block:

<!-- prettier-ignore -->
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

| In `src/Inventory`                | Goes to                                        |
| --------------------------------- | ---------------------------------------------- |
| `Server/InventoryService.luau`    | `ServerScriptService/Inventory`                |
| `Client/InventoryController.luau` | `StarterPlayer/StarterPlayerScripts/Inventory` |
| `Shared/InventoryTypes.luau`      | `ReplicatedStorage/Shared/Inventory`           |
| `Save@Server.luau`                | `ServerScriptService/Inventory`                |

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

#### Can I use Rogen in an existing Rojo project?

Yes. Run `rogen init` to move it to Rogen. See [Coming from Rojo](https://rogen-playfully.vercel.app/docs/v2/coming-from-rojo).

#### Do my requires change?

Only for files you move. Moving a file into a feature folder changes its path in the game, and Rogen doesn't check requires. Run `rogen where` on a moved file to see the `require` that reaches it now.

#### Does my team need Rogen?

Yes, by default. `rogen init` keeps the project file out of git, so a fresh clone needs `rogen write` before Rojo can read it. If you commit the file (remove `*.project.json` from `.gitignore`), a teammate without Rogen can serve and build with Rojo. They need Rogen only to add a feature folder or an `@` file.

#### Can I go back to Rojo?

Yes. The project file Rogen writes is a complete Rojo project. Remove `*.project.json` from `.gitignore` and commit the file. Rojo then serves it as it is. From then on, a new feature folder needs a node you write yourself.

## Contributing

Read the [contributing guide](CONTRIBUTING.md) before you open a pull request. You can also star the repo or [sponsor its development](https://github.com/sponsors/LDGerrits).

## License

Rogen is [MIT licensed](LICENSE.md).
