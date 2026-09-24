import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ResolvedConfig } from "./config.js";
import { ConfigEntry, ConfigService } from "./config-service.js";

export function entryErrors(entry: ConfigEntry): Diagnostic[] {
	return entry.diagnostics.filter(
		(diagnostic) => diagnostic.severity === DiagnosticSeverity.Error
	);
}

export function requireValidConfigs(
	configService: ConfigService
): Result<ResolvedConfig[], DiagnosticsError> {
	const errors = configService.configs.flatMap(entryErrors);
	if (errors.length > 0) return err(new DiagnosticsError(errors));

	return ok(
		configService.configs.flatMap((entry) => entry.resolved ?? [])
	);
}
