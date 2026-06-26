const defaultConfig = {
	"source": ["src"],
	"keepSuffixes": false,
	"aliases": {},
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
};

const services = {
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

const serviceParents = {
	StarterPlayerScripts: "StarterPlayer",
	StarterCharacterScripts: "StarterPlayer",
};

const serverContainers = new Set([
	"ServerScriptService", 
	"ServerStorage"
]);

const clientContainers = new Set([
	"StarterPlayer", 
	"StarterPlayerScripts", 
	"StarterCharacterScripts", 
	"StarterGui", 
	"StarterPack", 
	"ReplicatedFirst"
]);

const serviceAliases = new Set([
	"server", 
	"client", 
	"shared"
]);

function generateRoutingMaps(customAliases = {}) {
	const mergedServices = { ...services, ...customAliases };
	const lowerCaseMap = Object.fromEntries(Object.entries(mergedServices).map(([k, v]) => [k.toLowerCase(), v]));
	
	const mergedKeys = Object.keys(mergedServices).sort((a, b) => b.length - a.length);
	const lowerKeys = Object.keys(lowerCaseMap).sort((a, b) => b.length - a.length);

	const separatorSuffixRegex = new RegExp(`[\\.\\-_](${lowerKeys.join("|")})$`, "i");
	const pascalCaseSuffixRegex = new RegExp(`(${mergedKeys.join("|")})$`);

	const prefixRegex = new RegExp(`^(${lowerKeys.join("|")})([\\.\\-_]?)`, "i");

	return { 
		mergedServices, 
		lowerCaseMap, 
		separatorSuffixRegex, 
		pascalCaseSuffixRegex, 
		prefixRegex 
	};
}

module.exports = {
	defaultConfig,
	services,
	serviceParents,
	serverContainers,
	clientContainers,
	serviceAliases,
	generateRoutingMaps
};