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

export const sourcemapDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	rojo: sourcemapEntryShape,
});

export const sourcemapLineShape = S.union(
	watchLineShapes.write,
	S.object({ rojo: sourcemapEntryShape }),
	watchLineShapes.notice,
	watchLineShapes.error,
	watchLineShapes.diagnostics
);

export function sourcemapDocument(
	outcomes: readonly ConfigOutcome[],
	cwd: string,
	rojo: RojoEntry,
	changed: boolean
) {
	return { changed, configs: configsDocument(outcomes, cwd).configs, rojo };
}
