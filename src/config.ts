import fs from "fs";
import path from "path";
import { defaultConfig } from "./constants.js";
import { Environment, RogenConfig, RogenMode, RojoTree } from "./types.js";

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
			console.error(`\nFailed to scan directory for config file: ${error.message}\n`);
		} else {
			console.error(`\nFailed to scan directory for config file: Unknown Error\n`);
		}
	}

	return null;
}

export function loadAndValidateConfig(configPath: string | null): { config: RogenConfig; hasConfig: boolean } {
	if (!configPath) {
		return { config: JSON.parse(JSON.stringify(defaultConfig)), hasConfig: false };
	}

	const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as RogenConfig;
	const standardKeys = ["source", "template", "luau", "ts", "darklua", "aliases", "keepRouteNames"];

	for (const key in config) {
		if (!standardKeys.includes(key)) {
			const customMode = config[key];
			if (typeof customMode !== "object" || customMode === null || Array.isArray(customMode)) {
				throw new Error(`\nConfiguration Error: Key "${key}" must be a valid object defining a mode.\n`);
			}

			const modeData = customMode as Record<string, unknown>;
			if (!modeData.output || typeof modeData.output !== "string") {
				throw new Error(`\nConfiguration Error: Custom mode "${key}" is missing a valid "output" string.\n`);
			}
			if (!modeData.build || typeof modeData.build !== "string") {
				throw new Error(`\nConfiguration Error: Custom mode "${key}" is missing a valid "build" string.\n`);
			}
		} else if (key === "source" && typeof config[key] !== "string" && !Array.isArray(config[key])) {
			throw new Error(`\nConfiguration Error: 'source' must be a string or an array of strings.\n`);
		} else if (key === "template" && typeof config[key] !== "object" && typeof config[key] !== "string") {
			throw new Error(`\nConfiguration Error: 'template' must be an inline object or a string path to a JSON file.\n`);
		} else if (key === "keepRouteNames" && typeof config[key] !== "boolean") {
			throw new Error(`\nConfiguration Error: 'keepRouteNames' must be a boolean.\n`);
		}
	}

	return { config, hasConfig: true };
}

export function loadProjectTree(cliProjectArg?: string, configProjectField?: unknown): RojoTree {
	let targetPath: string | null = null;
	
	if (cliProjectArg) {
		targetPath = path.resolve(process.cwd(), cliProjectArg);
	} else if (typeof configProjectField === "string") {
		targetPath = path.resolve(process.cwd(), configProjectField);
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

export function getEnvironment(): Environment {
	const cwd = process.cwd();
	const isTsProject = fs.existsSync(path.join(cwd, "tsconfig.json"));
	const isDarkluaProject = fs.existsSync(path.join(cwd, ".darklua.json")) || fs.existsSync(path.join(cwd, ".darklua.json5"));
	return { isTsProject, isDarkluaProject };
}

export function resolveActiveModes(config: RogenConfig, hasConfig: boolean, cliMode: string | undefined, env: Environment): RogenMode[] {
	const baseLanguage = env.isTsProject ? (config.ts || defaultConfig.ts!) : (config.luau || defaultConfig.luau!);
	const nonModeKeys = new Set(["source", "template", "aliases", "keepRouteNames"]);
	const activeModes: RogenMode[] = [];

	if (hasConfig) {
		if (cliMode) {
			if (!config[cliMode]) throw new Error(`Mode "${cliMode}" is not defined in your config file.`);
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