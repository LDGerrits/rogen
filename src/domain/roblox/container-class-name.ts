const STARTER_PLAYER_CONTAINERS: readonly string[] = [
	"StarterPlayerScripts",
	"StarterCharacterScripts",
];

/** The class of a node Rogen creates to hold children: services and StarterPlayer's script containers keep their own, the rest are folders. */
export function containerClassName(instancePath: readonly string[]): string {
	const [service, child] = instancePath;
	if (instancePath.length === 1) return service;
	if (
		instancePath.length === 2 &&
		service === "StarterPlayer" &&
		STARTER_PLAYER_CONTAINERS.includes(child)
	)
		return child;
	return "Folder";
}
