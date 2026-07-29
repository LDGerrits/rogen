import fs from "fs";
import path from "path";
import { Environment, Config, Mode, RojoTree, RojoNode } from "./types.js";
import { defaultConfig, defaultProject } from "./constants.js";
import { Logger } from "./logger.js";

type ConfigKeys = keyof {
	[K in keyof Config as string extends K
		? never
		: number extends K
			? never
			: K]: Config[K];
};

export interface ActiveMode {
	name: string;
	config: Mode;
}

const CONFIG_KEYS_MAP: Record<ConfigKeys, true> = {
	source: true,
	tags: true,
	verbatim: true,
	casing: true,
	unwrap: true,
	aliases: true,
	globIgnorePaths: true,
	luau: true,
	ts: true,
	darklua: true,
	project: true,
};

const KEYS = Object.keys(CONFIG_KEYS_MAP);

const LEGACY_KEYS: Record<string, ConfigKeys> = {
	keepRouteNames: "verbatim",
	keepSuffixes: "verbatim",
	template: "project",
};

function getClosestMatch(
	input: string,
	targets: string[],
	distanceThreshold: number
): string | null {
	let closest: string | null = null;
	let minDistance = Infinity;

	for (const target of targets) {
		const matrix = Array.from({ length: input.length + 1 }, () =>
			Array(target.length + 1).fill(0)
		);

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

function isValidRojoTree(value: unknown): value is RojoTree {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const record = value as Record<string, unknown>;
	return (
		typeof record.tree === "object" &&
		record.tree !== null &&
		!Array.isArray(record.tree)
	);
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

export function resolveConfigPath(
	customPathArg?: string,
	logger?: Logger
): string | undefined {
	const cwd = process.cwd();

	if (customPathArg) {
		const resolvedPath = path.resolve(cwd, customPathArg);
		if (!fs.existsSync(resolvedPath)) {
			throw new Error(
				`specified config file not found: ${customPathArg}`
			);
		}
		return resolvedPath;
	}

	const defaultPath = path.resolve(cwd, ".rogen.json");
	if (fs.existsSync(defaultPath)) {
		return defaultPath;
	}

	try {
		const directoryFiles = fs.readdirSync(cwd);
		const matchedConfig = directoryFiles.find((file) =>
			file.endsWith(".rogen.json")
		);
		if (matchedConfig) {
			return path.resolve(cwd, matchedConfig);
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : "Unknown Error";
		if (logger) {
			logger.error(`failed to scan directory for .rogen.json - ${msg}`);
		} else {
			console.error(`failed to scan directory for .rogen.json - ${msg}`);
		}
	}

	return undefined;
}

export function createFallbackConfig(cwd: string): Config {
	const isTs = fs.existsSync(path.join(cwd, "tsconfig.json"));
	const isWally = fs.existsSync(path.join(cwd, "wally.toml"));
	const isPesde = fs.existsSync(path.join(cwd, "pesde.toml"));

	const tree = structuredClone(defaultProject.tree);
	const project: RojoTree = {
		name: path.basename(cwd) || defaultProject.name,
		tree: tree,
	};

	if (isTs) {
		project.globIgnorePaths = ["**/package.json", "**/tsconfig.json"];

		const hasRbxts = fs.existsSync(
			path.join(cwd, "node_modules", "@rbxts")
		);
		const hasFlamework = fs.existsSync(
			path.join(cwd, "node_modules", "@flamework")
		);
		const hasRbxtsJs = fs.existsSync(
			path.join(cwd, "node_modules", "@rbxts-js")
		);

		const rbxtsIncludeNode: RojoNode = { $path: "include" };

		if (hasRbxts || hasFlamework || hasRbxtsJs) {
			const nodeModulesNode: RojoNode = { $className: "Folder" };

			if (hasRbxts)
				nodeModulesNode["@rbxts"] = { $path: "node_modules/@rbxts" };
			if (hasFlamework)
				nodeModulesNode["@flamework"] = {
					$path: "node_modules/@flamework",
				};
			if (hasRbxtsJs)
				nodeModulesNode["@rbxts-js"] = {
					$path: "node_modules/@rbxts-js",
				};

			rbxtsIncludeNode.node_modules = nodeModulesNode;
		}

		tree.ReplicatedStorage = {
			...(tree.ReplicatedStorage || {}),
			rbxts_include: rbxtsIncludeNode,
		};
	}

	if (isWally) {
		if (fs.existsSync(path.join(cwd, "Packages"))) {
			tree.ReplicatedStorage = {
				...(tree.ReplicatedStorage || {}),
				Packages: { $path: "Packages" },
			};
		}
		if (fs.existsSync(path.join(cwd, "ServerPackages"))) {
			tree.ServerScriptService = {
				...(tree.ServerScriptService || {}),
				ServerPackages: { $path: "ServerPackages" },
			};
		}
	}

	if (isPesde) {
		if (fs.existsSync(path.join(cwd, "roblox_packages"))) {
			tree.ReplicatedStorage = {
				...(tree.ReplicatedStorage || {}),
				Packages: { $path: "roblox_packages" },
			};
		}
		if (fs.existsSync(path.join(cwd, "roblox_server_packages"))) {
			tree.ServerScriptService = {
				...(tree.ServerScriptService || {}),
				ServerPackages: { $path: "roblox_server_packages" },
			};
		}
	}

	const config: Config = {
		...structuredClone(defaultConfig),
		project: project,
	};

	return config;
}

export function loadConfig(
	configPath?: string,
	projectPathArg?: string
): { config: Config; anchor: string } {
	const anchor = configPath ? path.dirname(configPath) : process.cwd();
	const config = createFallbackConfig(anchor);

	if (configPath) {
		const rawConfig = JSON.parse(
			fs.readFileSync(configPath, "utf-8")
		) as Partial<Config>;

		for (const key in rawConfig) {
			if (!KEYS.includes(key as ConfigKeys)) {
				if (key in LEGACY_KEYS) {
					throw new Error(
						`key "${key}" has been renamed to "${LEGACY_KEYS[key]}". Please, update your configuration.`
					);
				}

				const value = rawConfig[key];
				const isObject =
					typeof value === "object" &&
					value !== null &&
					!Array.isArray(value);
				const modeData = isObject
					? (value as Record<string, unknown>)
					: null;

				// Default modes merging
				if (
					isObject &&
					(key === "luau" || key === "ts" || key === "darklua")
				) {
					config[key] = {
						...(config[key] as Mode),
						...modeData,
					} as Mode;

					config[key].tags =
						modeData &&
						typeof modeData.tags === "object" &&
						modeData.tags !== null &&
						!Array.isArray(modeData.tags)
							? (modeData.tags as Record<string, boolean>)
							: {};

					config[key].globIgnorePaths = Array.isArray(
						config[key].globIgnorePaths
					)
						? config[key].globIgnorePaths
						: [];

					continue;
				}

				// Custom modes merging
				const intendedAsMode =
					modeData &&
					("output" in modeData ||
						"build" in modeData ||
						"tags" in modeData ||
						"globIgnorePaths" in modeData);

				if (intendedAsMode) {
					if (typeof modeData.output !== "string") {
						throw new Error(
							`custom mode "${key}" is missing a valid "output" string.`
						);
					}
					if (typeof modeData.build !== "string") {
						throw new Error(
							`custom mode "${key}" is missing a valid "build" string.`
						);
					}

					config[key] = {
						output: modeData.output,
						build: modeData.build,
						tags:
							typeof modeData.tags === "object" &&
							modeData.tags !== null &&
							!Array.isArray(modeData.tags)
								? modeData.tags
								: {},
						globIgnorePaths: Array.isArray(modeData.globIgnorePaths)
							? modeData.globIgnorePaths
							: [],
					};
					continue;
				}

				const closestMatch = getClosestMatch(key, KEYS, 2);
				if (closestMatch) {
					throw new Error(
						`unknown key "${key}". Did you mean "${closestMatch}"?`
					);
				}

				throw new Error(`unknown configuration key "${key}".`);
			} else {
				// Validate keys
				if (
					key === "source" &&
					typeof rawConfig[key] !== "string" &&
					!Array.isArray(rawConfig[key])
				) {
					throw new Error(
						`'source' must be a string or an array of strings.`
					);
				} else if (
					key === "project" &&
					typeof rawConfig[key] !== "object" &&
					typeof rawConfig[key] !== "string"
				) {
					throw new Error(
						`'project' must be an inline object or a string path to a JSON file.`
					);
				} else if (
					(key === "verbatim" || key === "unwrap") &&
					typeof rawConfig[key] !== "boolean"
				) {
					throw new Error(`'${key}' must be a boolean.`);
				} else if (key === "casing") {
					if (typeof rawConfig[key] !== "string") {
						throw new Error(`'casing' must be a string.`);
					}
					const casingVal = rawConfig[key]
						.toLowerCase()
						.replace(/[-_\s]/g, "");
					if (casingVal === "pascal" || casingVal === "pascalcase") {
						config.casing = "PascalCase";
					} else if (
						casingVal === "camel" ||
						casingVal === "camelcase"
					) {
						config.casing = "camelCase";
					} else {
						throw new Error(
							`'casing' must be either "PascalCase" or "camelCase".`
						);
					}
				} else if (
					key === "globIgnorePaths" &&
					!Array.isArray(rawConfig[key])
				) {
					throw new Error(`'${key}' must be an array of strings.`);
				} else if (key === "tags") {
					if (
						typeof rawConfig[key] !== "object" ||
						rawConfig[key] === null ||
						Array.isArray(rawConfig[key])
					) {
						throw new Error(
							`'tags' must be a key-value object of booleans.`
						);
					}
					for (const tagKey in rawConfig[key] as Record<
						string,
						unknown
					>) {
						if (
							typeof (rawConfig[key] as Record<string, unknown>)[
								tagKey
							] !== "boolean"
						) {
							throw new Error(
								`value for tag "${tagKey}" must be a boolean.`
							);
						}
					}
				}
				config[key] = rawConfig[key];
			}
		}
	}

	// Project handling
	if (projectPathArg) {
		const projectPath = path.resolve(process.cwd(), projectPathArg);
		if (!fs.existsSync(projectPath)) {
			throw new Error(`specified project file not found: ${projectPath}`);
		}
		config.project = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
	} else if (typeof config.project === "string") {
		const projectPath = path.resolve(anchor, config.project);
		if (!fs.existsSync(projectPath)) {
			throw new Error(`specified project file not found: ${projectPath}`);
		}
		config.project = JSON.parse(fs.readFileSync(projectPath, "utf-8"));
	}

	if (!isValidRojoTree(config.project)) {
		throw new Error(
			"provided project is not a valid Rojo project. " +
				"It must be a JSON object containing a 'name' and 'tree' property."
		);
	}

	return { config, anchor };
}

export function getEnvironment(
	anchor: string,
	cliModes?: string[]
): Environment {
	if (cliModes && cliModes.length > 0) {
		return {
			isTsProject: cliModes.includes("ts"),
			isDarkluaProject: cliModes.includes("darklua"),
		};
	}
	const isTsProject = fs.existsSync(path.join(anchor, "tsconfig.json"));
	const isDarkluaProject =
		fs.existsSync(path.join(anchor, ".darklua.json")) ||
		fs.existsSync(path.join(anchor, ".darklua.json5"));
	return { isTsProject, isDarkluaProject };
}

export function resolveActiveModes(
	config: Config,
	cliModes: string[] | undefined,
	env: Environment
): ActiveMode[] {
	const activeModes: ActiveMode[] = [];

	if (cliModes && cliModes.length > 0) {
		for (const cliMode of cliModes) {
			const requestedMode = config[cliMode];
			if (!isMode(requestedMode)) {
				throw new Error(
					`mode "${cliMode}" is not defined or is invalid in your config file.`
				);
			}
			activeModes.push({ name: cliMode, config: requestedMode });
		}
	} else {
		for (const key in config) {
			const potentialMode = config[key];

			if (isMode(potentialMode)) {
				if (key === "luau" && env.isTsProject) continue;
				if (key === "ts" && !env.isTsProject) continue;
				if (key === "darklua" && !env.isDarkluaProject) continue;

				activeModes.push({ name: key, config: potentialMode });
			}
		}
		if (activeModes.length === 0) {
			throw new Error(
				"no output modes defined in configuration file. Add 'luau', 'ts', or custom modes."
			);
		}
	}

	return activeModes;
}
