import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	isError,
	warningDiagnostic,
} from "./diagnostic.js";

export class DiagnosticCollector {
	private readonly collected: Diagnostic[] = [];

	get diagnostics(): readonly Diagnostic[] {
		return this.collected;
	}

	get hasErrors(): boolean {
		return this.collected.some(isError);
	}

	error(code: string, location: DiagnosticLocation, message: string): void {
		this.collected.push(errorDiagnostic(code, location, message));
	}

	warning(code: string, location: DiagnosticLocation, message: string): void {
		this.collected.push(warningDiagnostic(code, location, message));
	}

	add(diagnostics: Iterable<Diagnostic>): void {
		this.collected.push(...diagnostics);
	}

	toResult<T>(value: T): Result<T, Diagnostic[]> {
		return this.hasErrors ? err([...this.collected]) : ok(value);
	}
}
