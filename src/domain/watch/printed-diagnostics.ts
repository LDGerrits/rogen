import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { renderDiagnostic } from "../../platform/diagnostics/render-diagnostic.js";

/** Remembers what was last printed per key, so a rebuild reports only what is new. */
export class PrintedDiagnostics {
	private readonly printed = new Map<string, ReadonlySet<string>>();

	/** Returns the diagnostics not printed for `key` last time, and records `diagnostics` as printed. */
	unseen(key: string, diagnostics: readonly Diagnostic[]): Diagnostic[] {
		const previous = this.printed.get(key);
		const rendered = diagnostics.map(renderDiagnostic);
		this.printed.set(key, new Set(rendered));
		return diagnostics.filter(
			(_, index) => !previous?.has(rendered[index])
		);
	}
}
