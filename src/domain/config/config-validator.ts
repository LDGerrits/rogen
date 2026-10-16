import path from "path";
import { escapedGlobPrefix, ignoresAllOf } from "../../base/glob.js";
import { contains, isInside, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	isError,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { Target } from "../roblox/roblox.js";
import {
	ParsedProjectFile,
	RojoNode,
	RojoProject,
} from "../rojo/rojo-project.js";
import { SYNC_RULE_FIELDS, SyncRules } from "../rojo/sync-rules.js";
import { ProjectSource } from "./project-sources.js";
import { rogenKeys } from "./config-schema.js";
import {
	DEFAULT_SOURCE_PATH,
	PER_PLACE_KEYS,
	fieldOf,
	isDefaultProjectFile,
	isProjectFileConfig,
	sourcePathOverlap,
} from "./config.js";
import { DeclaredKeys } from "./declared-keys.js";
import { ResolvedConfig, ResolvedConfigFile } from "./resolved-config.js";

const FALLBACK_NAME = "project";

interface PlaceContext {
	readonly rootFile?: string;
	readonly placeDirs?: readonly string[];
	readonly placePort?: number;
}

const NAME_RULE = "use letters and digits only, starting with a letter";

/** Checks every rule on one project's values that doesn't need the source tree, and returns the config with its route targets parsed. */
export class ConfigValidator {
	private readonly problems = new DiagnosticCollector();
	private readonly claimed = new Map<string, string>();
	private readonly dir: string;
	private readonly routes: Readonly<Record<string, string>>;
	private readonly sourcePaths: readonly string[];
	/** How many leading source paths a place takes from the config that lists it. */
	private readonly inheritedCount: number;

	constructor(
		private readonly config: ProjectSource,
		private readonly serveProject: string,
		private readonly projectStems: readonly string[],
		warnings: readonly Diagnostic[],
		private readonly context: PlaceContext = {}
	) {
		this.problems.add(warnings);
		this.dir = path.dirname(config.file);
		this.routes = fieldOf(config.model, "routes") ?? {};
		const routed = Object.keys(this.routes).length > 0;
		const defaults = routed ? [DEFAULT_SOURCE_PATH] : [];
		const { inherited } = config;
		const inheritedPaths = inherited
			? (inherited.sourcePaths ?? defaults).map((sourcePath) =>
					path.resolve(inherited.dir, sourcePath)
				)
			: [];
		this.inheritedCount = inheritedPaths.length;
		this.sourcePaths = [
			...inheritedPaths,
			...(fieldOf(config.model, "sourcePaths") ?? defaults).map(
				(sourcePath) => path.resolve(this.dir, sourcePath)
			),
		];
	}

	/** Validates every project of one config file, the description first; `warnings` are the description's. Any project's error fails the file. */
	static validateFile(
		sources: readonly ProjectSource[],
		serveProject: string,
		warnings: readonly Diagnostic[],
		context: PlaceContext = {}
	): Result<ResolvedConfigFile, Diagnostic[]> {
		const stems = sources.map(({ stem }) => stem);
		const results = sources.map((source, index) =>
			new ConfigValidator(
				source,
				serveProject,
				stems,
				index === 0 ? warnings : source.warnings,
				context
			).validate()
		);
		const problems = results.flatMap((result) =>
			result.isErr() ? result.error : []
		);
		if (problems.length > 0) return err(uniqueDiagnostics(problems));
		const [config, ...projects] = results.map((result) => result.unwrap());
		return ok({ config, projects });
	}

	validate(): Result<ResolvedConfig, Diagnostic[]> {
		const routes = this.checkRoutes();
		const routed = Object.keys(this.routes).length > 0;
		const project = this.readProject();
		const ignored = project.globIgnorePaths.map((glob) =>
			path.posix.join(escapedGlobPrefix(toPosix(this.dir)), glob)
		);
		project.removeNodes((target) =>
			ignored.some((glob) =>
				ignoresAllOf(glob, toPosix(path.resolve(this.dir, target)))
			)
		);
		this.checkSyncRules(project);
		this.checkName(project);
		this.checkNodes(project);
		this.checkRoot(project, routed);
		this.checkSourcePaths(routed);
		this.checkPlaces();
		const syncPath = this.checkSyncPath();

		const name = project.name;
		return this.problems.toResult(
			new ResolvedConfig({
				file: this.config.file,
				stem: this.config.stem,
				projectStems: this.projectStems,
				serveProject: this.serveProject,
				projectName: name ?? (path.basename(this.dir) || FALLBACK_NAME),
				project:
					project ?? new RojoProject<ParsedProjectFile>({ tree: {} }),
				sourcePaths: this.sourcePaths,
				routes,
				ignored,
				syncPath,
				syncRulesDir: this.config.inherited?.syncRules
					? toPosix(this.config.inherited.dir)
					: undefined,
				warnings: this.problems.diagnostics.filter(
					(diagnostic) => !isError(diagnostic)
				),
				rootFile: this.context.rootFile,
				isPlace: this.context.rootFile !== undefined,
				hasPlaces: (this.context.placeDirs?.length ?? 0) > 0,
				placePort: this.context.placePort,
			})
		);
	}

	private locateKey(key: string): DiagnosticLocation {
		return {
			resource: this.config.file,
			position: this.config.positionOfKey(key),
		};
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
				([key]) => key !== "$schema" && !rogenKeys.includes(key)
			)
		);
		return new RojoProject<ParsedProjectFile>({
			...rojo,
			tree: (rojo.tree ?? { $className: "DataModel" }) as RojoNode,
		});
	}

	/** Rojo crashes on a project file of another name than `default` that has no `name`, so Rogen won't read one either. */
	private checkName(project: RojoProject<ParsedProjectFile>): void {
		const file = path.basename(this.config.file);
		if (
			project.name !== undefined ||
			!isProjectFileConfig(this.config.file) ||
			isDefaultProjectFile(this.config.file)
		)
			return;
		this.problems.error(
			"config.unnamedProjectFile",
			{ resource: this.config.file, position: { line: 1, column: 1 } },
			`${file} has no "name", and Rojo can't read a project file without one unless it is default.project.json or default.project.jsonc. Add "name".`
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
			const location = this.locate("routes", key);
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
				this.locate("sourcePaths"),
				'"sourcePaths" lists what routes scan, but the config declares no routes. Add "routes", or remove "sourcePaths".'
			);
		this.sourcePaths.forEach((sourcePath, index) => {
			const overlap = sourcePathOverlap(this.sourcePaths, index);
			if (!overlap) return;
			const location =
				index < this.inheritedCount
					? { resource: this.config.file }
					: this.locate(
							"sourcePaths",
							String(index - this.inheritedCount)
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

	private checkPlaces(): void {
		if ((this.context.placeDirs?.length ?? 0) > 0)
			for (const key of this.config.model.keys.filter((key) =>
				PER_PLACE_KEYS.includes(key)
			))
				this.problems.error(
					"config.placeSetting",
					this.locateKey(key),
					`"${key}" is set by each place, since a config that lists places is never served. Move it to the rogen.json of each place.`
				);
		for (const placeDir of this.context.placeDirs ?? []) {
			const around = this.sourcePaths.find((dir) =>
				contains(dir, placeDir)
			);
			const inside = this.sourcePaths.find((dir) =>
				contains(placeDir, dir)
			);
			if (around === undefined && inside === undefined) continue;
			this.problems.error(
				"config.placeInSourcePath",
				this.locateKey("placePaths"),
				around !== undefined
					? `the place ${placeDir} is inside the source path ${around}, so its files would belong to both. Move the place out of the source path, or the source path out of the place.`
					: `the source path ${inside} is inside the place ${placeDir}, so the place would read it as its own code too. Move the source path out of the place, or the place out of the way.`
			);
		}
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
				this.locate("syncPath"),
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
