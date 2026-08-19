import { ConfigChangeEvent, ConfigService, ConfigTarget } from "../config.js";
import { Emitter, Event } from "../../../base/event.js";
import { ConfigValue } from "../config-models.js";

export class MockConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfig = new Emitter<ConfigChangeEvent>();
	readonly onDidChangeConfig: Event<ConfigChangeEvent> =
		this._onDidChangeConfig.event;

	constructor(private mockData: Record<string, unknown> = {}) {}

	setMockData(data: Record<string, unknown>): void {
		this.mockData = data;
	}

	getValue<T>(section?: string): T {
		if (!section) return this.mockData as T;

		const path = section.split(".");
		let current: unknown = this.mockData;

		for (const component of path) {
			if (typeof current !== "object" || current === null) {
				return undefined as unknown as T;
			}
			current = (current as Record<string, unknown>)[component];
		}

		return current as T;
	}

	inspect<T>(section: string): ConfigValue<T> {
		const value = this.getValue<T>(section);
		return {
			defaultValue: value,
			projectValue: value,
			cliValue: undefined,
			memoryValue: undefined,
			value: value,
		};
	}

	async reloadConfig(): Promise<void> {
		return Promise.resolve();
	}

	fireChangeEvent(
		keys: string[],
		source: ConfigTarget = ConfigTarget.MEMORY
	): void {
		this._onDidChangeConfig.fire(new ConfigChangeEvent(keys, source));
	}
}
