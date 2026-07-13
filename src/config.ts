import fs from "fs";
import path from "path";
import { defaultConfig } from "./constants.js";
import { Environment, RogenConfig, RogenMode, RojoTree } from "./types.js";

const FIELDS = ["source", "template", "luau", "ts", "darklua", "aliases", "fullNames", "casing"];

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

export function loadAndValidateConfig(configPath: string | null): { config: RogenConfig; hasConfig: boolean; anchor: string } {
	const anchor = configPath ? path.dirname(configPath) : process.cwd();
	
	if (!configPath) {
		return { config: JSON.parse(JSON.stringify(defaultConfig)), hasConfig: false, anchor };
	}

	const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as RogenConfig;

	for (const key in config) {
		if (!FIELDS.includes(key)) {
			const customMode = config[key];
			if (typeof customMode !== "object" || customMode === null || Array.isArray(customMode)) {
				throw new Error(`Configuration Error: Key "${key}" must be a valid object defining a mode.`);
			}

			const modeData = customMode as Record<string, unknown>;
			if (!modeData.output || typeof modeData.output !== "string") {
				throw new Error(`Configuration Error: Custom mode "${key}" is missing a valid "output" string.`);
			}
			if (!modeData.build || typeof modeData.build !== "string") {
				throw new Error(`Configuration Error: Custom mode "${key}" is missing a valid "build" string.`);
			}
		} else if (key === "source" && typeof config[key] !== "string" && !Array.isArray(config[key])) {
			throw new Error(`Configuration Error: 'source' must be a string or an array of strings.`);
		} else if (key === "template" && typeof config[key] !== "object" && typeof config[key] !== "string") {
			throw new Error(`Configuration Error: 'template' must be an inline object or a string path to a JSON file.`);
		} else if (key === "fullNames" && typeof config[key] !== "boolean") {
			throw new Error(`Configuration Error: 'fullNames' must be a boolean.`);
		} else if (key === "casing" && config[key] !== "PascalCase" && config[key] !== "camelCase") {
			throw new Error(`Configuration Error: 'casing' must be either "PascalCase" or "camelCase".`);
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

export function resolveActiveModes(config: RogenConfig, hasConfig: boolean, cliMode: string | undefined, env: Environment): RogenMode[] {
	const baseLanguage = env.isTsProject ? (config.ts || defaultConfig.ts!) : (config.luau || defaultConfig.luau!);
	const nonModeKeys = new Set(["source", "template", "aliases", "fullNames", "casing"]);
	const activeModes: RogenMode[] = [];

	if (hasConfig) {
		if (cliMode) {
			if (nonModeKeys.has(cliMode) || !config[cliMode]) {
				throw new Error(`Mode "${cliMode}" is not defined in your config file.`);
			}
			activeModes.push(config[cliMode] as RogenMode);
		} else {
			for (const key in config) {
				if (!nonModeKeys.has(key) && typeof config[key] === "object" && !Array.isArray(config[key])) {
					if (key === "luau" && env.isTsProject) continue;
					if (key === "ts" && !env.isTsProject) continue;
					if (key === "darklua" && !env.isDarkluaProject) continue;
					activeModes.push(config[key] as RogenMode);
				}
			}
			if (activeModes.length === 0) {
				throw new Error("No output modes defined in configuration file. Add 'luau', 'ts', or custom modes.");
			}
		}
	} else {
		if (cliMode) {
			const fallbackMode = (defaultConfig as Record<string, RogenMode>)[cliMode];
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
