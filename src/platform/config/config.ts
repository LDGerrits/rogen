import { Event } from "../../base/event.js";

export interface IConfigChangeEvent {
	readonly source: "file" | "cli" | "default";
	readonly affectedKeys?: ReadonlySet<string>;
}

export interface IConfigService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConfiguration: Event<IConfigChangeEvent>;

	/**
	 * Fetches the value of the section. If no section is provided, returns the entire configuration object.
	 */
	getValue<T>(section?: string): T;

	/**
	 * Reloads the configuration file from disk and recalculates the merged model.
	 */
	reloadConfiguration(): Promise<void>;
}
