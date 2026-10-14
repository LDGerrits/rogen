import { Disposable } from "../../../base/disposable.js";
import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { Target } from "../../roblox/roblox.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import { ResolvedConfig } from "../config.js";
import {
	BrokenConfigEntry,
	ConfigEntry,
	ConfigFileCheck,
	ConfigReload,
	ReloadableSelection,
	ConfigService,
	EnclosingConfigs,
	ValidConfigEntry,
	buildableConfig,
} from "../config-service.js";

export interface ResolvedConfigSpec {
	readonly file?: string;
	readonly name?: string;
	readonly sourcePaths?: readonly string[];
	readonly routes?: Readonly<Record<string, string>>;
	/** Globs on absolute POSIX paths. */
	readonly ignored?: readonly string[];
	/** The Rojo project file the config describes; a bare DataModel without one. */
	readonly project?: Readonly<Record<string, unknown>>;
	readonly syncPath?: string;
	readonly warnings?: readonly Diagnostic[];
}

export function mockConfig(spec: ResolvedConfigSpec = {}): ResolvedConfig {
	const file = spec.file ?? "/repo/rogen.json";
	return new ResolvedConfig({
		file,
		projectName: spec.name ?? "repo",
		project: RojoProject.parse(
			JSON.stringify(
				spec.project ?? { tree: { $className: "DataModel" } }
			)
		).unwrap(),
		sourcePaths: spec.sourcePaths ?? [],
		routes: new Map(
			Object.entries(spec.routes ?? {}).map(([key, text]) => [
				key,
				Target.parse(text, { resource: file }).unwrap(),
			])
		),
		ignored: spec.ignored ?? [],
		syncPath: spec.syncPath,
		warnings: spec.warnings ?? [],
	});
}

export function mockEntry(
	resolved: ResolvedConfigSpec = {},
	file = "/repo/rogen.json"
): ValidConfigEntry {
	const config = mockConfig({ file, ...resolved });
	return { status: "valid", file, config };
}

/** A config whose latest load failed with `errors`; `lastValid` is what a watch keeps building. */
export function brokenEntry(
	errors: readonly Diagnostic[],
	file = "/repo/rogen.json",
	lastValid?: ResolvedConfigSpec
): BrokenConfigEntry {
	return {
		status: "broken",
		file,
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
			config,
		}))
	);
}

/** A selection of fixed entries; a reload changes nothing. */
export class MockConfigSelection implements ReloadableSelection {
	readonly files: ReadonlySet<string>;
	readonly followedFolder = undefined;

	constructor(
		readonly entries: readonly ConfigEntry[] = [mockEntry()],
		readonly home = "/repo"
	) {
		this.files = new Set(entries.map(({ file }) => file));
	}

	get configs(): ResolvedConfig[] {
		return this.entries.flatMap((entry) => buildableConfig(entry) ?? []);
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
			: ok([...this.configs]);
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

	async select(): Promise<Result<ReloadableSelection, Error>> {
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
