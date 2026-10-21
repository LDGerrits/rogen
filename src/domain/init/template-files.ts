import { RojoNode } from "../rojo/rojo-project.js";
import { starterTemplates } from "./starter-templates.js";

const SAMPLE_GAME_FILE = "sample-game.json";

/** The files of a variant, by path inside its folder under `templates/`. */
export function templateFiles(variant: string): Map<string, string> {
	const prefix = `${variant}/`;
	return new Map(
		Object.entries(starterTemplates)
			.filter(([file]) => file.startsWith(prefix))
			.map(([file, content]) => [file.slice(prefix.length), content])
	);
}

/** The sample game of `rojo init`: a Baseplate, and the Lighting and SoundService it plays with. */
export function sampleGame(): Record<string, Partial<RojoNode>> {
	return JSON.parse(starterTemplates[SAMPLE_GAME_FILE]);
}
