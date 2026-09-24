import { Emitter, Event } from "../../../base/event.js";
import { ConfigChangeEvent } from "../../../platform/config/config.js";
import { ResolvedConfig } from "../config.js";
import { ConfigEntry, ConfigService } from "../config-service.js";
import { Result, ok } from "../../../base/result.js";

export function mockEntry(
	resolved: Partial<ResolvedConfig> = {},
	file = "/repo/default.rogen.json"
): ConfigEntry {
	return {
		file,
		chain: [file],
		diagnostics: [],
		resolved: {
			rootDirs: [],
			routes: {},
			tags: {},
			exclude: [],
			outFile: "/repo/default.project.json",
			...resolved,
		},
	};
}

export class MockConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfig = new Emitter<ConfigChangeEvent>();
	readonly onDidChangeConfig: Event<ConfigChangeEvent> =
		this._onDidChangeConfig.event;

	constructor(public configs: readonly ConfigEntry[] = [mockEntry()]) {}

	get files(): ReadonlySet<string> {
		return new Set(this.configs.flatMap((entry) => entry.chain));
	}

	async initialize(): Promise<Result<void, Error>> {
		return ok(undefined);
	}

	async reload(_files: readonly string[]): Promise<void> {}

	fireChangeEvent(keys: string[], resource = "/repo/default.rogen.json") {
		this._onDidChangeConfig.fire(new ConfigChangeEvent(keys, resource));
	}
}
