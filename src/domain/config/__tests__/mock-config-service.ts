import { Disposable } from "../../../base/disposable.js";
import { Result, err, ok } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../../platform/diagnostics/diagnostics-error.js";
import { Target } from "../../roblox/roblox.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import { ResolvedConfig } from "../resolved-config.js";
import {
	BrokenConfigEntry,
	ConfigEntry,
	ConfigFileCheck,
	ConfigReload,
	ReloadableSelection,
	ConfigService,
	EnclosingConfigs,
	NamedProjects,
	ValidConfigEntry,
	buildableProjects,
} from "../config-service.js";

export interface ResolvedConfigSpec {
	readonly file?: string;
	readonly stem?: string;
	readonly projectStems?: readonly string[];
	readonly serveProject?: string;
	readonly name?: string;
	readonly sourcePaths?: readonly string[];
	readonly routes?: Readonly<Record<string, string>>;
	readonly ignored?: readonly string[];
	readonly project?: Readonly<Record<string, unknown>>;
	readonly syncPath?: string;
	readonly syncRulesDir?: string;
	readonly warnings?: readonly Diagnostic[];
	readonly rootFile?: string;
	readonly isPlace?: boolean;
	readonly hasPlaces?: boolean;
	readonly placePort?: number;
}

export function mockConfig(spec: ResolvedConfigSpec = {}): ResolvedConfig {
	const file = spec.file ?? "/repo/rogen.json";
	return new ResolvedConfig({
		file,
		stem: spec.stem ?? "default",
		projectStems: spec.projectStems ?? [spec.stem ?? "default"],
		serveProject: spec.serveProject ?? "default",
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
		syncRulesDir: spec.syncRulesDir,
		warnings: spec.warnings ?? [],
		rootFile: spec.rootFile,
		isPlace: spec.isPlace,
		hasPlaces: spec.hasPlaces,
		placePort: spec.placePort,
	});
}

export function mockEntry(
	resolved: ResolvedConfigSpec = {},
	file = "/repo/rogen.json",
	projects: Readonly<Record<string, ResolvedConfigSpec>> = {}
): ValidConfigEntry {
	const projectStems = ["default", ...Object.keys(projects)];
	const config = mockConfig({ file, projectStems, ...resolved });
	return {
		status: "valid",
		file,
		config,
		projects: Object.entries(projects).map(([stem, changes]) =>
			mockConfig({
				file,
				projectStems,
				serveProject: resolved.serveProject,
				...resolved,
				...changes,
				stem,
			})
		),
	};
}

export function brokenEntry(
	errors: readonly Diagnostic[],
	file = "/repo/rogen.json",
	lastValid?: ResolvedConfigSpec
): BrokenConfigEntry {
	return {
		status: "broken",
		file,
		errors,
		lastValid: lastValid && {
			config: mockConfig({ file, ...lastValid }),
			projects: [],
		},
	};
}

export function selectionOf(
	...configs: readonly ResolvedConfig[]
): MockConfigSelection {
	return new MockConfigSelection(
		configs.map((config) => ({
			status: "valid",
			file: config.file,
			config,
			projects: [],
		}))
	);
}

export class MockConfigSelection implements ReloadableSelection {
	readonly files: ReadonlySet<string>;
	readonly followedFolder = undefined;

	constructor(
		readonly entries: readonly ConfigEntry[] = [mockEntry()],
		readonly home = "/repo",
		readonly named: ReadonlyMap<string, NamedProjects> = new Map(),
		readonly notes: readonly string[] = []
	) {
		this.files = new Set(entries.map(({ file }) => file));
	}

	get configs(): ResolvedConfig[] {
		return this.entries.flatMap(buildableProjects);
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
		public home = "/repo",
		public named: ReadonlyMap<string, NamedProjects> = new Map()
	) {}

	async findEnclosing(): Promise<EnclosingConfigs | undefined> {
		return this.enclosing;
	}

	async select(): Promise<Result<ReloadableSelection, Error>> {
		return ok(new MockConfigSelection(this.entries, this.home, this.named));
	}

	async read(file: string): Promise<ConfigEntry> {
		return (
			this.entries.find((entry) => entry.file === file) ??
			mockEntry({}, file)
		);
	}

	readonly formatted: string[] = [];

	async format(file: string): Promise<Result<boolean, Diagnostic[]>> {
		this.formatted.push(file);
		return ok(false);
	}

	registerFileCheck(_check: ConfigFileCheck): Disposable {
		return { [Symbol.dispose]: () => {} };
	}
}
