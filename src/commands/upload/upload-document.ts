import { ConfigBuild } from "../../domain/build/build.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	RojoEntry,
	buildDocument,
	buildEntryShape,
	rojoEntryShape,
} from "../build/build-document.js";

const S = OutputShape;

/** The document of `upload --json`. */
export const uploadDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(buildEntryShape),
	rojo: rojoEntryShape("upload"),
});

export function uploadDocument(
	builds: readonly ConfigBuild[],
	rojo: RojoEntry
) {
	return { ...buildDocument(builds), rojo };
}
