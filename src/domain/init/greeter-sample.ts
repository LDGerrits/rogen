import path from "path";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { templateFiles } from "./template-files.js";
import { fillTemplate } from "./fill-template.js";

/** The order `init` lists a feature's files in, by the folder of their route. */
const ROUTE_ORDER: readonly string[] = ["shared", "server", "client"];

/** The suffix of the variant for several places. */
const PLACES_VARIANT = "-places";

/** Where a variant keeps the code that `init` writes to the source paths it computes. */
export const TEMPLATE_SOURCE_PATHS = {
	/** The variant for one place. */
	one: "src",
	/** The first place of the variant for several, by language. */
	place: {
		luau: "src/game",
		"roblox-ts": "projects/game/src",
	} as Readonly<Record<string, string>>,
} as const;

const FEATURE = "Greeter";
const PLACE_FEATURE = "Game";
const README = "README.md";

/** The files of the sample a new place starts with: the Greeter feature, whose `Server` and `Client` scripts require its shared `Greeting`, the same three hello-worlds as Rojo's. */
export class GreeterSample {
	private readonly variant: string;
	private readonly placesVariant: string;
	private readonly placeSource: string;

	constructor(
		language: Language,
		/** The project's name, which Rojo takes from the folder. */
		private readonly name: string
	) {
		this.variant = language.id;
		this.placesVariant = `${language.id}${PLACES_VARIANT}`;
		this.placeSource = TEMPLATE_SOURCE_PATHS.place[language.id];
	}

	/** The feature in `sourcePath`, shared by every place that reads it. */
	feature(sourcePath: string): PlannedFile[] {
		return this.mapped(
			this.variant,
			`${TEMPLATE_SOURCE_PATHS.one}/${FEATURE}`,
			path.posix.join(sourcePath, FEATURE)
		);
	}

	/** The feature of the first place of several, whose script greets with the shared module. */
	place(sourcePath: string): PlannedFile[] {
		return this.mapped(
			this.placesVariant,
			`${this.placeSource}/${PLACE_FEATURE}`,
			path.posix.join(sourcePath, PLACE_FEATURE)
		);
	}

	/** The README of the sample, whose feature is in `sourcePath`; `serve` is the command that serves the project, and `place` the folder of the first place of several. */
	readme(sourcePath: string, serve: string, place?: string): PlannedFile {
		const content = templateFiles(
			place ? this.placesVariant : this.variant
		);
		return {
			fileName: README,
			content: fillTemplate(content.get(README) as string, {
				name: this.name,
				source: sourcePath,
				serve,
				...(place && { place }),
			}),
		};
	}

	/** The files of `variant` below `from`, written below `to`. */
	private mapped(variant: string, from: string, to: string): PlannedFile[] {
		const rank = ([file]: [string, string]) =>
			ROUTE_ORDER.indexOf(
				file
					.slice(from.length + 1)
					.split("/")[0]
					.toLowerCase()
			);
		return [...templateFiles(variant)]
			.filter(([file]) => file.startsWith(`${from}/`))
			.sort((a, b) => rank(a) - rank(b))
			.map(([file, content]) => ({
				fileName: path.posix.join(to, file.slice(from.length + 1)),
				content: fillTemplate(content, { name: this.name }),
			}));
	}
}
