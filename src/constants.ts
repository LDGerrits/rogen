import { RogenConfig, RoutingMaps } from "./types.js";

export const defaultConfig: RogenConfig = {
	source: ["src"],
	keepRouteNames: false,
	casing: "camelCase",
	aliases: {},
	luau: { 
		output: "default.project.json", 
		build: "src"
	},
	ts: { 
		output: "default.project.json", 
		build: "out"
	},
	darklua: { 
		output: "build.project.json", 
		build: "dist" 
	},
	template: {
		name: "roblox-project",
		globIgnorePaths: [
			"**/package.json",
			"**/tsconfig.json"
		],
		tree: {
			$className: "DataModel",
			ServerScriptService: {
				ServerPackages: {
					$path: "ServerPackages"
				}
			},
			ReplicatedStorage: {
				rbxts_include: {
					$path: "include",
					node_modules: { 
						$className: "Folder", 
						"@rbxts": { 
							$path: "node_modules/@rbxts" 
						}
					}
				},
				Packages: {
					$path: "Packages"
				}
			}
		}
	}
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
};

export const serviceParents: Record<string, string> = {
	StarterPlayerScripts: "StarterPlayer",
	StarterCharacterScripts: "StarterPlayer",
};

export const serverContainers = new Set<string>([
	"ServerScriptService", 
	"ServerStorage"
]);

export const clientContainers = new Set<string>([
	"StarterPlayer", 
	"StarterPlayerScripts", 
	"StarterCharacterScripts", 
	"StarterGui", 
	"StarterPack", 
	"ReplicatedFirst"
]);

export const serviceAliases = new Set<string>([
	"server", 
	"client", 
	"shared"
]);

export function generateRoutingMaps(customAliases: Record<string, string> = {}): RoutingMaps {
	const mergedServices = { ...services, ...customAliases };
	const lowerCaseMap = Object.fromEntries(
		Object.entries(mergedServices).map(([k, v]) => [k.toLowerCase(), v])
	);

	const mergedKeys = Object.keys(mergedServices).sort((a, b) => b.length - a.length);
	const lowerKeys = Object.keys(lowerCaseMap).sort((a, b) => b.length - a.length);

	const allPrefixKeys = Array.from(new Set([...lowerKeys, ...mergedKeys])).sort((a, b) => b.length - a.length);

	const separatorSuffixRegex = new RegExp(`[\\.\\-_](${lowerKeys.join("|")})$`, "i");
	const pascalCaseSuffixRegex = new RegExp(`(${mergedKeys.join("|")})$`);
	const separatorPrefixRegex = new RegExp(`^(${lowerKeys.join("|")})([\\.\\-_])`, "i");
	const camelCasePrefixRegex = new RegExp(`^(${allPrefixKeys.join("|")})(?=[A-Z])`);

	return { 
		mergedServices, 
		lowerCaseMap, 
		separatorSuffixRegex, 
		pascalCaseSuffixRegex, 
		separatorPrefixRegex,
		camelCasePrefixRegex
	};
}
