import { RogenConfig } from "../config/config.js";

export const PROCESSED_OUTPUT = "dist";
export const RELEASE_OUTPUT = "release";

export interface OutputConfig {
	readonly stem: string;
	readonly config: RogenConfig;
}

export interface OutputSettings {
	/**
	 * The name the second files carry, since Rojo names only a default project
	 * file after its folder.
	 */
	readonly name: string;
	readonly processedPath?: string;
	readonly releasePath?: string;
	readonly releaseIgnore?: string;
}

export class OutputConfigs {
	static of(base: RogenConfig, settings: OutputSettings): OutputConfig[] {
		const routed = base.sourcePaths !== undefined;
		const copy = (compiledPath: string | undefined): RogenConfig => ({
			...base,
			name: base.name ?? settings.name,
			...(routed && compiledPath && { compiledPath }),
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
