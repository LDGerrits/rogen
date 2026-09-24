import { Event } from "../../base/event.js";
import { Result } from "../../base/result.js";
import { ConfigChangeEvent } from "../../platform/config/config.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { ResolvedConfig } from "./config.js";

/** Per-invocation values that sit above every layer of a config's chain. */
export interface ConfigOverrides {
	readonly outFile?: string;
	readonly syncDir?: string;
	readonly template?: string;
	/** Tag name to whether it is on. */
	readonly tags: Readonly<Record<string, boolean>>;
}

export interface ConfigRefs {
	readonly names: readonly string[];
	readonly paths: readonly string[];
	readonly overrides?: ConfigOverrides;
}

/** A snapshot of one config; a later reload replaces it rather than mutating it. */
export interface ConfigEntry {
	readonly file: string;
	readonly chain: readonly string[];
	/** The last valid version, or `undefined` if the config has never been valid. */
	readonly resolved: ResolvedConfig | undefined;
	readonly diagnostics: readonly Diagnostic[];
}

export interface ConfigService {
	readonly _serviceBrand: undefined;
	/** Fires once per config whose resolved value changed; `resource` is the config file. */
	readonly onDidChangeConfig: Event<ConfigChangeEvent>;

	readonly configs: readonly ConfigEntry[];
	readonly files: ReadonlySet<string>;

	/** Fails only when the configs cannot be found; a broken config lands on its entry. */
	initialize(refs: ConfigRefs): Promise<Result<void, Error>>;
	/** Reloads every config that reads one of `files`. A failed reload keeps the last valid value. */
	reload(files: readonly string[]): Promise<void>;
}

export const ConfigService =
	createServiceIdentifier<ConfigService>("configService");
