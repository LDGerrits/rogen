import { RogenConfig } from "../config/config.js";

export const PROCESSED_OUTPUT = "dist";
export const RELEASE_OUTPUT = "release";

/** A config file beside the default, named for the project file it writes. */
export interface OutputConfig {
	readonly stem: string;
	readonly config: RogenConfig;
}

export interface OutputSettings {
	/** The name the second files carry, since Rojo names only a default project file after its folder. */
	readonly name: string;
	/** The folder Darklua writes, which `dist` reads. */
	readonly processedPath?: string;
	/** The folder `release` reads: the one Darklua writes, else the compiler's. */
	readonly releasePath?: string;
	/** The glob that leaves the test specs out of `release`, when a test runner is set up. */
	readonly releaseIgnore?: string;
}

/** The second outputs of a project, each a complete copy of the default with the keys that differ. */
export class OutputConfigs {
	static of(base: RogenConfig, settings: OutputSettings): OutputConfig[] {
		const routed = base.rogen?.sourcePaths !== undefined;
		const copy = (compiledPath: string | undefined): RogenConfig => ({
			...base,
			name: base.name ?? settings.name,
			...(routed && {
				rogen: {
					...base.rogen,
					...(compiledPath && { compiledPath }),
				},
			}),
		});
		const { processedPath, releasePath, releaseIgnore } = settings;
		return [
			...(processedPath && routed
				? [{ stem: PROCESSED_OUTPUT, config: copy(processedPath) }]
				: []),
			...(releaseIgnore
				? [
						{
							stem: RELEASE_OUTPUT,
							config: {
								...copy(releasePath),
								globIgnorePaths: [
									...(base.globIgnorePaths ?? []),
									releaseIgnore,
								],
							},
						},
					]
				: []),
		];
	}
}
