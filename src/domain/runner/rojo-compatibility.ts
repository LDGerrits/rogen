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
		if (!this.windows || !version || !isBroken(version)) return [];
		const problems: Diagnostic[] = [];
		for (const file of projectFiles) {
			const outside = await this.outsidePatterns(file);
			if (outside.length > 0)
				problems.push(
					errorDiagnostic(
						"rojo.windowsRules",
						{ resource: file },
						`${executable.server.name} ${version} on Windows applies no sync rule or ignore glob that starts with "../", and this file has ${outside.length}: ${outside.map((pattern) => `"${pattern}"`).join(", ")}. ${executable.server.name} ${FIXED} fixed it: change your ${executable.server.name} pin, or update the ${executable.server.name} on the PATH.`
					)
				);
		}
		return problems;
	}

	private async outsidePatterns(file: string): Promise<string[]> {
		let project: unknown;
		try {
			project = JSON.parse(await this.fileReader.readFile(file));
		} catch {
			return [];
		}
		if (!isObject(project)) return [];
		const { globIgnorePaths, syncRules } = project;
		const patterns = [
			...(Array.isArray(globIgnorePaths) ? globIgnorePaths : []),
			...(Array.isArray(syncRules)
				? syncRules.map((rule) =>
						isObject(rule) ? rule.pattern : null
					)
				: []),
		];
		return patterns.filter(
			(pattern): pattern is string =>
				typeof pattern === "string" && pattern.startsWith("../")
		);
	}
}

const isBroken = (version: RojoVersion): boolean =>
	!version.isBefore(BROKEN) && version.isBefore(FIXED);
