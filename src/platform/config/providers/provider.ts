import { Result } from "../../../base/result.js";

export interface ConfigProvider {
	readonly name: string;
	load(): Promise<Result<Record<string, unknown>, Error>>;
}
