import fs from "fs";
import path from "path";
import { defaultConfig } from "./constants.js";
import { Environment, Config, Mode, RojoTree, ConfigKeys } from "./types.js";

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

const LEGACY_KEYS: Record<string, string> = {
	"keepRouteNames": "fullNames"
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

export function loadAndValidateConfig(configPath: string | null): { config: Config; hasConfig: boolean; anchor: string } {
	const anchor = configPath ? path.dirname(configPath) : process.cwd();
	
	if (!configPath) {
		return { config: JSON.parse(JSON.stringify(defaultConfig)), hasConfig: false, anchor };
	}

	const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Config;

	for (const key in config) {
		if (!KEYS.includes(key)) {
			if (key in LEGACY_KEYS) {
				throw new Error(`Configuration Error: The key "${key}" has been renamed to "${LEGACY_KEYS[key]}". Please update your configuration.`);
			}

			const value = config[key];
			const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
			const modeData = isObject ? (value as Record<string, unknown>) : null;
			const looksLikeMode = modeData && typeof modeData.output === "string" && typeof modeData.build === "string";

			if (looksLikeMode) continue;

			const closestMatch = getClosestMatch(key, KEYS, 2);
			if (closestMatch) {
				throw new Error(`Configuration Error: Unknown key "${key}". Did you mean "${closestMatch}"?`);
			}

			if (isObject) {
				if (!modeData!.output || typeof modeData!.output !== "string") {
					throw new Error(`Configuration Error: Custom mode "${key}" is missing a valid "output" string.`);
				}
				if (!modeData!.build || typeof modeData!.build !== "string") {
					throw new Error(`Configuration Error: Custom mode "${key}" is missing a valid "build" string.`);
				}
			} else {
				throw new Error(`Configuration Error: Unknown configuration key "${key}".`);
			}
		} else if (key === "source" && typeof config[key] !== "string" && !Array.isArray(config[key])) {
			throw new Error(`Configuration Error: 'source' must be a string or an array of strings.`);
		} else if (key === "template" && typeof config[key] !== "object" && typeof config[key] !== "string") {
			throw new Error(`Configuration Error: 'template' must be an inline object or a string path to a JSON file.`);
		} else if (key === "fullNames" && typeof config[key] !== "boolean") {
			throw new Error(`Configuration Error: 'fullNames' must be a boolean.`);
		} else if (key === "casing" && config[key] !== "PascalCase" && config[key] !== "camelCase") {
			throw new Error(`Configuration Error: 'casing' must be either "PascalCase" or "camelCase".`);
		} else if (key === "exclude" && !Array.isArray(config[key])) {
			throw new Error(`Configuration Error: 'exclude' must be an array of strings.`);
		}
	}

	return { config, hasConfig: true, anchor };
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
	
	return JSON.parse(JSON.stringify(defaultConfig.template));
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

export function resolveActiveModes(config: Config, hasConfig: boolean, cliMode: string | undefined, env: Environment): Mode[] {
	const baseLanguage = env.isTsProject ? (config.ts || defaultConfig.ts!) : (config.luau || defaultConfig.luau!);
	const nonModeKeys = new Set(["source", "template", "aliases", "fullNames", "casing"]);
	const activeModes: Mode[] = [];

	if (hasConfig) {
		if (cliMode) {
			if (nonModeKeys.has(cliMode) || !config[cliMode]) {
				throw new Error(`Mode "${cliMode}" is not defined in your config file.`);
			}
			activeModes.push(config[cliMode] as Mode);
		} else {
			for (const key in config) {
				if (!nonModeKeys.has(key) && typeof config[key] === "object" && !Array.isArray(config[key])) {
					if (key === "luau" && env.isTsProject) continue;
					if (key === "ts" && !env.isTsProject) continue;
					if (key === "darklua" && !env.isDarkluaProject) continue;
					activeModes.push(config[key] as Mode);
				}
			}
			if (activeModes.length === 0) {
				throw new Error("No output modes defined in configuration file. Add 'luau', 'ts', or custom modes.");
			}
		}
	} else {
		if (cliMode) {
			const fallbackMode = (defaultConfig as Record<string, Mode>)[cliMode];
			if (!fallbackMode) {
				throw new Error(`Mode "${cliMode}" is not defined in the fallback config.`);
			}
			activeModes.push({ ...baseLanguage, ...fallbackMode });
		} else {
			activeModes.push(baseLanguage);
			if (env.isDarkluaProject) {
				activeModes.push({ ...baseLanguage, ...(config.darklua || defaultConfig.darklua) });
			}
		}
	}

	return activeModes;
}
