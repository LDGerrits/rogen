import { ConfigOutcome } from "../../domain/write/write.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { RojoEntry, rojoEntryShape } from "../write/rojo-entry.js";
import { configsDocument, writeEntryShape } from "../write/write-document.js";

const S = OutputShape;

/** The document of `upload --json`. */
export const uploadDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(writeEntryShape),
	rojo: rojoEntryShape("upload"),
});

export function uploadDocument(
	outcomes: readonly ConfigOutcome[],
	cwd: string,
	rojo: RojoEntry
) {
	return { ...configsDocument(outcomes, cwd), rojo };
}
