import { ConfigOutcome } from "../../domain/write/write.js";
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
	builds: readonly ConfigOutcome[],
	cwd: string,
	rojo: RojoEntry
) {
	return { ...buildDocument(builds, cwd), rojo };
}
