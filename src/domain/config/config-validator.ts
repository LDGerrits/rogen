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
	defaultOutFileName,
	rootDirOverlap,
} from "./config.js";
import { LayeredConfig } from "./layered-config.js";

const FALLBACK_NAME = "project";
const NAME_RULE = "use letters and digits only, starting with a letter";

/** Checks every rule on a config's values that doesn't need the source tree, and hands back the config with its route targets parsed. */
export class ConfigValidator {
	private readonly problems = new DiagnosticCollector();
	private readonly rootDirs: readonly string[];
	private readonly routes: Readonly<Record<string, string>>;
	private readonly variants: Readonly<Record<string, boolean>>;
	private readonly outFile: string;

	constructor(
		private readonly layered: LayeredConfig,
		private readonly parents: readonly string[]
	) {
		const { config } = layered;
		this.rootDirs = config.getValue<string[]>("rootDirs");
		this.routes = config.getValue<Record<string, string>>("routes");
		this.variants = config.getValue<Record<string, boolean>>("variants");
		this.outFile =
			config.getValue<string | undefined>("outFile") ??
			path.join(
				path.dirname(layered.leaf.file),
				defaultOutFileName(configLabel(layered.leaf.file))
			);
	}

	validate(
		template: ResolvedTemplate | undefined
	): Result<ResolvedConfig, Diagnostic[]> {
		const { config } = this.layered;
		const dir = path.dirname(this.layered.leaf.file);
		const claimed = new Map<string, string>();

		const routes = this.checkRoutes(claimed);
		this.checkVariants(claimed);
		this.checkModes(claimed);
		this.checkOutFile(template);
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
				variants: this.variants,
				exclude: config.getValue<string[]>("exclude"),
				mode: this.layered.mode,
				defaultMode: this.layered.defaultMode,
				modeViews: this.modeViews(),
				template,
				syncDir: config.getValue<string | undefined>("syncDir"),
				outFile: this.outFile,
			})
		);
	}

	private checkRoutes(claimed: Map<string, string>): Map<string, Target> {
		const targets = new Map<string, Target>();
		for (const [key, text] of Object.entries(this.routes)) {
			const location = this.layered.locate("routes", key);
			if (key !== DeclaredKeys.FALLBACK_ROUTE) {
				if (DeclaredKeys.isName(key))
					this.claim(claimed, key, location);
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

	private checkVariants(claimed: Map<string, string>): void {
		for (const variant of Object.keys(this.variants)) {
			const location = this.layered.locate("variants", variant);
			if (!DeclaredKeys.isName(variant)) {
				this.problems.error(
					"config.invalidVariantName",
					location,
					`variant "${variant}" is invalid: ${NAME_RULE}.`
				);
			} else if (variant in this.routes) {
				this.problems.error(
					"config.variantClashesWithRoute",
					location,
					`variant "${variant}" has the same name as a route key; rename one of them.`
				);
			} else {
				this.claim(claimed, variant, location);
			}
		}
	}

	private modeViews(): Map<string, ModeView> {
		return new Map(
			this.layered.modes.map((mode) => {
				const config = this.layered.configIn(mode);
				return [
					mode,
					{
						variants:
							config.getValue<Record<string, boolean>>(
								"variants"
							),
						exclude: config.getValue<string[]>("exclude"),
						modeExclude: this.layered.modeExclude(mode),
					},
				];
			})
		);
	}

	private checkModes(claimed: Map<string, string>): void {
		const { modes, modeChoice } = this.layered;
		const chain = this.layered.configIn(undefined);
		const declared =
			chain.getValue<Record<string, boolean>>("variants") ?? {};
		for (const mode of modes) {
			const location = this.layered.locateMode(mode);
			if (!DeclaredKeys.isName(mode)) {
				this.problems.error(
					"config.invalidModeName",
					location,
					`mode "${mode}" is invalid: ${NAME_RULE}.`
				);
			} else if (mode in this.routes) {
				this.problems.error(
					"config.modeClashesWithRoute",
					location,
					`mode "${mode}" has the same name as a route key; rename one of them.`
				);
			} else if (mode in this.variants) {
				this.problems.error(
					"config.modeClashesWithVariant",
					location,
					`mode "${mode}" has the same name as a variant; a name is either a mode or a variant. Rename one of them.`
				);
			} else {
				this.claim(claimed, mode, location);
			}
			const switched = chain.getValue<
				Record<string, boolean> | undefined
			>(["modes", mode, "variants"]);
			for (const variant of Object.keys(switched ?? {})) {
				if (variant in declared) continue;
				this.problems.error(
					"config.undeclaredModeVariant",
					this.layered.locateMode(mode, "variants", variant),
					`mode "${mode}" switches variant "${variant}", which is not declared under "variants". Declare it there.`
				);
			}
		}

		const { name, source } = modeChoice;
		if (this.layered.mode !== undefined || name === undefined) return;
		if (source === "config") {
			this.problems.error(
				"config.unknownMode",
				this.layered.locate("mode"),
				`"mode" is "${name}", but ${ConfigValidator.declaredModes(modes, name)}`
			);
		} else if (source === "cli" && modes.length > 0) {
			this.problems.error(
				"config.modeNotDeclared",
				{ resource: this.layered.leaf.file },
				`--mode ${name} names no mode here: ${ConfigValidator.declaredModes(modes, name)}`
			);
		}
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

	private checkOutFile(template: ResolvedTemplate | undefined): void {
		if (template?.file !== this.outFile) return;
		const explicit = this.layered.config.inspect("outFile").source?.tier;
		this.problems.error(
			"config.outFileIsTemplate",
			explicit === "layer"
				? this.layered.locate("outFile")
				: this.layered.locate("template"),
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
	private claim(
		claimed: Map<string, string>,
		key: string,
		location: DiagnosticLocation
	): void {
		const identity = DeclaredKeys.identityOf(key);
		const other = claimed.get(identity);
		if (other === undefined) claimed.set(identity, key);
		else {
			this.problems.error(
				"config.ambiguousKey",
				location,
				`"${key}" and "${other}" differ only in the case of their first letter, so both would match the same names; keep one of them.`
			);
		}
	}
}
