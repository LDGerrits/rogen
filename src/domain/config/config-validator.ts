import path from "path";
import {
	escapedGlobPrefix,
	ignoringAllOf,
	withGlobBody,
} from "../../base/glob.js";
import { contains, isInside, toPosix } from "../../base/path.js";
import { Result } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	isError,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { Target } from "../roblox/roblox.js";
import {
	NODE_FIELDS,
	ParsedProjectFile,
	RojoNode,
	RojoProject,
	projectFileName,
} from "../rojo/rojo-project.js";
import { SYNC_RULE_FIELDS, SyncRules } from "../rojo/sync-rules.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import { ROGEN_BLOCK } from "./config-schema.js";
import {
	DEFAULT_PROJECT,
	configStem,
	defaultSourcePaths,
	fieldOf,
	isDefaultProjectFile,
	isProjectFileConfig,
	sourcePathOverlap,
} from "./config.js";
import { DeclaredKeys } from "./declared-keys.js";
import { ResolvedConfig, ResolvedConfigFile } from "./resolved-config.js";

const FALLBACK_NAME = "project";

const NAME_RULE = "use letters and digits only, starting with a letter";

/** Checks every rule on one project's values that doesn't need the source tree, and returns the config with its route targets parsed. */
export class ConfigValidator {
	private readonly problems = new DiagnosticCollector();
	private readonly claimed = new Map<string, string>();
	private readonly dir: string;
	private readonly routes: Readonly<Record<string, string>>;
	private readonly sourcePaths: readonly string[];

	constructor(private readonly config: ConfigFile) {
		this.dir = path.dirname(config.file);
		this.routes = fieldOf(config.model, "routes") ?? {};
		const routed = Object.keys(this.routes).length > 0;
		const defaults = defaultSourcePaths(routed);
		this.sourcePaths = (
			fieldOf(config.model, "sourcePaths") ?? defaults
		).map((sourcePath) => path.resolve(this.dir, sourcePath));
	}

	/** Validates one config file. */
	static validateFile(
		source: ConfigFile
	): Result<ResolvedConfigFile, Diagnostic[]> {
		return new ConfigValidator(source)
			.validate()
			.map((config) => ({ config }));
	}

	validate(): Result<ResolvedConfig, Diagnostic[]> {
		const routes = this.checkRoutes();
		const routed = Object.keys(this.routes).length > 0;
		const project = this.readProject();
		const ignored = project.globIgnorePaths.map((glob) =>
			withGlobBody(glob, (body) =>
				path.posix.join(escapedGlobPrefix(toPosix(this.dir)), body)
			)
		);
		project.removeNodes(
			(target) =>
				ignoringAllOf(
					toPosix(path.resolve(this.dir, target)),
					ignored
				) !== undefined
		);
		this.checkSyncRules(project);
		this.checkName(project);
		this.checkNodes(project);
		this.checkNodeFields(project);
		this.checkRoot(project, routed);
		this.checkSourcePaths(routed);
		const syncPath = this.checkSyncPath();

		const name = project.name;
		return this.problems.toResult(
			new ResolvedConfig({
				file: this.config.file,
				projectName: name ?? (path.basename(this.dir) || FALLBACK_NAME),
				project:
					project ?? new RojoProject<ParsedProjectFile>({ tree: {} }),
				sourcePaths: this.sourcePaths,
				routes,
				ignored,
				syncPath,
				warnings: this.problems.diagnostics.filter(
					(diagnostic) => !isError(diagnostic)
				),
			})
		);
	}

	private locate(...section: string[]): DiagnosticLocation {
		return {
			resource: this.config.file,
			position: this.config.positionOf(section),
		};
	}

	private readProject(): RojoProject<ParsedProjectFile> {
		const rojo = Object.fromEntries(
			Object.entries(this.config.model.contents).filter(
				([key]) => key !== "$schema" && key !== ROGEN_BLOCK
			)
		);
		return new RojoProject<ParsedProjectFile>({
			...rojo,
			tree: (rojo.tree ?? { $className: "DataModel" }) as RojoNode,
		});
	}

	/** Rojo crashes on a project file of another name than `default` that has no `name`, so Rogen won't write or read one either. */
	private checkName(project: RojoProject<ParsedProjectFile>): void {
		const { file } = this.config;
		const target = isProjectFileConfig(file)
			? path.basename(file)
			: projectFileName(configStem(file) ?? DEFAULT_PROJECT);
		if (project.name !== undefined || isDefaultProjectFile(target)) return;
		this.problems.error(
			"config.unnamedProjectFile",
			{ resource: file, position: { line: 1, column: 1 } },
			`${path.basename(file)} has no "name", and Rojo can't read ${target} without one unless it is default.project.json or default.project.jsonc. Add "name".`
		);
	}

	private checkNodes(project: RojoProject<ParsedProjectFile>): void {
		const notNode = RojoProject.findNonNode(project.getNode([]) ?? {}, [
			"tree",
		]);
		if (!notNode) return;
		const value = this.config.model.getValue(notNode);
		this.problems.error(
			"config.wrongType",
			this.locate(...notNode),
			`"${notNode.join(".")}" must be an object.${value === null ? ' null removes nothing: to leave a mounted node out of a project, list its folder in "globIgnorePaths".' : ""}`
		);
	}

