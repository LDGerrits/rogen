import fs from "fs";
import path from "path";
import { Environment, Config, Mode, RojoTree, ConfigKeys, RojoNode } from "./types.js";
import { defaultMode, defaultTemplate } from "./constants.js";

const CONFIG_KEYS_MAP: Record<ConfigKeys, true> = {
	source: true,
	fullNames: true,
	casing: true,
	aliases: true,
	exclude: true,
	luau: true,
	ts: true,
	darklua: true,
	template: true,
};

const KEYS = Object.keys(CONFIG_KEYS_MAP);

const LEGACY_KEYS: Record<string, ConfigKeys> = {
	"keepRouteNames": "fullNames",
	"keepSuffixes": "fullNames",
};

function getClosestMatch(input: string, targets: string[], distanceThreshold: number): string | null {
	let closest: string | null = null;
	let minDistance = Infinity;

	for (const target of targets) {
		const matrix = Array.from({ length: input.length + 1 }, () => Array(target.length + 1).fill(0));
		
		for (let i = 0; i <= input.length; i++) matrix[i][0] = i;
		for (let j = 0; j <= target.length; j++) matrix[0][j] = j;
		
		for (let i = 1; i <= input.length; i++) {
			for (let j = 1; j <= target.length; j++) {
				const cost = input[i - 1] === target[j - 1] ? 0 : 1;
				matrix[i][j] = Math.min(
					matrix[i - 1][j] + 1, // deletion
					matrix[i][j - 1] + 1, // insertion
					matrix[i - 1][j - 1] + cost // substitution
				);
			}
		}
		
		const distance = matrix[input.length][target.length];
		if (distance < minDistance) {
			minDistance = distance;
			closest = target;
		}
	}

	return minDistance <= distanceThreshold ? closest : null;
}

export function isMode(value: unknown): value is Mode {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>).output === "string" &&
		typeof (value as Record<string, unknown>).build === "string"
	);
}

export function resolveConfigPath(customPathArg?: string): string | null {
	const cwd = process.cwd();
	
	if (customPathArg) {
		const resolvedPath = path.resolve(cwd, customPathArg);
		if (!fs.existsSync(resolvedPath)) {
			throw new Error(`Specified config file not found: ${customPathArg}`);
		}
		return resolvedPath;
	}

	const defaultPath = path.resolve(cwd, ".rogen.json");
	if (fs.existsSync(defaultPath)) {
		return defaultPath;
	}

	try {
		const directoryFiles = fs.readdirSync(cwd);
		const matchedConfig = directoryFiles.find(file => file.endsWith(".rogen.json"));
		if (matchedConfig) {
			return path.resolve(cwd, matchedConfig);
		}
	} catch (error) {
		if (error instanceof Error) {
			console.error(`❌ Configuration Error: Failed to scan directory for .rogen.json - ${error.message}\n`);
		} else {
			console.error(`❌ Configuration Error: Failed to scan directory for .rogen.json - Unknown Error\n`);
		}
	}

	return null;
}

export function createFallbackConfig(cwd: string): Config {
	const isTs = fs.existsSync(path.join(cwd, "tsconfig.json"));
	const isWally = fs.existsSync(path.join(cwd, "wally.toml"));
	const isPesde = fs.existsSync(path.join(cwd, "pesde.toml"));

	const tree = defaultTemplate.tree;
	const template: RojoTree = {
		name: path.basename(cwd) || defaultTemplate.name,
		tree: tree
	};

	if (isTs) {
		template.globIgnorePaths = ["**/package.json", "**/tsconfig.json"];

		const hasRbxts = fs.existsSync(path.join(cwd, "node_modules", "@rbxts"));
		const hasFlamework = fs.existsSync(path.join(cwd, "node_modules", "@flamework"));
		const hasRbxtsJs = fs.existsSync(path.join(cwd, "node_modules", "@rbxts-js"));

		const rbxtsIncludeNode: RojoNode = { $path: "include" };

		if (hasRbxts || hasFlamework || hasRbxtsJs) {
			const nodeModulesNode: RojoNode = { $className: "Folder" };
			
			if (hasRbxts) nodeModulesNode["@rbxts"] = { $path: "node_modules/@rbxts" };
			if (hasFlamework) nodeModulesNode["@flamework"] = { $path: "node_modules/@flamework" };
			if (hasRbxtsJs) nodeModulesNode["@rbxts-js"] = { $path: "node_modules/@rbxts-js" };

			rbxtsIncludeNode.node_modules = nodeModulesNode;
		}

		tree.ReplicatedStorage = {
			...(tree.ReplicatedStorage || {}),
			rbxts_include: rbxtsIncludeNode
		};
	}

	if (isWally) {
		if (fs.existsSync(path.join(cwd, "Packages"))) {
			tree.ReplicatedStorage = {
				...(tree.ReplicatedStorage || {}),
				Packages: { $path: "Packages" }
			};
		}
		if (fs.existsSync(path.join(cwd, "ServerPackages"))) {
			tree.ServerScriptService = {
				...(tree.ServerScriptService || {}),
				ServerPackages: { $path: "ServerPackages" }
			};
		}
	}

	if (isPesde) {
		if (fs.existsSync(path.join(cwd, "roblox_packages"))) {
			tree.ReplicatedStorage = {
				...(tree.ReplicatedStorage || {}),
				Packages: { $path: "roblox_packages" }
			};
		}
		if (fs.existsSync(path.join(cwd, "roblox_server_packages"))) {
			tree.ServerScriptService = {
				...(tree.ServerScriptService || {}),
				ServerPackages: { $path: "roblox_server_packages" }
			};
		}
	}
	
	const config: Config = {
		source: ["src"],
		fullNames: false,
		casing: "camelCase",
		exclude: [],
		aliases: {},
		luau: { output: "default.project.json", build: "src", env: [], exclude: [] },
		ts: { output: "default.project.json", build: "out", env: [], exclude: [] },
		darklua: { output: "build.project.json", build: "dist", env: [], exclude: [] },
		template: template
	};

	return config;
}

