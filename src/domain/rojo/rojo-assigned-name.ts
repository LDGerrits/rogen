const ROJO_SCRIPT_SUFFIXES = ["server", "client", "plugin"] as const;

export type RojoScriptSuffix = (typeof ROJO_SCRIPT_SUFFIXES)[number];

// Rojo only recognises the script class right before the extension.
export function rojoScriptSuffix(stem: string): RojoScriptSuffix | undefined {
	return ROJO_SCRIPT_SUFFIXES.find((suffix) => stem.endsWith(`.${suffix}`));
}

// The name Rojo gives a file in a synced directory, independent of the config.
export function rojoAssignedName(stem: string): string {
	const suffix = rojoScriptSuffix(stem);
	return suffix ? stem.slice(0, -(suffix.length + 1)) : stem;
}
