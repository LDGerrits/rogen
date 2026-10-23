import { ConfigOutcome } from "../../domain/write/write.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { RojoEntry, rojoEntryShape } from "../write/report-rojo.js";
import { configsDocument, writeEntryShape } from "../write/write-document.js";

const S = OutputShape;

/** The document of `upload --json`. */
export const uploadDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	rojo: rojoEntryShape("upload"),
});

export function uploadDocument(
	builds: readonly ConfigOutcome[],
	cwd: string,
	rojo: RojoEntry
) {
	return { ...configsDocument(builds, cwd), rojo };
}