	private checkNodeFields(project: RojoProject<ParsedProjectFile>): void {
		const unknown = RojoProject.findUnknownField(
			project.getNode([]) ?? {},
			["tree"]
		);
		if (!unknown) return;
		const key = unknown[unknown.length - 1];
		const suggestion = closestMatch(key, [...NODE_FIELDS]);
		this.problems.error(
			"config.unknownField",
			this.locate(...unknown),
			`"${unknown.join(".")}" is not a field of a node, and Rojo rejects a project file with a field it doesn't know.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`
		);
	}

	private checkSyncRules(project: RojoProject<ParsedProjectFile>): void {
		for (const { index, message } of SyncRules.read(project.syncRules)
			.problems)
			this.problems.error(
				"config.invalidSyncRule",
				this.locate("syncRules", String(index)),
				`"syncRules[${index}]": ${message}`
			);
		for (const { index, field } of SyncRules.unknownFields(
			project.syncRules
		)) {
			const suggestion = closestMatch(field, SYNC_RULE_FIELDS);
			this.problems.warning(
				"config.unknownField",
				this.locate("syncRules", String(index), field),
				`"${field}" is not a field of a sync rule, so Rojo ignores it.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`
			);
		}
	}

	private checkRoutes(): Map<string, Target> {
		const targets = new Map<string, Target>();
		for (const [key, text] of Object.entries(this.routes)) {
			const location = this.locate(ROGEN_BLOCK, "routes", key);
			if (key !== DeclaredKeys.FALLBACK_ROUTE) {
				if (DeclaredKeys.isName(key)) this.claim(key, location);
				else {
					this.problems.error(
						"config.invalidRouteKey",
						location,
						`route key "${key}" is invalid: ${NAME_RULE}.`
					);
				}
			}
			const target = Target.parse(text, location);
			if (target.isErr()) this.problems.add(target.error);
			else targets.set(key, target.value);
		}
		return targets;
	}

	private checkRoot(
		project: RojoProject<ParsedProjectFile>,
		routed: boolean
	): void {
		if (!routed) return;
		const root = project.getNode([]);
		if (root?.$className === "DataModel") return;
		const described =
			root?.$className !== undefined
				? `a ${root.$className}`
				: root?.$path !== undefined
					? "a $path"
					: "a node without a class";
		this.problems.error(
			"tree.rootNotDataModel",
			this.locate("tree"),
			`routes name services, but the root of the tree is ${described}, not a DataModel. Give it "$className": "DataModel", or remove the routes.`
		);
	}

	private checkSourcePaths(routed: boolean): void {
		if (!routed && fieldOf(this.config.model, "sourcePaths") !== undefined)
			this.problems.error(
				"config.sourcePathsWithoutRoutes",
				this.locate(ROGEN_BLOCK, "sourcePaths"),
				'"sourcePaths" lists what routes scan, but the config declares no routes. Add "routes", or remove "sourcePaths".'
			);
		this.sourcePaths.forEach((sourcePath, index) => {
			const overlap = sourcePathOverlap(this.sourcePaths, index);
			if (!overlap) return;
			const location = this.locate(
				ROGEN_BLOCK,
				"sourcePaths",
				String(index)
			);
			if (overlap.kind === "duplicate") {
				this.problems.error(
					"config.duplicateSourcePath",
					location,
					`source path "${sourcePath}" is listed twice; a file under it would belong to both. Remove one.`
				);
			} else {
				this.problems.error(
					"config.nestedSourcePath",
					location,
					`source path "${sourcePath}" is inside source path "${overlap.outer}"; a file under it would belong to both. Remove one.`
				);
			}
		});
	}

	private checkSyncPath(): string | undefined {
		const written = fieldOf(this.config.model, "syncPath");
		if (written === undefined) return undefined;
		const syncPath = path.resolve(this.dir, written);
		for (const sourcePath of this.sourcePaths) {
			const inside = contains(sourcePath, syncPath);
			if (!inside && !isInside(sourcePath, syncPath)) continue;
			this.problems.error(
				"config.syncPathOverlapsSourcePath",
				this.locate(ROGEN_BLOCK, "syncPath"),
				`the sync path "${syncPath}" ${inside ? "is inside" : "contains"} source path "${sourcePath}", so Rogen would read what the tools write as source. Set "syncPath" to a folder outside the source paths.`
			);
			break;
		}
		return syncPath;
	}

	private claim(key: string, location: DiagnosticLocation): void {
		const identity = DeclaredKeys.identityOf(key);
		const other = this.claimed.get(identity);
		if (other === undefined) this.claimed.set(identity, key);
		else {
			this.problems.error(
				"config.ambiguousKey",
				location,
				`"${key}" and "${other}" differ only in the case of their first letter, so both would match the same names; keep one of them.`
			);
		}
	}
}
