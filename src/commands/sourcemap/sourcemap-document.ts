import { ConfigBuild } from "../../domain/build/build.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import {
	RojoEntry,
	buildDocument,
	buildEntryShape,
	rojoEntryShape,
	watchLineShapes,
} from "../build/build-document.js";

const S = OutputShape;

const sourcemapEntryShape = rojoEntryShape("sourcemap");

/** The document of `sourcemap --json`. */
export const sourcemapDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(buildEntryShape),
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
	builds: readonly ConfigBuild[],
	cwd: string,
	rojo: RojoEntry
) {
	const built = buildDocument(builds, cwd);
	return {
		changed: built.changed || rojo.outcome === "built",
		configs: built.configs,
		rojo,
	};
}
