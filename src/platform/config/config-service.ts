import { mergeDeep } from "../../base/object.js";
import { err, ok, Result } from "../../base/result.js";
import { ConfigProvider } from "./provider.js";

export class ConfigService {
	private providers: ConfigProvider[] = [];

	addProvider(provider: ConfigProvider): this {
		this.providers.push(provider);
		return this;
	}

	async resolve(
		initialConfig: Record<string, unknown> = {}
	): Promise<Result<Record<string, unknown>, Error>> {
		let mergedRawConfig: Record<string, unknown> =
			structuredClone(initialConfig);

		for (const provider of this.providers) {
			const result = await provider.load();

			if (result.isErr()) {
				return err(
					new Error(
						`[${provider.name}] failed: ${result.error.message}`
					)
				);
			}

			mergedRawConfig = mergeDeep(mergedRawConfig, result.unwrap());
		}

		return ok(mergedRawConfig);
	}
}
