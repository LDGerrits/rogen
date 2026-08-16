import { mergeDeep } from "../../base/object.js";
import { err, ok, Result } from "../../base/result.js";
import { ConfigProvider } from "./config-provider.js";
import { LogService } from "../log/log-service.js";

interface LoadedConfig {
	name: string;
	config: Record<string, unknown>;
}

export class ConfigService {
	private providers: ConfigProvider[] = [];

	constructor(private readonly logService?: LogService) {}

	addProvider(provider: ConfigProvider): this {
		this.providers.push(provider);
		return this;
	}

	async resolve(
		initialConfig: Record<string, unknown> = {}
	): Promise<Result<Record<string, unknown>, Error>> {
		const loadedConfigs: LoadedConfig[] = [];

		for (const provider of this.providers) {
			const result = await provider.load();

			if (result.isErr()) {
				return err(
					new Error(
						`[${provider.name}] failed: ${result.error.message}`
					)
				);
			}

			loadedConfigs.push({
				name: provider.name,
				config: result.unwrap(),
			});
		}

		const mergedRawConfig = loadedConfigs.reduce((acc, current) => {
			if (this.logService) {
				for (const key of Object.keys(current.config)) {
					if (key in acc) {
						this.logService.trace(
							`[Config] Top-level key '${key}' overwritten by ${current.name}`
						);
					}
				}
			}
			return mergeDeep(acc, current.config);
		}, structuredClone(initialConfig));

		return ok(mergedRawConfig);
	}
}
