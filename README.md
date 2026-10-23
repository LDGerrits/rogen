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
	<a href="https://discord.com/channels/385151591524597761/1503801029232295996"><img alt="Discord" src="https://img.shields.io/badge/discord-chat-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
	<a href="https://rogen-playfully.vercel.app/docs/v2"><img alt="Documentation" src="https://img.shields.io/badge/docs-rogen-blueviolet?style=flat-square" /></a>
</p>

---

With Rogen, a feature's server, client and shared code live in one folder.

Rogen generates the Rojo project file. You run Rojo's commands through it, with the same flags.

## Installation

```bash
rokit add ldgerrits/rogen
rogen init
rokit install
rogen plugin install
```

`rogen init` pins Rojo in `rokit.toml`, and `rokit install` fetches it. Prefer npm? Run `npm i @ldgerrits/rogen` and use `npx rogen`.

## Usage

```bash
rogen serve    # Serve with Rojo and update the project file on changes
rogen build    # Update the project file, then run rojo build
rogen check    # Print warnings and errors, and exit 1 on any
```

`sourcemap`, `upload`, `syncback` and `plugin` take Rojo's flags too. See the [documentation](https://rogen-playfully.vercel.app/docs/v2) for every command.

## Contributing

Read the [contributing guide](CONTRIBUTING.md) before you open a pull request.

## License

Rogen is [MIT licensed](LICENSE.md). You can [sponsor its development](https://github.com/sponsors/LDGerrits).
