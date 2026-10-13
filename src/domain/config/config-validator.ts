import path from "path";
import { contains, isInside, samePath } from "../../base/path.js";
import { Result } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { Target } from "../roblox/roblox.js";
import {
	closestMatch,
	joinedWithAnd,
	joinedWithOr,
} from "../../base/strings.js";
import {
	DeclaredKeys,
	ResolvedConfig,
	ResolvedTemplate,
	SERVER_NAMES,
	configLabel,
	fieldOf,
	isConfigFileName,
	isServerName,
	rootDirOverlap,
} from "./config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { LayeredConfig } from "./layered-config.js";

const FALLBACK_NAME = "project";

/** Variants of which at most one may be on, and where the config wrote the group. */
interface ConflictGroup {
	readonly names: readonly string[];
	readonly location: DiagnosticLocation;
}
const NAME_RULE = "use letters and digits only, starting with a letter";

/** Checks every rule on a config's values that doesn't need the source tree, and hands back the config with its route targets parsed. */
export class ConfigValidator {
	private readonly problems = new DiagnosticCollector();
	/** The declared keys by their identity, so a second that differs only in case is reported. */
	private readonly claimed = new Map<string, string>();
	private readonly rootDirs: readonly string[];
	private readonly routes: Readonly<Record<string, string>>;
	private readonly variants: readonly string[];
	private readonly outFile: string;

	constructor(
		private readonly layered: LayeredConfig,
		private readonly parents: readonly string[]
	) {
		const { config } = layered;
		this.rootDirs = fieldOf(config, "rootDirs") ?? [];
		this.routes = fieldOf(config, "routes") ?? {};
		this.variants = layered.variants;
		this.outFile =
			fieldOf(config, "outFile") ??
			path.join(
				path.dirname(layered.leaf.file),
				projectFileName(configLabel(layered.leaf.file))
			);
	}

	validate(
		template: ResolvedTemplate | undefined
	): Result<ResolvedConfig, Diagnostic[]> {
		const { config } = this.layered;
		const dir = path.dirname(this.layered.leaf.file);

		const routes = this.checkRoutes();
		this.checkVariants();
		const groups = this.checkConflictGroups();
		this.checkActiveConflicts(groups);
		this.checkOutFile();
		this.checkRootDirs();
		this.checkSyncDir();
		this.checkServer();

		return this.problems.toResult(
			new ResolvedConfig({
				file: this.layered.leaf.file,
				parents: this.parents,
				skippedVariants: this.layered.skippedVariants,
				projectName:
					template?.project.name ||
					path.basename(dir) ||
					FALLBACK_NAME,
				rootDirs: this.rootDirs,
				routes,
				variants: this.layered.switches,
				conflicts: groups.map(({ names }) => names),
				exclude: fieldOf(config, "exclude") ?? [],
				template,
				syncDir: fieldOf(config, "syncDir"),
				outFile: this.outFile,
				server: fieldOf(config, "server"),
			})
		);
	}

