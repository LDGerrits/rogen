import path from "path";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoProject, rojoPathTarget } from "../rojo/rojo-project.js";
import { RojoVersion } from "./rojo-version.js";
import { ServerExecutable } from "./rojo-runner.js";

const BROKEN = RojoVersion.of("7.7.0");
const FIXED = RojoVersion.of("7.7.1");
const SYNC_RULES_SINCE = RojoVersion.of("7.5.0");
const NEGATION_SINCE = RojoVersion.of("7.7.0");
const NOTHING = {
	syncRules: [],
	patterns: 0,
	ignored: [],
	outsidePaths: [],
};

export class RojoCompatibility {
	constructor(
		@FileSystemService private readonly fileReader: FileSystemService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService
	) {}

	async problemsIn(
		executable: ServerExecutable,
		projectFiles: readonly string[],
		command: string
	): Promise<Diagnostic[]> {
		const version = RojoVersion.parse(executable.version);
		if (!version) return [];
		const noRules = version.isBefore(SYNC_RULES_SINCE);
		const brokenOnWindows =
			this.environmentService.isWindows &&
			isBroken(version) &&
			command === "sourcemap";
		const noNegation = version.isBefore(NEGATION_SINCE);
		if (!noRules && !brokenOnWindows && !noNegation) return [];
		const problems: Diagnostic[] = [];
		for (const file of projectFiles) {
			const project = await this.read(file);
			if (noRules && project.syncRules.length > 0)
				problems.push(
					errorDiagnostic(
						"rojo.syncRulesUnsupported",
						{ resource: file },
						`Rojo ${version} does not read "syncRules" before ${SYNC_RULES_SINCE}, and this file has ${project.syncRules.length}. Update Rojo to ${SYNC_RULES_SINCE} or later.`
					)
				);
			const negated = noNegation
				? project.ignored.filter((glob) => glob.startsWith("!"))
				: [];
			if (negated.length > 0)
				problems.push(
					errorDiagnostic(
						"rojo.negationUnsupported",
						{ resource: file },
						`Rojo ${version} reads no "!" glob before ${NEGATION_SINCE}, and this file has ${negated.length}: ${negated.map((glob) => `"${glob}"`).join(", ")}. Update Rojo to ${NEGATION_SINCE} or later.`
					)
				);
			const outside =
				brokenOnWindows && project.patterns > 0
					? project.outsidePaths
					: [];
			if (outside.length > 0)
				problems.push(
					errorDiagnostic(
						"rojo.windowsRules",
						{ resource: file },
						`Rojo ${version} on Windows applies no sync rule or ignore glob under a "$path" outside this file's folder, and this file has ${outside.length}: ${outside.map((outsidePath) => `"${outsidePath}"`).join(", ")}. Update Rojo to ${FIXED} or later.`
					)
				);
		}
		return problems;
	}

	private async read(file: string): Promise<{
		syncRules: unknown[];
		patterns: number;
		ignored: string[];
		outsidePaths: string[];
	}> {
		let text: string;
		try {
			text = await this.fileReader.readFile(file);
		} catch {
			return NOTHING;
		}
		const parsed = RojoProject.parse(text);
		if (parsed.isErr()) return NOTHING;
		const project = parsed.value;
		const { syncRules, globIgnorePaths: ignored } = project;
		const folder = path.dirname(file);
		return {
			syncRules,
			patterns: syncRules.length + ignored.length,
			ignored,
			outsidePaths: project
				.mountedPaths()
				.map(({ path: mounted }) => rojoPathTarget(mounted))
				.filter((target) => leavesFolder(folder, target)),
		};
	}
}

const isBroken = (version: RojoVersion): boolean =>
	!version.isBefore(BROKEN) && version.isBefore(FIXED);

function leavesFolder(folder: string, target: string): boolean {
	const relative = path.relative(folder, path.resolve(folder, target));
	return (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	);
}
