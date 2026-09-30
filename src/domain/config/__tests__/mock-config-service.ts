import { Emitter, Event } from "../../../base/event.js";
import { Result, ok } from "../../../base/result.js";
import { ConfigChangeEvent } from "../../../platform/config/config.js";
import { Target } from "../../roblox/roblox.js";
import { RojoProject } from "../../rojo/rojo-project.js";
import { AbstractConfigService } from "../abstract-config-service.js";
import { ResolvedConfig, ResolvedTemplate } from "../config.js";
import { ConfigEntry, ConfigService } from "../config-service.js";

export interface ResolvedConfigSpec {
	readonly file?: string;
	readonly name?: string;
	readonly rootDirs?: readonly string[];
	readonly routes?: Readonly<Record<string, string>>;
	readonly tags?: Readonly<Record<string, boolean>>;
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
		name: spec.name ?? "repo",
		rootDirs: spec.rootDirs ?? [],
		routes: new Map(
			Object.entries(spec.routes ?? {}).map(([key, text]) => [
				key,
				Target.parse(text, { resource: file }).unwrap(),
			])
		),
		tags: spec.tags ?? {},
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
	file = "/repo/default.rogen.json",
	entry: Partial<
		Pick<ConfigEntry, "chain" | "resolved" | "diagnostics" | "skippedTags">
	> = {}
): ConfigEntry {
	return new ConfigEntry({
		file,
		chain: [file],
		diagnostics: [],
		skippedTags: [],
		resolved: mockConfig({ file, ...resolved }),
		...entry,
	});
}

export class MockConfigService
	extends AbstractConfigService
	implements ConfigService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfig = this._register(
		new Emitter<ConfigChangeEvent>()
	);
	readonly onDidChangeConfig: Event<ConfigChangeEvent> =
		this._onDidChangeConfig.event;

	constructor(
		public configs: readonly ConfigEntry[] = [mockEntry()],
		public configFiles: readonly string[] = configs.map(
			(entry) => entry.file
		)
	) {
		super();
	}

	get files(): ReadonlySet<string> {
		return new Set(this.configs.flatMap((entry) => entry.chain));
	}

	async initialize(): Promise<Result<void, Error>> {
		return ok(undefined);
	}

	async listConfigFiles(): Promise<string[]> {
		return [...this.configFiles];
	}

	async listUnselectedConfigFiles(): Promise<string[]> {
		const selected = new Set(this.configs.map(({ file }) => file));
		return this.configFiles.filter((file) => !selected.has(file));
	}

	async readConfig(file: string): Promise<ConfigEntry> {
		return this.getConfig(file) ?? mockEntry({}, file);
	}

	async reload(_files: readonly string[]): Promise<void> {}

	fireChangeEvent(keys: string[], resource = "/repo/default.rogen.json") {
		this._onDidChangeConfig.fire(new ConfigChangeEvent(keys, resource));
	}
}
