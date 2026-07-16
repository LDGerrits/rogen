import { RoutingMaps } from "./route.js";
import { Config, RojoTree } from "./types.js";

export const version = "1.4.0";

export const defaultTemplate: RojoTree = {
	name: "roblox-game",
	tree: { $className: "DataModel" },
};

export const defaultConfig: Config = {
	source: ["src"],
	verbatim: false,
	casing: "camelCase",
	globIgnorePaths: [],
	aliases: {},
	unwrap: false,
	luau: {
		output: "default.project.json",
		build: "src",
		env: [],
		globIgnorePaths: [],
	},
	ts: {
		output: "default.project.json",
		build: "out",
		env: [],
		globIgnorePaths: [],
	},
	darklua: {
		output: "build.project.json",
		build: "dist",
		env: [],
		globIgnorePaths: [],
	},
	template: defaultTemplate,
};

export const services: Record<string, string> = {
	Server: "ServerScriptService",
	Client: "StarterPlayerScripts",
	Shared: "ReplicatedStorage",
	ServerScriptService: "ServerScriptService",
	ReplicatedStorage: "ReplicatedStorage",
	ReplicatedFirst: "ReplicatedFirst",
	ServerStorage: "ServerStorage",
	StarterGui: "StarterGui",
	StarterPack: "StarterPack",
	StarterPlayerScripts: "StarterPlayerScripts",
	StarterCharacterScripts: "StarterCharacterScripts",
	Workspace: "Workspace",
	Lighting: "Lighting",
	SoundService: "SoundService",
	RobloxPluginGuiService: "RobloxPluginGuiService",
};

export const serviceParents: Record<string, string> = {
	StarterPlayerScripts: "StarterPlayer",
	StarterCharacterScripts: "StarterPlayer",
};

export const serverContainers = new Set<string>([
	"ServerScriptService",
	"ServerStorage",
]);

export const clientContainers = new Set<string>([
	"StarterPlayer",
	"StarterPlayerScripts",
	"StarterCharacterScripts",
	"StarterGui",
	"StarterPack",
	"ReplicatedFirst",
]);

export const serviceAliases = new Set<string>(["server", "client", "shared"]);

export function generateRoutingMaps(
	customAliases: Record<string, string> = {}
): RoutingMaps {
	const mergedServices = { ...services, ...customAliases };
	const lowerCaseMap = Object.fromEntries(
		Object.entries(mergedServices).map(([k, v]) => [k.toLowerCase(), v])
	);

	const mergedKeys = Object.keys(mergedServices).sort(
		(a, b) => b.length - a.length
	);
	const lowerKeys = Object.keys(lowerCaseMap).sort(
		(a, b) => b.length - a.length
	);

	const allPrefixKeys = Array.from(
		new Set([...lowerKeys, ...mergedKeys])
	).sort((a, b) => b.length - a.length);

	const separatorSuffixRegex = new RegExp(
		`[\\.\\-_\\+](${lowerKeys.join("|")})$`,
		"i"
	);
	const pascalCaseSuffixRegex = new RegExp(`(${mergedKeys.join("|")})$`);
	const separatorPrefixRegex = new RegExp(
		`^(${lowerKeys.join("|")})([\\.\\-_\\+])`,
		"i"
	);
	const camelCasePrefixRegex = new RegExp(
		`^(${allPrefixKeys.join("|")})(?=[A-Z])`
	);

	return {
		mergedServices,
		lowerCaseMap,
		separatorSuffixRegex,
		pascalCaseSuffixRegex,
		separatorPrefixRegex,
		camelCasePrefixRegex,
	};
}
