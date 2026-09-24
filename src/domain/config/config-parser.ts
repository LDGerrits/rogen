import { Result, ok, err } from "../../base/result.js";
import { parseJsonc } from "../../base/jsonc.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	ConfigRegistry,
	Extensions,
} from "../../platform/config/config-registry.js";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { ConfigDiagnostics } from "./config-diagnostics.js";
import { RogenConfig } from "./config.js";
import { validateNode } from "./schema-validation.js";

export interface ParsedConfig {
	readonly config: RogenConfig;
	readonly extendsLocation?: DiagnosticLocation;
}

export function parseConfig(
	text: string,
	file: string
): Result<ParsedConfig, Diagnostic[]> {
	const { root, value, errors } = parseJsonc(text);

	if (errors.length > 0) {
		return err(
			errors.map(({ message, line, column }) =>
				ConfigDiagnostics.invalidSyntax(
					{ resource: file, position: { line, column } },
					message
				)
			)
		);
	}

	if (root?.kind !== "object") {
		return err([
			ConfigDiagnostics.notAnObject({
				resource: file,
				position: { line: 1, column: 1 },
			}),
		]);
	}

	const schema = Registry.as<ConfigRegistry>(
		Extensions.Config
	).getJsonSchema();
	const problems = validateNode(root, schema, file);
	if (problems.length > 0) return err(problems);

	const extendsValue = root.properties.find(
		(property) => property.name === "extends"
	)?.value;
	return ok({
		config: value as RogenConfig,
		extendsLocation: extendsValue && {
			resource: file,
			position: { line: extendsValue.line, column: extendsValue.column },
		},
	});
}
