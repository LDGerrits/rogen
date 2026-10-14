import path from "path";
import { UsageError } from "../../base/errors.js";
import { toPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Result, err, ok } from "../../base/result.js";
import { ConfigSelection } from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import { RojoPlan, RojoStep } from "../build/rojo-step.js";

/** The file a sourcemap is written to beside its project file when several projects are selected. */
export const SOURCEMAP_FILE = "sourcemap.json";

export interface SourcemapFlags {
	readonly output: string | undefined;
	readonly includeNonScripts: boolean;
	readonly absolute: boolean;
}

/** Rojo's sourcemap of each project the selection names. */
export class SourcemapStep implements RojoStep {
	readonly command = "sourcemap";

	constructor(
		private readonly rojo: RojoCommandService,
		private readonly flags: SourcemapFlags,
		private readonly cwd: string,
		/** Whether the sourcemap may go to the screen, as it does without `-o`. */
		private readonly mayPrint: boolean
	) {}

	plans(selection: ConfigSelection): Result<readonly RojoPlan[], UsageError> {
		if (selection.requireValid().isErr()) return ok([]);
		const projects = this.rojo.projects(selection);
		if (projects.length === 0)
			return err(
				new UsageError(
					`There is no project to run 'rojo ${this.command}' on.`
				)
			);
		const { output, includeNonScripts, absolute } = this.flags;
		const rojoFlags = [
			...(includeNonScripts ? ["--include-non-scripts"] : []),
			...(absolute ? ["--absolute"] : []),
		];
		if (projects.length > 1) {
			if (output !== undefined)
				return err(
					new UsageError(
						`-o names one file, and this selects ${projects.length} projects. Name one place, or leave -o out to write a ${SOURCEMAP_FILE} beside each project file.`
					)
				);
			const shared = projects.find((project, index) =>
				projects
					.slice(0, index)
					.some((before) => before.projectDir === project.projectDir)
			);
			if (shared) {
				const sharing = projects.filter(
					({ projectDir }) => projectDir === shared.projectDir
				);
				const folder =
					toPosix(path.relative(this.cwd, shared.projectDir)) || ".";
				return err(
					new UsageError(
						`${joinedWithAnd(sharing.map(({ label }) => label))} ${sharing.length === 2 ? "both" : "all"} have their project file in ${folder}, so ${sharing.length === 2 ? "both" : "all"} sourcemaps would be ${SOURCEMAP_FILE} there.`,
						"Name one project, with -o for the file to write."
					)
				);
			}
			return ok(
				projects.map((project) => {
					const cwd = path.dirname(project.projectFile);
					return {
						project,
						flags: [...rojoFlags, "--output", SOURCEMAP_FILE],
						cwd,
						target: {
							command: this.command,
							cwd,
							output: SOURCEMAP_FILE,
						},
					};
				})
			);
		}
		const [project] = projects;
		if (output === undefined && !this.mayPrint)
			return err(
				new UsageError(
					"Without -o the sourcemap is printed, which leaves no room for --json or --watch: give -o <file>."
				)
			);
		return ok([
			{
				project,
				flags:
					output === undefined
						? rojoFlags
						: [...rojoFlags, "--output", output],
				cwd: this.cwd,
				target: { command: this.command, cwd: this.cwd, output },
				...(output === undefined && { printed: true as const }),
			},
		]);
	}
}
