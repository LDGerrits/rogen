import path from "path";
import { isObject } from "../../base/objects.js";
import { isWindows } from "../../base/platform.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
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

/** What the Rojo that will run can't do with the files Rogen wrote for it. */
export class RojoCompatibility {
	constructor(
		private readonly fileReader: FileReader,
		private readonly windows = isWindows
	) {}

	/** `command` is the Rojo command about to run on the files: Rojo 7.7.0 on Windows gets only `sourcemap` wrong. */
	async problemsIn(
		executable: ServerExecutable,
		projectFiles: readonly string[],
		command: string
	): Promise<Diagnostic[]> {
		const version = RojoVersion.parse(executable.version);
		if (!version) return [];
		const noRules = version.isBefore(SYNC_RULES_SINCE);
		const brokenOnWindows =
			this.windows && isBroken(version) && command === "sourcemap";
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
						`Rojo ${version} does not read "syncRules" before ${SYNC_RULES_SINCE}, and this file has ${project.syncRules.length}. Change your Rojo pin to ${SYNC_RULES_SINCE} or later, or update the Rojo on the PATH.`
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
						`Rojo ${version} reads no "!" glob before ${NEGATION_SINCE}, so it ignores what this file's ${negated.length} re-include${negated.length === 1 ? "s" : ""}: ${negated.map((glob) => `"${glob}"`).join(", ")}. Change your Rojo pin to ${NEGATION_SINCE} or later, or update the Rojo on the PATH.`
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
						`Rojo ${version} on Windows applies no sync rule or ignore glob to a file under a "$path" outside this file's folder, and this file has ${outside.length}: ${outside.map((outsidePath) => `"${outsidePath}"`).join(", ")}. Rojo ${FIXED} fixed it: change your Rojo pin, or update the Rojo on the PATH.`
					)
				);
		}
		return problems;
	}

	private async read(file: string): Promise<{
		syncRules: unknown[];
		/** How many sync rules and ignore globs the file has. */
		patterns: number;
		ignored: string[];
		/** The `$path`s of the tree that lead out of the file's folder. */
		outsidePaths: string[];
	}> {
		let project: unknown;
		try {
			project = JSON.parse(await this.fileReader.readFile(file));
		} catch {
			return NOTHING;
		}
		if (!isObject(project)) return NOTHING;
		const { globIgnorePaths, syncRules, tree } = project;
		const rules = Array.isArray(syncRules) ? syncRules : [];
		const ignored = (
			Array.isArray(globIgnorePaths) ? globIgnorePaths : []
		).filter((glob): glob is string => typeof glob === "string");
		return {
			syncRules: rules,
			patterns: rules.length + ignored.length,
			ignored,
			outsidePaths: pathsOutside(path.dirname(file), tree),
		};
	}
}

const isBroken = (version: RojoVersion): boolean =>
	!version.isBefore(BROKEN) && version.isBefore(FIXED);

/** The `$path`s in a tree that point out of `folder`, in tree order. */
function pathsOutside(folder: string, node: unknown): string[] {
	if (!isObject(node)) return [];
	const { $path: target } = node;
	const own = isObject(target) ? target.optional : target;
	const outside =
		typeof own === "string" && leavesFolder(folder, own) ? [own] : [];
	return [
		...outside,
		...Object.entries(node)
			.filter(([key]) => !key.startsWith("$"))
			.flatMap(([, child]) => pathsOutside(folder, child)),
	];
}

function leavesFolder(folder: string, target: string): boolean {
	const relative = path.relative(folder, path.resolve(folder, target));
	return (
		relative === ".." ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	);
}