export function loadAndValidateConfig(configPath: string | null): { config: Config; anchor: string } {
	const anchor = configPath ? path.dirname(configPath) : process.cwd();
	const config = createFallbackConfig(anchor);
	
	if (!configPath) {
		return { config, anchor };
	}
	
	const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Partial<Config>;

	for (const key in rawConfig) {
		if (!KEYS.includes(key as ConfigKeys)) {
			if (key in LEGACY_KEYS) {
				throw new Error(`Configuration Error: The key "${key}" has been renamed to "${LEGACY_KEYS[key]}". Please, update your configuration.`);
			}

			const value = rawConfig[key];
			const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
			const modeData = isObject ? (value as Record<string, unknown>) : null;

			// Default modes merging
			if (isObject && (key === "luau" || key === "ts" || key === "darklua")) {
				config[key] = { ...(config[key] as Mode), ...modeData } as Mode;
				config[key].env = Array.isArray(config[key].env) ? config[key].env : defaultMode.env;
				config[key].exclude = Array.isArray(config[key].exclude) ? config[key].exclude : defaultMode.exclude;
				continue;
			}

			// Custom modes merging
			const intendedAsMode = modeData && (
				"output" in modeData || 
				"build" in modeData || 
				"env" in modeData || 
				"exclude" in modeData
			);

			if (intendedAsMode) {
				if (typeof modeData.output !== "string") {
					throw new Error(`Configuration Error: Custom mode "${key}" is missing a valid "output" string.`);
				}
				if (typeof modeData.build !== "string") {
					throw new Error(`Configuration Error: Custom mode "${key}" is missing a valid "build" string.`);
				}

				config[key] = {
					output: modeData.output,
					build: modeData.build,
					env: Array.isArray(modeData.env) ? modeData.env : defaultMode.env,
					exclude: Array.isArray(modeData.exclude) ? modeData.exclude : defaultMode.exclude
				};
				continue;
			}
			
			const closestMatch = getClosestMatch(key, KEYS, 2);
			if (closestMatch) {
				throw new Error(`Configuration Error: Unknown key "${key}". Did you mean "${closestMatch}"?`);
			}

			throw new Error(`Configuration Error: Unknown configuration key "${key}".`);
		} else {
			// Validate keys
			if (key === "source" && typeof rawConfig[key] !== "string" && !Array.isArray(rawConfig[key])) {
				throw new Error(`Configuration Error: 'source' must be a string or an array of strings.`);
			} else if (key === "template" && typeof rawConfig[key] !== "object" && typeof rawConfig[key] !== "string") {
				throw new Error(`Configuration Error: 'template' must be an inline object or a string path to a JSON file.`);
			} else if (key === "fullNames" && typeof rawConfig[key] !== "boolean") {
				throw new Error(`Configuration Error: 'fullNames' must be a boolean.`);
			} else if (key === "casing" && rawConfig[key] !== "PascalCase" && rawConfig[key] !== "camelCase") {
				throw new Error(`Configuration Error: 'casing' must be either "PascalCase" or "camelCase".`);
			} else if (key === "exclude" && !Array.isArray(rawConfig[key])) {
				throw new Error(`Configuration Error: 'exclude' must be an array of strings.`);
			}
			config[key] = rawConfig[key];
		}
	}

	return { config, anchor };
}

export function loadProjectTree(anchor: string, cliProjectArg?: string, configProjectField?: unknown): RojoTree {
	let targetPath: string | null = null;
	if (cliProjectArg) {
		targetPath = path.resolve(process.cwd(), cliProjectArg);
	} else if (typeof configProjectField === "string") {
		targetPath = path.resolve(anchor, configProjectField);
	}

	if (targetPath) {
		if (!fs.existsSync(targetPath)) {
			throw new Error(`Specified template file not found: ${targetPath}`);
		}
		return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
	}

	if (typeof configProjectField === "object" && configProjectField !== null) {
		return configProjectField as RojoTree;
	}
	
	return createFallbackConfig(anchor).template as RojoTree;
}

export function getEnvironment(anchor: string, cliMode?: string): Environment {
	if (cliMode) {
		return {
			isTsProject: cliMode === "ts",
			isDarkluaProject: cliMode === "darklua"
		};
	}
	const isTsProject = fs.existsSync(path.join(anchor, "tsconfig.json"));
	const isDarkluaProject = fs.existsSync(path.join(anchor, ".darklua.json")) || 
		fs.existsSync(path.join(anchor, ".darklua.json5"));
	return { isTsProject, isDarkluaProject };
}

export function resolveActiveModes(config: Config, cliMode: string | undefined, env: Environment): Mode[] {
	const activeModes: Mode[] = [];

	if (cliMode) {
		const requestedMode = config[cliMode];
		if (!isMode(requestedMode)) {
			throw new Error(`Mode "${cliMode}" is not defined or is invalid in your config file.`);
		}
		activeModes.push(requestedMode);
	} else {
		for (const key in config) {
			const potentialMode = config[key];

			if (isMode(potentialMode)) {
				if (key === "luau" && env.isTsProject) continue;
				if (key === "ts" && !env.isTsProject) continue;
				if (key === "darklua" && !env.isDarkluaProject) continue;
				
				activeModes.push(potentialMode);
			}
		}
		if (activeModes.length === 0) {
			throw new Error("No output modes defined in configuration file. Add 'luau', 'ts', or custom modes.");
		}
	}

	return activeModes;
}
