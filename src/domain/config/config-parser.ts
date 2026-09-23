import { Result, ok, err } from "../../base/result.js";
import { parseJsonc } from "../../base/jsonc.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	ConfigRegistry,
	Extensions,
} from "../../platform/config/config-registry.js";
import { Diagnostic, Diagnostics } from "../diagnostics/diagnostic.js";
import { RogenConfig } from "./config.js";

export function parseConfig(
	text: string,
	file: string
): Result<RogenConfig, Diagnostic[]> {
	const document = parseJsonc(text);

	if (document.errors.length > 0) {
		return err(
			document.errors.map((error) =>
				Diagnostics.invalidSyntax(
					{ file, line: error.line, column: error.column },
					error.message
				)
			)
		);
	}

	if (!isObject(document.value)) {
		return err([Diagnostics.notAnObject({ file, line: 1, column: 1 })]);
	}

	const knownFields = Object.keys(
		Registry.as<ConfigRegistry>(Extensions.Config).getJsonSchema()
			.properties ?? {}
	);
	const unknownFields = document.rootProperties
		.filter((property) => !knownFields.includes(property.name))
		.map((property) =>
			Diagnostics.unknownField(
				{ file, line: property.line, column: property.column },
				property.name
			)
		);
	if (unknownFields.length > 0) return err(unknownFields);

	return ok(document.value as RogenConfig);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
