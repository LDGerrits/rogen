import {
	Diagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { IndexReader } from "../../platform/fs/index-service.js";
import { ResolvedConfig } from "../config/config.js";
import { SyncTool } from "./build.js";
import { MissingInstances } from "./missing-instances.js";
import { Placement, Placer } from "./placement.js";

/** Places a config in every mode it declares but isn't built in, and warns of what a build there would lose. Rogen reads names only, so every build can check every mode. */
export class ModeCheck {
	constructor(
		private readonly index: IndexReader,
		private readonly tools: readonly SyncTool[]
	) {}

	/** `active` is where the build placed `config`, whose own gaps are already reported. */
	check(config: ResolvedConfig, active: Placement): Diagnostic[] {
		const known = new Set(
			new MissingInstances(active).find().map(({ instance }) => instance)
		);
		return config.modes
			.filter((mode) => mode !== config.mode)
			.flatMap((mode) => this.checkMode(config, mode, known));
	}

	private checkMode(
		config: ResolvedConfig,
		mode: string,
		known: ReadonlySet<string>
	): Diagnostic[] {
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
		return new MissingInstances(placed.value).diagnostics(true, known);
	}
}
