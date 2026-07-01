<div align="center">
	<h1>Rogen</h1>
	<p>A tool for feature-based folder structures with Rojo.</p>
	<img src="example.png" alt="Visual mapping of VS Code to Roblox Explorer" width="100%">
</div>

## What is Rogen?
Rogen is a command line tool that brings **feature-based architecture** to Roblox development for both luau and roblox-ts. 

Instead of separating your codebase in a `client`, `shared` and `server` folder at the root level, Rogen lets you group your code by domain and feature. You can keep your inventory UI, inventory server script, and inventory client script all inside a single `inventory` folder. This eliminates context-switching across different folders, making your codebase significantly easier to navigate, refactor, and scale.

In the background, Rogen watches your file system and dynamically generates your `default.project.json` map for Rojo. You get the freedom to group your code in any way you want, and Rogen takes care of sorting everything into the correct Roblox services like `ReplicatedStorage` and `ServerScriptService`. 

Moreover, Rogen allows you to merge multiple directories into a single Rojo project. This is useful for multi-place games where you want to share a core across different places.

**Note:** *If you use luau, it is highly recommended to set up [darklua](https://github.com/seaofvoices/darklua) for improved string requires.*

## Automatic Routing
Rogen determines where a file belongs by looking at your folder structure, marker files, and file names. 

When multiple rules apply to the same file, Rogen follows a simple principle: **the most specific instruction wins.** An explicit rule placed directly on a file will always override a general rule set by its parent folder.

Here are the routing strategies, listed from lowest to highest priority:

### 1. Folder Name
If a folder is named after a routing keyword (`server`, `client`, `shared`) or a Roblox service (e.g., `ReplicatedFirst`), all files within it inherit that destination.
* **Behavior:** Rogen consumes the routing keyword and strips it from the final generated path.
* **Example:** `src/combat/client/combatController.luau` becomes `StarterPlayerScripts/client/combat/combatController.luau`.

### 2. Marker File
To route a folder, you can also place an empty marker file (e.g., `.server`, `.client`, `.shared`) directly inside the directory.
* **Behavior:** The entire folder is routed to that service, but the folder's name is preserved in the Roblox tree.
* **Example:** A folder named `AntiCheat` containing a `.server` marker file will be routed to `ServerScriptService/server/AntiCheat`.

### 3. File Name
To route a specific file differently than its parent folder, use a routing prefix or suffix. File affixes are absolute and will always override folder names and marker files.
* **Delimited:** Use a separator (dot, hyphen, or underscore) before or after the base name.
	* **Examples:** input-client.ts, server.data.ts, 
* **CamelCase & PascalCase:** Prepend or append the mapped keyword directly to the filename.
	* **Examples:** inputClient.ts, serverData.ts

**Note:** *By default, Rogen strips the routing keyword from the final module name (e.g., `serverData.ts` and `data.server.ts` become `Data` and `data`, respectively). You can disable this behavior using the `--keepRouteNames` flag*.

### 4. Default Fallback
If no routing rules or keywords are found anywhere in the path, the file defaults to `ReplicatedStorage`.

**Important Note for `init` Files:** *If a folder contains an initialization file (like `init.luau` or `index.ts`), Rogen routes the folder itself but will not apply any further routing to its nested contents. This ensures full compatibility with how Rojo handles folders containing initialization scripts.*

## Merging of Multiple Sources
Rogen supports passing an array of directories to the source config (or passing the -s CLI flag multiple times). 

* **Clean Merging:** If, for example, `src/core` and `src/hub` both contain a shared folder, Rogen will merge the contents of both into a single `ReplicatedStorage/shared` folder. No duplicates are created.

* **Overrides:** The order of your sources matters. If both directories contain a file with the exact same name and routing path, the directory listed last will overwrite the previous one.

## Setup & Integration
Integrate Rogen into your workflow to ensure that your `default.project.json` stays synchronized with your file system.

### 1. Installation
Rogen is distributed as a standalone CLI tool. Install it into your project using your preferred toolchain manager:

**Rokit (`rokit.toml`)**
```toml
[tools]
rogen = "ldgerrits/rogen@1.3.1"
```

### 2. Configuration (.rogen.json)
Create a `.rogen.json` file using `rogen --init`.

Here is a default configuration structure that works for both roblox-ts and luau, including darklua support. You may want to define a custom tree in "template" for things like adding pesde packages, mapping node_modules, or customizing specific services. If you want to map specific suffixes or folder to a particular service, use the aliases field.

```json
{
	"source": ["src"],
	"keepRouteNames": false,
	"luau": { 
		"output": "default.project.json", 
		"build": "src"
	},
	"ts": { 
		"output": "default.project.json", 
		"build": "out"
	},
	"darklua": { 
		"output": "build.project.json", 
		"build": "dist" 
	},
	"aliases": {
		"Controller": "StarterPlayerScripts",
		"Service": "ServerScriptService"
	},
	"template": {
		"name": "roblox-project",
		"globIgnorePaths": [
			"**/package.json",
			"**/tsconfig.json"
		],
		"tree": {
			"$className": "DataModel",
			"ServerScriptService": {
				"ServerPackages": {
					"$path": "ServerPackages"
				}
			},
			"ReplicatedStorage": {
				"rbxts_include": {
					"$path": "include",
					"node_modules": { 
						"$className": "Folder", 
						"@rbxts": { 
							"$path": "node_modules/@rbxts" 
						}
					}
				},
				"Packages": {
					"$path": "Packages"
				}
			}
		}
	}
}
```

| Property            | Description                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source              | The root directory (String) or directories (Array of Strings) where your source code lives (defaults to "src"). Passing an array allows you to merge multiple source folders into a single tree.                                                                                                                                                                                    |
| luau / ts / darklua  | Mode-specific overrides. Rogen uses these to dictate where the compiled code ends up (build) and the name of the generated Rojo file (output)                                                                                                                       |
| <custom_mode>  | You can define your own custom pipeline modes (e.g., "lute") by adding a new key. Custom modes must include an output and a build value.                                                                                                                       |
| template            | The base Rojo tree template. Any standard Rojo `default.project.json` fields (like `name`, `globIgnorePaths`, or a custom `tree`) placed here will be safely merged with Rogen's auto-generated paths. You can also specify a path to a JSON file with a Rojo tree! |
| aliases             | An object allowing you to define custom suffix or folder routing mappings. You can use this to register new keywords (e.g., "Controller": "StarterPlayerScripts") or overwrite Rogen's default service routing behaviors.                                           |
| keepRouteNames        | A boolean flag (defaults to false). When set to true, Rogen will preserve your routing suffixes in the script names instead of stripping them out.                                                                                                                  |

### 3. CLI Usage
You can run Rogen with optional arguments to cleanly override your configurations on the fly:

- `-h, --help:` Show this help menu containing all available options.

- `-i, --init:` Generate a default .rogen.json config file.

- `-c, --config <path>`: Specify a custom Rogen config file path.

- `-m, --mode <mode>`: Specify the mode to run (luau, ts, darklua, or custom mode). If omitted, Rogen automatically detects your project configuration (via tsconfig.json or .darklua.json) and runs the appropriate target(s).

- `-s, --source <path>`: Override the directory containing your raw, uncompiled code. Can be passed multiple times (e.g., -s src/core -s src/hub) to merge multiple directories.

- `-t, --template <path>`: Specify a path to a JSON file that contains your base Rojo blueprint. If omitted, Rogen defaults to the inline object or file mapped in your .rogen.json.

- `-b, --build <path>`: Override the directory where your compiled/transpiled code lands.

- `-o, --output <path>`: Override the name and destination of the final generated Rojo .project.json file.

- `-k, --keepRouteNames`: Do not strip routing prefixes or suffixes (e.g., server, client) from names.

- `-w, --watch`: Watch the source directory for changes, automatically regenerating your project files.

As an example, it is possible to pass a specific configuration file, run a custom mode, inject a base template, and force a targeted output file all at the same time:
```bash
rogen -c build.rogen.json -m darklua -t base.template.json -o build.project.json
```

### 4. Commands

#### For luau
To make Rogen run and watch your files automatically, use the following command:
```bash
rogen -w
```

#### For roblox-ts
Because there is an extra step in the compilation process, it is recommended to install `concurrently` for concurrent execution. That way, you only need to use a single command to set everything up:
```bash
npm install -D concurrently
```
Then, update your package.json script:
```json
"scripts": {
	"watch": "concurrently \"rogen -w\" \"rbxtsc -w\""
},
```
And simply run the script:
```bash
npm run watch
```
