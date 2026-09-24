import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { DiagnosticSeverity } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "./config.js";
import { ConfigService } from "./config-service.js";

export function requireValidConfigs(
	configService: ConfigService
): Result<ResolvedConfig[], DiagnosticsError> {
	const errors = configService.configs.flatMap((entry) =>
		entry.diagnostics.filter(
			(diagnostic) => diagnostic.severity === DiagnosticSeverity.Error
		)
	);
	if (errors.length > 0) return err(new DiagnosticsError(errors));

	return ok(
		configService.configs.flatMap((entry) => entry.resolved ?? [])
	);
}
