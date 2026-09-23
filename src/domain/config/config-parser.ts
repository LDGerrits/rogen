import { Result, ok, err } from "../../base/result.js";
import { parseJsonc } from "../../base/jsonc.js";
import { Registry } from "../../platform/registry/registry.js";
import {
	ConfigRegistry,
	Extensions,
} from "../../platform/config/config-registry.js";
import { Diagnostic, Diagnostics } from "../diagnostics/diagnostic.js";
import { RogenConfig } from "./config.js";
import { validateNode } from "./schema-validation.js";

export function parseConfig(
	text: string,
	file: string
): Result<RogenConfig, Diagnostic[]> {
	const { root, value, errors } = parseJsonc(text);

	if (errors.length > 0) {
		return err(
			errors.map(({ message, line, column }) =>
				Diagnostics.invalidSyntax({ file, line, column }, message)
			)
		);
	}

	if (root?.kind !== "object") {
		return err([Diagnostics.notAnObject({ file, line: 1, column: 1 })]);
	}

	const schema = Registry.as<ConfigRegistry>(
		Extensions.Config
	).getJsonSchema();
	const problems = validateNode(root, schema, file);
	if (problems.length > 0) return err(problems);

	return ok(value as RogenConfig);
}
