export const SUPPORTED_SERVICES = [
	"ServerScriptService",
	"ServerStorage",
	"ReplicatedStorage",
	"ReplicatedFirst",
	"StarterGui",
	"StarterPack",
	"StarterPlayer",
	"Workspace",
	"Lighting",
	"SoundService",
	"RobloxPluginGuiService",
] as const;

export type SupportedService = (typeof SUPPORTED_SERVICES)[number];

export function isSupportedService(name: string): name is SupportedService {
	return (SUPPORTED_SERVICES as readonly string[]).includes(name);
}
