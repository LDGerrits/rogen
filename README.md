<div align="center">
	<h1>Rogen</h1>
    <p>A tool for feature-based folder structures with Rojo.</p>
    <img src="example.png" alt="Visual mapping of VS Code to Roblox Explorer" width="100%">
</div>

## What is Rogen?
Rogen is a command line tool that brings **feature-based architecture** to Roblox development for both luau and roblox-ts. 

Instead of separating your codebase in a `client`, `shared` and `server` folder at the root level, Rogen lets you group your code by domain and feature. You can keep your inventory UI, inventory server script, and inventory client script all inside a single, unified `inventory` folder. This approach improves scalability, maintainability, and team collaboration.

In the background, Rogen watches your file system and dynamically generates your `default.project.json` map for Rojo, ensuring your repository stays organized by feature while Roblox receives the exact service structure it expects. 

## Automatic Routing
Rogen determines a file's destination using three main strategies. Folder-based routing takes precedence over suffix-based routing.

### 1. Folder Context (Primary)
If a file is located within a folder named after a service or a keyword, it is automatically routed to that service.
* **Keywords:** `server`, `client`, `shared`
* **Services:** `ReplicatedFirst`, `ServerStorage`, `StarterGui`, etc.
* **Behavior:** All files and sub-folders within these directories inherit the target service.

### 2. Suffix Context (Secondary)
If a file is in a generic folder, Rogen inspects the filename for a suffix. This allows you to define a file's destination without moving it into a specific sub-folder.
* **Delimited Suffixes:** Use a separator such as a dot, hyphen, or underscore.
    - Examples: `auth.server.ts`, `input-client.ts`, `data_shared.ts`

* **PascalCase Suffixes:** Append the service name directly to the end of the filename.
    - Examples: `AuthServer.ts`, `InputClient.ts`, `DataShared.ts`

    **Note:** Rogen strips the suffix for the final Rojo object name. `AuthServer.ts` becomes `Auth` in Roblox.

### 3. Default
If neither matches, the file defaults to `ReplicatedStorage`.

## Setup & Integration
Integrate Rogen into your workflow to ensure that your `default.project.json` stays synchronized with your file system.

### 1. Install Dependencies
You will need a few development tools to handle the watching and concurrent execution for the commands:
```bash
npm install -D chokidar-cli concurrently
```
Also, save the `rogen.js` script into your project as `tools/rogen.js`.

### 2. Configuration (.rogen.json)
Create a `.rogen.json` file in the root of your project. Rogen will automatically detect it and use that as the configuration.

Here is a default configuration structure that works for both roblox-ts and luau, including darklua support. You may want to define a custom tree in "project" for things like adding pesde packages, mapping node_modules, or customizing specific services.

```json
{
	"source": "src",
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
	"project": {
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

| Property            | Description                                                                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| source           | The root directory where your uncompiled source code lives (usually "src").                                                                                                                                  |                     |
| luau / ts / darklua | Mode-specific overrides. Rogen uses these to dictate where the compiled code ends up (build) and the name of the generated Rojo file (output) |
| template             | The base Rojo tree template. Any standard Rojo `default.project.json` fields (like `name`, `globIgnorePaths`, or a custom `tree`) placed here will be safely merged with Rogen's auto-generated paths. You can also specify a path to a JSON file with a Rojo tree!              |

### 3. CLI Usage
You can run Rogen with optional arguments to cleanly override your configurations on the fly:

- `-c, --config <path>`: Specify a custom Rogen config file path.

- `-m, --mode <mode>`: Specify the mode to run (luau, ts, or darklua). If omitted, Rogen automatically detects your project configuration (via tsconfig.json or .darklua.json) and runs the appropriate target(s).

- `-s, --source <path>`: Override the directory containing your raw, uncompiled code.

- `-t, --template <path>`: Specify a path to a JSON file that contains your base Rojo blueprint. If omitted, Rogen defaults to the inline object or file mapped in your .rogen.json.

- `-b, --build <path>`: Override the directory where your compiled/transpiled code lands.

-  `-o, --output <path>`: Override the name and destination of the final generated Rojo .project.json file.

As an example, it is possible to pass a specific configuration file, run a custom mode, inject a base template, and force a targeted output file directly from your terminal:
```bash
node tools/rogen.js -c build.rogen.json -m darklua -t base.template.json -o build.project.json
```
Or, if you added the script execution commands to your package.json, you can pass the arguments through npm like this:
```bash
npm run rogen -- -c build.rogen.json -m darklua -t base.template.json -o build.project.json
```

### 4. Update Package Script
Add the following scripts to your `package.json` to automate rogen:

#### For luau
```json
"scripts": {
    "rogen": "node tools/rogen.js",
    "build": "npm run rogen",
    "watch": "chokidar \"src/**/*\" -c \"npm run rogen\"",
    "sourcemap": "rojo sourcemap --watch default.project.json --output sourcemap.json",
    "dev": "npm run build && concurrently \"npm run watch\" \"rojo serve\" \"npm run sourcemap\""
},
```

#### For roblox-ts
```json
"scripts": {
    "rogen": "node tools/rogen.js",
    "build": "npm run rogen && rbxtsc",
    "watch": "concurrently \"chokidar \"src/**/*\" -c \\\"npm run rogen\\\"\" \"rbxtsc -w\"",
    "dev": "npm run build && concurrently \"chokidar \"src/**/*\" -c \\\"npm run rogen\\\"\" \"rbxtsc -w\" \"rojo serve\""
},
```

**Note:** Make sure to also add the following to your tsconfig.json:
```json
"exclude": [
	"tools"
]
```

### 5. Commands
* **npm run build:** Generates the latest project map (and performs a single roblox-ts compilation).  
* **npm run watch:** Monitors your src directory. If you add or move a folder, the mapper instantly updates your Rojo project (and code compilation).  
* **npm run dev:** The dev command. It builds, compiles, starts all watchers, and launches the Rojo server all in one go.
