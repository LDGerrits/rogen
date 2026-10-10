import { Disposable } from "../../../base/disposable.js";
import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { Target } from "../../roblox/roblox.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import {
	ModeView,
	ResolvedConfig,
	ResolvedTemplate,
	TemplateClash,
} from "../config.js";
import {
	BrokenConfigEntry,
	ConfigEntry,
	ConfigFileCheck,
	ConfigReload,
	ConfigSelection,
	ConfigService,
	EnclosingConfigs,
	ValidConfigEntry,
	buildableConfig,
} from "../config-service.js";

export interface ResolvedConfigSpec {
	readonly file?: string;
	readonly parents?: readonly string[];
	readonly skippedVariants?: readonly string[];
	readonly name?: string;
	readonly rootDirs?: readonly string[];
	readonly routes?: Readonly<Record<string, string>>;
	/** Every declared variant to whether it is on outside any mode, as the command line leaves it. */
	readonly variants?: Readonly<Record<string, boolean>>;
	readonly conflicts?: readonly (readonly string[])[];
	readonly exclude?: readonly string[];
	/** The variants each mode turns on and the globs it adds to the config's. */
	readonly modes?: Readonly<
		Record<
			string,
			{
				readonly variants?: readonly string[];
				readonly exclude?: readonly string[];
			}
		>
	>;
	/** The active mode; the first of `modes` when left out. */
	readonly mode?: string;
	readonly template?: {
		readonly file: string;
		readonly project: Readonly<Record<string, unknown>>;
		readonly bases?: readonly string[];
		readonly clashes?: readonly TemplateClash[];
	};
	readonly syncDir?: string;
	readonly outFile?: string;
}

export function mockConfig(spec: ResolvedConfigSpec = {}): ResolvedConfig {
	const file = spec.file ?? "/repo/default.rogen.json";
	const declared = Object.keys(spec.variants ?? {});
	const switched = (listed: readonly string[], base = false) =>
		Object.fromEntries(
			declared.map((variant) => [
				variant,
				listed.includes(variant) ||
					(base && !!spec.variants?.[variant]),
			])
		);
	const modeViews = new Map<string, ModeView>(
		Object.entries(spec.modes ?? {}).map(([mode, body]) => [
			mode,
			{
				variants: switched(body.variants ?? []),
				exclude: [...(spec.exclude ?? []), ...(body.exclude ?? [])],
			},
		])
	);
	const mode =
		modeViews.size > 0
			? (spec.mode ?? [...modeViews.keys()][0])
			: undefined;
	const view = mode === undefined ? undefined : modeViews.get(mode);
	return new ResolvedConfig({
		file,
		parents: spec.parents ?? [],
		skippedVariants: spec.skippedVariants ?? [],
		name: spec.name ?? "repo",
		rootDirs: spec.rootDirs ?? [],
		routes: new Map(
			Object.entries(spec.routes ?? {}).map(([key, text]) => [
				key,
				Target.parse(text, { resource: file }).unwrap(),
			])
		),
		variants:
			mode === undefined
				? (spec.variants ?? {})
				: switched(spec.modes?.[mode]?.variants ?? [], true),
		conflicts: spec.conflicts ?? [],
		exclude: view?.exclude ?? spec.exclude ?? [],
		mode,
		modeViews,
		template:
			spec.template &&
			new ResolvedTemplate(
				spec.template.file,
				RojoProject.parse(
					JSON.stringify(spec.template.project)
				).unwrap(),
				spec.template.bases,
				spec.template.clashes
			),
		syncDir: spec.syncDir,
		outFile: spec.outFile ?? "/repo/default.project.json",
	});
}

export function mockEntry(
	resolved: ResolvedConfigSpec = {},
	file = "/repo/default.rogen.json"
): ValidConfigEntry {
	const config = mockConfig({ file, ...resolved });
	return { status: "valid", file, parents: config.parents, config };
}

/** A config whose latest load failed with `errors`; `lastValid` is what a watch keeps building. */
export function brokenEntry(
	errors: readonly Diagnostic[],
	file = "/repo/default.rogen.json",
	lastValid?: ResolvedConfigSpec
): BrokenConfigEntry {
	return {
		status: "broken",
		file,
		parents: lastValid?.parents ?? [],
		errors,
		lastValid: lastValid && mockConfig({ file, ...lastValid }),
	};
}

/** A selection of valid `configs`. */
export function selectionOf(
	...configs: readonly ResolvedConfig[]
): MockConfigSelection {
	return new MockConfigSelection(
		configs.map((config) => ({
			status: "valid",
			file: config.file,
			parents: config.parents,
			config,
		}))
	);
}

/** A selection of fixed entries; a reload changes nothing. */
export class MockConfigSelection implements ConfigSelection {
	readonly files: ReadonlySet<string>;
	readonly directory = undefined;

	constructor(
		readonly entries: readonly ConfigEntry[] = [mockEntry()],
		readonly home = "/repo"
	) {
		this.files = new Set(entries.map(({ file }) => file));
	}

	reads(file: string): boolean {
		return this.files.has(file);
	}

	concerns(file: string): boolean {
		return this.files.has(file);
	}

	requireValid(): Result<ResolvedConfig[], DiagnosticsError> {
		const errors = this.entries.flatMap((entry) =>
			entry.status === "broken" ? entry.errors : []
		);
		return errors.length > 0
			? err(new DiagnosticsError(errors))
			: ok(this.entries.flatMap((entry) => buildableConfig(entry) ?? []));
	}

	async reload(): Promise<ConfigReload> {
		return { changed: [], notices: [] };
	}
}

export class MockConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	constructor(
		public entries: readonly ConfigEntry[] = [mockEntry()],
		public enclosing: EnclosingConfigs | undefined = undefined,
		public home = "/repo"
	) {}

	async findEnclosing(): Promise<EnclosingConfigs | undefined> {
		return this.enclosing;
	}

	async select(): Promise<Result<ConfigSelection, Error>> {
		return ok(new MockConfigSelection(this.entries, this.home));
	}

	async read(file: string): Promise<ConfigEntry> {
		return (
			this.entries.find((entry) => entry.file === file) ??
			mockEntry({}, file)
		);
	}

	registerFileCheck(_check: ConfigFileCheck): Disposable {
		return { [Symbol.dispose]: () => {} };
	}
}
