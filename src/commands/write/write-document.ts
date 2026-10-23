import { BuildRun, ConfigBuild } from "../../domain/build/build.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { configPath } from "../../platform/config/config-path.js";
import { buildDocument, buildEntryShape } from "../build/build-document.js";

const S = OutputShape;

/** The document of `write --json`. */
export const writeDocumentShape = S.object({
	changed: S.boolean,
	configs: S.array(buildEntryShape),
	plainProjects: S.array(S.string),
});

/** A project file with no config of its name, which is its own output and is not written. */
export const isPlain = (build: ConfigBuild): boolean =>
	build.outcome !== "notLoaded" && build.config.isAdopted;

/** The build document with the project files the run left alone: those named as configs and those beside them, as paths relative to the working folder. */
export function writeDocument(
	run: BuildRun,
	cwd: string,
	plainProjects: readonly string[]
) {
	const left = [
		...run.builds.filter(isPlain).map(({ file }) => file),
		...plainProjects,
	];
	return {
		...buildDocument(run.builds, cwd),
		plainProjects: [...new Set(left.map((file) => configPath(cwd, file)))],
	};
}