	private checkRoutes(): Map<string, Target> {
		const targets = new Map<string, Target>();
		for (const [key, text] of Object.entries(this.routes)) {
			const location = this.layered.locate("routes", key);
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

	private checkVariants(): void {
		const seen = new Set<string>();
		this.layered.config
			.entries<string>("variants")
			.forEach(({ value: variant }, index) => {
				if (seen.has(variant)) return;
				seen.add(variant);
				const location = this.layered.locateEntry("variants", index);
				if (!DeclaredKeys.isName(variant)) {
					this.problems.error(
						"config.invalidVariantName",
						location,
						`variant "${variant}" is invalid: ${NAME_RULE}.`
					);
				} else if (Object.hasOwn(this.routes, variant)) {
					this.problems.error(
						"config.variantClashesWithRoute",
						location,
						`variant "${variant}" has the same name as a route key; rename one of them.`
					);
				} else {
					this.claim(variant, location);
				}
			});
	}

	/** The groups of declared variants of which at most one may be on; a group that names anything else is reported and left out. */
	private checkConflictGroups(): ConflictGroup[] {
		const groups: ConflictGroup[] = [];
		this.layered.config
			.entries<string[]>("conflicts")
			.forEach(({ value: names }, index) => {
				const location = this.layered.locateEntry("conflicts", index);
				let valid = true;
				for (const name of names) {
					if (!this.variants.includes(name)) {
						valid = false;
						this.problems.error(
							"config.conflictUndeclaredVariant",
							location,
							`a conflict group names "${name}", which is not declared under "variants". ${this.declareHint(name)}`
						);
					}
				}
				if (valid)
					groups.push({ names: [...new Set(names)], location });
			});
		return groups;
	}

	/** Two variants of one group are on only when the command line turned both on. */
	private checkActiveConflicts(groups: readonly ConflictGroup[]): void {
		const { switches } = this.layered;
		for (const { names, location } of groups) {
			const on = names.filter((name) => switches[name]);
			if (on.length < 2) continue;
			this.problems.error(
				"config.variantConflict",
				location,
				`variants ${joinedWithAnd(on.map((name) => `"${name}"`))} conflict, but ${on.length === 2 ? "both" : "all"} are on from --variant. Pass only one of them.`
			);
		}
	}

	/** What to do about a variant that isn't declared: the one it may misspell, else declaring it. */
	private declareHint(variant: string): string {
		const suggestion = closestMatch(variant, this.variants);
		return suggestion
			? `Did you mean "${suggestion}"?`
			: "Declare it there.";
	}

	/** The output file may be no template of the chain's and no config, since a build would overwrite it. */
	private checkOutFile(): void {
		const explicit =
			this.layered.config.inspect("outFile").source?.tier === "layer";
		const here = explicit
			? this.layered.locate("outFile")
			: { resource: this.layered.leaf.file };
		const template = this.layered
			.templates()
			.find(({ file }) => samePath(file, this.outFile));
		if (template) {
			this.problems.error(
				"config.outFileIsTemplate",
				explicit ? here : template.location,
				`the output file ${this.outFile} is also the template, and a build would overwrite it. Set "outFile" to another path.`
			);
		} else if (isConfigFileName(path.basename(this.outFile))) {
			this.problems.error(
				"config.outFileIsConfig",
				here,
				`the output file ${this.outFile} is named like a config, and a build would overwrite it. Set "outFile" to a .project.json path.`
			);
		}
	}

	private checkRootDirs(): void {
		this.rootDirs.forEach((rootDir, index) => {
			const overlap = rootDirOverlap(this.rootDirs, index);
			if (!overlap) return;
			const location = this.layered.locateEntry("rootDirs", index);
			if (overlap.kind === "duplicate") {
				this.problems.error(
					"config.duplicateRootDir",
					location,
					`root dir "${rootDir}" is listed twice; a file under it would belong to both. Remove one.`
				);
			} else {
				this.problems.error(
					"config.nestedRootDir",
					location,
					`root dir "${rootDir}" is inside root dir "${overlap.outer}"; a file under it would belong to both. Remove one.`
				);
			}
		});
	}

	/** The sync dir is where tools write the code Rogen's root dirs hold, so neither may lie in the other: Rogen would read the tools' output as source. */
	private checkSyncDir(): void {
		const syncDir = fieldOf(this.layered.config, "syncDir");
		if (syncDir === undefined) return;
		const location = this.layered.locate("syncDir");
		for (const rootDir of this.rootDirs) {
			const inside = contains(rootDir, syncDir);
			if (!inside && !isInside(rootDir, syncDir)) continue;
			this.problems.error(
				"config.syncDirOverlapsRootDir",
				location,
				`the sync dir "${syncDir}" ${inside ? "is inside" : "contains"} root dir "${rootDir}", so Rogen would read what the tools write as source. Set "syncDir" to a folder outside the root dirs.`
			);
			return;
		}
	}

	/** `server` names a sync server Rogen can start. */
	private checkServer(): void {
		const server = fieldOf(this.layered.config, "server");
		if (server === undefined || isServerName(server)) return;
		const suggestion = closestMatch(server, SERVER_NAMES);
		this.problems.error(
			"config.unknownServer",
			this.layered.locate("server"),
			`"server" is "${server}", but Rogen serves with ${joinedWithOr(SERVER_NAMES.map((name) => `"${name}"`))}.` +
				(suggestion ? ` Did you mean "${suggestion}"?` : "")
		);
	}

	/** Two keys that differ only in the case of their first letter would match the same names. */
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
