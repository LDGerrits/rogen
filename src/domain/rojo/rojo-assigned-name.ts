const ROJO_SCRIPT_SUFFIXES = [".server", ".client"] as const;

// The name Rojo gives a file in a synced directory, independent of the config.
export function rojoAssignedName(stem: string): string {
	for (const suffix of ROJO_SCRIPT_SUFFIXES) {
		if (stem.endsWith(suffix)) {
			return stem.slice(0, -suffix.length);
		}
	}
	return stem;
}
