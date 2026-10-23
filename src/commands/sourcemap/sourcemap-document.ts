import { ConfigOutcome } from "../../domain/write/write.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { RojoEntry, rojoEntryShape } from "../write/report-rojo.js";
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
	builds: readonly ConfigOutcome[],
	cwd: string,
	rojo: RojoEntry
) {
	const built = configsDocument(builds, cwd);
	return {
		changed: built.changed || rojo.outcome === "built",
		configs: built.configs,
		rojo,
	};
}
