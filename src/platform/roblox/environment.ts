export class RobloxEnvironment {
	private static readonly SERVICES: Record<string, string> = {
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

	private static readonly SERVICE_PARENTS: Record<string, string> = {
		StarterPlayerScripts: "StarterPlayer",
		StarterCharacterScripts: "StarterPlayer",
	};

	private static readonly SERVER_CONTAINERS = new Set([
		"ServerScriptService",
		"ServerStorage",
	]);
	private static readonly CLIENT_CONTAINERS = new Set([
		"StarterPlayer",
		"StarterPlayerScripts",
		"StarterGui",
		"StarterPack",
		"ReplicatedFirst",
	]);
	private static readonly SERVICE_ALIASES = new Set([
		"server",
		"client",
		"shared",
	]);

	static getServiceName(alias: string): string | undefined {
		return this.SERVICES[alias] || this.SERVICES[alias.toLowerCase()];
	}

	static getParentContainer(serviceName: string): string | undefined {
		return this.SERVICE_PARENTS[serviceName];
	}

	static isServerOnly(containerName: string): boolean {
		return this.SERVER_CONTAINERS.has(containerName);
	}

	static isClientOnly(containerName: string): boolean {
		return this.CLIENT_CONTAINERS.has(containerName);
	}

	static isServiceAlias(alias: string): boolean {
		return this.SERVICE_ALIASES.has(alias.toLowerCase());
	}
}
