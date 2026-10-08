import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { SyncTool } from "./build.js";
import { MissingInstances } from "./missing-instances.js";
import { Placer } from "./placement.js";

/** Places a config in every mode it declares but isn't built in, and warns of what a build there would lose. Rogen reads names only, so every build can check every mode. */
export class ModeCheck {
	constructor(
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {}

	check(config: ResolvedConfig): Diagnostic[] {
		return config.modes
			.filter((mode) => mode !== config.mode)
			.flatMap((mode) => this.checkMode(config, mode));
	}

	private checkMode(config: ResolvedConfig, mode: string): Diagnostic[] {
		const view = config.inMode(mode);
		if (!view) return [];
		const placed = new Placer(this.index, view, this.tools).place();
		if (placed.isErr()) {
			return placed.error.map(({ resource, position, message }) =>
				warningDiagnostic(
					"mode.clash",
					{ resource, position },
					`${message} (in mode "${mode}")`
				)
			);
		}
		return new MissingInstances(placed.value).diagnostics(true);
	}
}
