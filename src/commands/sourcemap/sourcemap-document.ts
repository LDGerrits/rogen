import { ConfigOutcome } from "../../domain/write/write.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { RojoEntry, rojoEntryShape } from "../write/rojo-entry.js";
import {
	configsDocument,
	watchLineShapes,
	writeEntryShape,
} from "../write/write-document.js";

const S = OutputShape;

const sourcemapEntryShape = rojoEntryShape("sourcemap");

/** The document of `sourcemap --json`. */
export const sourcemapDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	rojo: sourcemapEntryShape,
});

/** One line of `sourcemap --watch --json`. */
export const sourcemapLineShape = S.union(
	watchLineShapes.build,
	S.object({ rojo: sourcemapEntryShape }),
	watchLineShapes.notice,
	watchLineShapes.error
);

export function sourcemapDocument(
	outcomes: readonly ConfigOutcome[],
	cwd: string,
	rojo: RojoEntry
) {
	const written = configsDocument(outcomes, cwd);
	return {
		changed: written.changed || rojo.outcome === "built",
		configs: written.configs,
		rojo,
	};
}
