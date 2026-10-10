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

- **Feature Folders:** Keep a feature's client, server and shared code in one folder.
- **Routes:** Declare where each kind of code goes, and route files with a folder, a marker file or an `@` suffix (`Save@server.luau`).
- **Variants:** Swap in files like `Analytics.mock.luau` at build time, without touching a `require`.
- **Modes:** Build `dev`, `qa` or `prod` from one config. A mode turns variants on and leaves specs out.
- **Several Places:** Merge root directories so places share core code and override parts of it.
- **Watch Mode:** Rebuild as files change, and reload when the config does. `rogen serve` also starts Rojo or Argon.
- **Toolchains:** Luau, roblox-ts and Darklua, set up by `rogen init`.

## Getting Started

```bash
rogen init
rogen serve
```

`rogen init` writes a starting config and prints the commands your setup needs. `rogen where <file>` prints where a file lands and why. Read the [documentation](https://rogen-playfully.vercel.app) for routing, variants and every setup.

## Support

Rogen is free and MIT. If it is useful to you or your studio, you can [sponsor its development](https://github.com/sponsors/LDGerrits).

## Contributing

Pull requests are welcome!
Read the [contribution guidelines](CONTRIBUTING.md) to set up your local environment, run tests, and submit code changes.

## License

See the [licence](LICENSE.md) for details.
