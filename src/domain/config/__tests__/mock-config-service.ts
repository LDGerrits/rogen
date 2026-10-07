import { Disposable } from "../../../base/disposable.js";
import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { Target } from "../../roblox/roblox.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import { ResolvedConfig, ResolvedTemplate } from "../config.js";
import {
	BrokenConfigEntry,
	ConfigEntry,
	ConfigFileCheck,
	ConfigReload,
	ConfigSelection,
	ConfigService,
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
	readonly variants?: Readonly<Record<string, boolean>>;
	readonly exclude?: readonly string[];
	readonly template?: {
		readonly file: string;
		readonly project: Readonly<Record<string, unknown>>;
	};
	readonly syncDir?: string;
	readonly outFile?: string;
}

export function mockConfig(spec: ResolvedConfigSpec = {}): ResolvedConfig {
	const file = spec.file ?? "/repo/default.rogen.json";
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
		variants: spec.variants ?? {},
		exclude: spec.exclude ?? [],
		template:
			spec.template &&
			new ResolvedTemplate(
				spec.template.file,
				RojoProject.parse(
					JSON.stringify(spec.template.project)
				).unwrap()
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

	constructor(readonly entries: readonly ConfigEntry[] = [mockEntry()]) {
		this.files = new Set(entries.map(({ file }) => file));
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

	constructor(public entries: readonly ConfigEntry[] = [mockEntry()]) {}

	async select(): Promise<Result<ConfigSelection, Error>> {
		return ok(new MockConfigSelection(this.entries));
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
