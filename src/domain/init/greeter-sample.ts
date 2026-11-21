import path from "path";
import { Language, PlannedFile } from "../toolchain/toolchain.js";
import { templateFiles } from "./template-files.js";
import { fillTemplate } from "./fill-template.js";

const ROUTE_ORDER: readonly string[] = ["shared", "server", "client"];

const PLACES_VARIANT = "-places";

export const TEMPLATE_SOURCE_PATHS = {
	one: "src",
	place: "src/game",
} as const;

const FEATURE = "Greeter";
const PLACE_FEATURE = "Game";
const README = "README.md";

export class GreeterSample {
	private readonly variant: string;
	private readonly placesVariant: string;

	constructor(
		language: Language,
		private readonly name: string
	) {
		this.variant = language.id;
		this.placesVariant = `${language.id}${PLACES_VARIANT}`;
	}

	feature(sourcePath: string): PlannedFile[] {
		return this.mapped(
			this.variant,
			`${TEMPLATE_SOURCE_PATHS.one}/${FEATURE}`,
			path.posix.join(sourcePath, FEATURE)
		);
	}

	place(sourcePath: string): PlannedFile[] {
		return this.mapped(
			this.placesVariant,
			`${TEMPLATE_SOURCE_PATHS.place}/${PLACE_FEATURE}`,
			path.posix.join(sourcePath, PLACE_FEATURE)
		);
	}

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
