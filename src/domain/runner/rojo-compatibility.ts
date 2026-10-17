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
const NEGATION_SINCE = RojoVersion.of("7.7.0");
const NOTHING = { syncRules: [], patterns: [], ignored: [] };

/** What the Rojo that will run can't do with the files Rogen wrote for it. */
export class RojoCompatibility {
	constructor(
		private readonly fileReader: FileReader,
		private readonly windows = isWindows
	) {}

	async problemsIn(
		executable: ServerExecutable,
		projectFiles: readonly string[]
	): Promise<Diagnostic[]> {
		const version = RojoVersion.parse(executable.version);
		if (!version) return [];
		const { name } = executable.server;
		const noRules = version.isBefore(executable.server.syncRulesSince);
		const brokenOnWindows = this.windows && isBroken(version);
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
						`${name} ${version} does not read "syncRules" before ${executable.server.syncRulesSince}, and this file has ${project.syncRules.length}. Change your ${name} pin to ${executable.server.syncRulesSince} or later, or update the ${name} on the PATH.`
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
						`${name} ${version} reads no "!" glob before ${NEGATION_SINCE}, so it ignores what this file's ${negated.length} re-include${negated.length === 1 ? "s" : ""}: ${negated.map((glob) => `"${glob}"`).join(", ")}. Change your ${name} pin to ${NEGATION_SINCE} or later, or update the ${name} on the PATH.`
					)
				);
			const outside = brokenOnWindows
				? project.patterns.filter((pattern) =>
						pattern.startsWith("../")
					)
				: [];
			if (outside.length > 0)
				problems.push(
					errorDiagnostic(
						"rojo.windowsRules",
						{ resource: file },
						`${name} ${version} on Windows applies no sync rule or ignore glob that starts with "../", and this file has ${outside.length}: ${outside.map((pattern) => `"${pattern}"`).join(", ")}. ${name} ${FIXED} fixed it: change your ${name} pin, or update the ${name} on the PATH.`
					)
				);
		}
		return problems;
	}

	private async read(file: string): Promise<{
		syncRules: unknown[];
		patterns: string[];
		ignored: string[];
	}> {
		let project: unknown;
		try {
			project = JSON.parse(await this.fileReader.readFile(file));
		} catch {
			return NOTHING;
		}
		if (!isObject(project)) return NOTHING;
		const { globIgnorePaths, syncRules } = project;
		const rules = Array.isArray(syncRules) ? syncRules : [];
		const ignored = (
			Array.isArray(globIgnorePaths) ? globIgnorePaths : []
		).filter((glob): glob is string => typeof glob === "string");
		const patterns = [
			...ignored,
			...rules
				.map((rule) => (isObject(rule) ? rule.pattern : null))
				.filter(
					(pattern): pattern is string => typeof pattern === "string"
				),
		];
		return { syncRules: rules, patterns, ignored };
	}
}

const isBroken = (version: RojoVersion): boolean =>
	!version.isBefore(BROKEN) && version.isBefore(FIXED);
