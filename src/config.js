const fs = require("fs");
const path = require("path");
const { fallbackConfig } = require("./constants");

function resolveConfigPath(customPathArg) {
	const cwd = process.cwd();
	
	if (customPathArg) {
		const resolvedPath = path.resolve(cwd, customPathArg);
		if (!fs.existsSync(resolvedPath)) {
			throw new Error(`Specified config file not found: ${customPathArg}`);
		}
		return resolvedPath;
	}

	const defaultPath = path.resolve(cwd, ".rogen.json");
	if (fs.existsSync(defaultPath)) return defaultPath;

	try {
		const directoryFiles = fs.readdirSync(cwd);
		const matchedConfig = directoryFiles.find(file => file.endsWith(".rogen.json"));
		if (matchedConfig) return path.resolve(cwd, matchedConfig);
	} catch (error) {}

	return null;
}

function loadAndValidateConfig(configPath) {
	if (!configPath) {
		return { config: JSON.parse(JSON.stringify(fallbackConfig)), hasConfig: false };
	}

	const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	const standardKeys = ["source", "template", "luau", "ts", "darklua"];

	for (const key in config) {
		if (!standardKeys.includes(key)) {
			const customMode = config[key];
			if (typeof customMode !== "object" || customMode === null || Array.isArray(customMode)) {
				throw new Error(`\nConfiguration Error: Key "${key}" must be a valid object defining a mode.\n`);
			}
		} else if (key === "template" && typeof config[key] !== "object" && typeof config[key] !== "string") {
			throw new Error(`\nConfiguration Error: 'template' must be an inline object or a string path to a JSON file.\n`);
		}
	}

	return { config, hasConfig: true };
}

function loadProjectTree(cliProjectArg, configProjectField) {
	let targetPath = null;
	
	if (cliProjectArg) targetPath = path.resolve(process.cwd(), cliProjectArg);
	else if (typeof configProjectField === "string") targetPath = path.resolve(process.cwd(), configProjectField);

	if (targetPath) {
		if (!fs.existsSync(targetPath)) {
			throw new Error(`Specified template file not found: ${targetPath}`);
		}
		return JSON.parse(fs.readFileSync(targetPath, "utf-8"));
	}

	if (typeof configProjectField === "object" && configProjectField !== null) {
		return configProjectField;
	}
	
	return JSON.parse(JSON.stringify(fallbackConfig.template));
}

function getEnvironment() {
	const cwd = process.cwd();
	const isTsProject = fs.existsSync(path.join(cwd, "tsconfig.json"));
	const isDarkluaProject = fs.existsSync(path.join(cwd, ".darklua.json")) || fs.existsSync(path.join(cwd, ".darklua.json5"));
	return { isTsProject, isDarkluaProject };
}

function resolveActiveModes(config, hasConfig, cliMode, env) {
	const baseLanguage = env.isTsProject ? (config.ts || fallbackConfig.ts) : (config.luau || fallbackConfig.luau);
	const activeModes = [];

	if (hasConfig) {
		if (cliMode) {
			if (!config[cliMode]) throw new Error(`Mode "${cliMode}" is not defined in your config file.`);
			activeModes.push(config[cliMode]);
		} else {
			for (const key in config) {
				if (key !== "source" && key !== "template" && typeof config[key] === "object" && !Array.isArray(config[key])) {
					if (key === "luau" && env.isTsProject) continue;
					if (key === "ts" && !env.isTsProject) continue;
					if (key === "darklua" && !env.isDarkluaProject) continue;
					activeModes.push(config[key]);
				}
			}
			if (activeModes.length === 0) {
				throw new Error("No output modes defined in configuration file. Add 'luau', 'ts', or custom modes.");
			}
		}
	} else {
		if (cliMode) {
			if (!fallbackConfig[cliMode]) throw new Error(`Mode "${cliMode}" is not defined in the fallback config.`);
			activeModes.push({ ...baseLanguage, ...config[cliMode] });
		} else {
			activeModes.push(baseLanguage);
			if (env.isDarkluaProject) activeModes.push({ ...baseLanguage, ...config.darklua });
		}
	}

	return activeModes;
}

module.exports = {
	resolveConfigPath,
	loadAndValidateConfig,
	loadProjectTree,
	getEnvironment,
	resolveActiveModes
};