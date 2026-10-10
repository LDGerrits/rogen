import path from "path";
import { Result } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { Target } from "../roblox/roblox.js";
import { closestMatch, joinedWithAnd } from "../../base/strings.js";
import {
	DeclaredKeys,
	ModeView,
	ResolvedConfig,
	ResolvedTemplate,
	configLabel,
	rootDirOverlap,
} from "./config.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { LayeredConfig } from "./layered-config.js";
import { variantStates } from "./variant-switch.js";

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
		this.rootDirs = config.getValue<string[]>("rootDirs") ?? [];
		this.routes = config.getValue<Record<string, string>>("routes") ?? {};
		this.variants = layered.variants;
		this.outFile =
			config.getValue<string>("outFile") ??
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
		this.checkModes(groups);
		this.checkModeChoice();
		this.checkActiveConflicts(groups);
		this.checkOutFile();
		this.checkRootDirs();

		return this.problems.toResult(
			new ResolvedConfig({
				file: this.layered.leaf.file,
				parents: this.parents,
				skippedVariants: this.layered.skippedVariants,
				name:
					template?.project.name ||
					path.basename(dir) ||
					FALLBACK_NAME,
				rootDirs: this.rootDirs,
				routes,
				variants: variantStates(this.layered.switches),
				conflicts: groups.map(({ names }) => names),
				exclude: config.getValue<string[]>("exclude") ?? [],
				mode: this.layered.mode,
				modeViews: this.modeViews(),
				template,
				syncDir: config.getValue<string>("syncDir"),
				outFile: this.outFile,
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
					if (this.layered.modes.includes(name)) {
						valid = false;
						this.problems.error(
							"config.conflictNamesMode",
							location,
							`a conflict group names "${name}", which is a mode; modes are already exclusive, so a group names variants only.`
						);
					} else if (!this.variants.includes(name)) {
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

	private modeViews(): Map<string, ModeView> {
		return new Map(
			this.layered.modes.map((mode) => [
				mode,
				{
					variants: variantStates(this.layered.switchesIn(mode)),
					exclude:
						this.layered
							.configIn(mode)
							.getValue<string[]>("exclude") ?? [],
				},
			])
		);
	}

	private checkModes(groups: readonly ConflictGroup[]): void {
		for (const mode of this.layered.modes) {
			const location = this.layered.locateMode(mode);
			if (!DeclaredKeys.isName(mode)) {
				this.problems.error(
					"config.invalidModeName",
					location,
					`mode "${mode}" is invalid: ${NAME_RULE}.`
				);
			} else if (Object.hasOwn(this.routes, mode)) {
				this.problems.error(
					"config.modeClashesWithRoute",
					location,
					`mode "${mode}" has the same name as a route key; rename one of them.`
				);
			} else if (this.variants.includes(mode)) {
				this.problems.error(
					"config.modeClashesWithVariant",
					location,
					`mode "${mode}" has the same name as a variant; a name is either a mode or a variant. Rename one of them.`
				);
			} else {
				this.claim(mode, location);
			}
			this.checkModeVariants(mode, groups);
		}
	}

	/** A config with modes names the one to build in, and that mode is one it declares. */
	private checkModeChoice(): void {
		const { modes, modeChoice } = this.layered;
		if (modes.length > 0 && modeChoice.name === undefined) {
			this.problems.error(
				"config.modeRequired",
				this.layered.locate("modes"),
				`this config declares modes but not which one to build in. Set "mode" to ${joinedWithAnd(modes.map((mode) => `"${mode}"`))}, or pass --mode.`
			);
		}
		const written = this.layered
			.configIn(undefined)
			.getValue<string>("mode");
		if (written !== undefined && !modes.includes(written)) {
			this.problems.error(
				"config.unknownMode",
				this.layered.locate("mode"),
				`"mode" is "${written}", but ${ConfigValidator.declaredModes(modes, written)}`
			);
		}
		const { name, source } = modeChoice;
		if (
			source === "cli" &&
			name !== undefined &&
			modes.length > 0 &&
			!modes.includes(name)
		) {
			this.problems.error(
				"config.modeNotDeclared",
				{ resource: this.layered.leaf.file },
				`--mode ${name} names no mode here: ${ConfigValidator.declaredModes(modes, name)}`
			);
		}
	}

	/** A mode turns on declared variants only, and never two of one conflict group. */
	private checkModeVariants(
		mode: string,
		groups: readonly ConflictGroup[]
	): void {
		const listed = this.layered.modeVariants(mode);
		listed.forEach((variant, index) => {
			if (this.variants.includes(variant)) return;
			this.problems.error(
				"config.undeclaredModeVariant",
				this.layered.locateModeEntry(mode, "variants", index),
				`mode "${mode}" turns on variant "${variant}", which is not declared under "variants". ${this.declareHint(variant)}`
			);
		});
		for (const { names } of groups) {
			const together = names.filter((name) => listed.includes(name));
			if (together.length < 2) continue;
			this.problems.error(
				"config.modeConflict",
				this.layered.locateModeEntry(
					mode,
					"variants",
					listed.indexOf(together[1])
				),
				`mode "${mode}" turns on ${joinedWithAnd(together.map((name) => `"${name}"`))}, which conflict; a mode may turn on one of them.`
			);
		}
	}

	/** Two variants of a group are on in the active mode only when the command line added one; the mode alone is reported at the mode. */
	private checkActiveConflicts(groups: readonly ConflictGroup[]): void {
		const { switches } = this.layered;
		for (const { names, location } of groups) {
			const on = names.flatMap((name) => {
				const { on, by } = switches.get(name) ?? { on: false };
				return on && by ? [{ name, by }] : [];
			});
			if (on.length < 2 || !on.some(({ by }) => by === "cli")) continue;
			const fromMode = on.filter(({ by }) => by === "mode");
			const fromCli = on.filter(({ by }) => by === "cli");
			const mode = this.layered.mode;
			const causes =
				fromMode.length > 0
					? `: ${[
							...fromMode.map(
								({ name }) => `${name} from mode "${mode}"`
							),
							...fromCli.map(
								({ name }) => `${name} from --variant`
							),
						].join(", ")}`
					: " from --variant";
			const fix =
				fromMode.length > 0
					? `--variant never turns a variant off. Use ${[
							...fromMode.map(
								({ name }) => `--no-variant ${name}`
							),
							...fromCli.map(({ name }) => `--variant ${name}`),
						].join(" ")}.`
					: "Pass only one of them.";
			this.problems.error(
				"config.variantConflict",
				location,
				`variants ${joinedWithAnd(on.map(({ name }) => `"${name}"`))} conflict, but ${on.length === 2 ? "both" : "all"} are on${causes}. ${fix}`
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

	private static declaredModes(
		modes: readonly string[],
		asked: string
	): string {
		if (modes.length === 0) return "this config declares no modes.";
		const suggestion = closestMatch(asked, modes);
		return (
			`this config declares ${joinedWithAnd(modes.map((mode) => `"${mode}"`))}.` +
			(suggestion ? ` Did you mean "${suggestion}"?` : "")
		);
	}

	/** The output file may be no template of the chain's, since a build would overwrite it. */
	private checkOutFile(): void {
		const template = this.layered
			.templates()
			.find(({ file }) => file === this.outFile);
		if (!template) return;
		const explicit = this.layered.config.inspect("outFile").source?.tier;
		this.problems.error(
			"config.outFileIsTemplate",
			explicit === "layer"
				? this.layered.locate("outFile")
				: template.location,
			`the output file ${this.outFile} is also the template, and a build would overwrite it. Set "outFile" to another path.`
		);
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
