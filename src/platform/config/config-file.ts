import { ErrorUtils } from "../../base/errors.js";
import { JsoncNode, parseJsonc } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticPosition,
} from "../diagnostics/diagnostic.js";
import { FileSystemService } from "../fs/file-system-service.js";
import { Registry } from "../registry/registry.js";
import { ConfigFileDiagnostics } from "./config-file-diagnostics.js";
import { ConfigModel, ConfigSection, sectionPath } from "./config-models.js";
import { ConfigRegistry, Extensions } from "./config-registry.js";
import { validateNode } from "./schema-validation.js";

export interface ConfigFile {
	readonly file: string;
	readonly model: ConfigModel;
	/** Where the value at `section` starts in the file, for pointing a diagnostic at it. */
	positionOf(section: ConfigSection): DiagnosticPosition | undefined;
}

/** Never throws for a problem the user can cause; those come back as diagnostics. */
export async function readConfigFile(
	fileSystem: FileSystemService,
	file: string
): Promise<Result<ConfigFile, Diagnostic[]>> {
	let text: string;
	try {
		text = await fileSystem.readFile(file);
	} catch (error) {
		return err([
			ConfigFileDiagnostics.unreadable(
				{ resource: file, position: { line: 1, column: 1 } },
				ErrorUtils.fromUnknown(error).message
			),
		]);
	}
	return parseConfigFile(text, file);
}

function parseConfigFile(
	text: string,
	file: string
): Result<ConfigFile, Diagnostic[]> {
	const { root, value, errors } = parseJsonc(text);

	if (errors.length > 0) {
		return err(
			errors.map(({ message, line, column }) =>
				ConfigFileDiagnostics.invalidSyntax(
					{ resource: file, position: { line, column } },
					message
				)
			)
		);
	}

	if (root?.kind !== "object") {
		return err([
			ConfigFileDiagnostics.notAnObject({
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

	return ok({
		file,
		model: new ConfigModel(value as Record<string, unknown>),
		positionOf: (section) => positionIn(root, section),
	});
}

function positionIn(
	root: JsoncNode,
	section: ConfigSection
): DiagnosticPosition | undefined {
	let node: JsoncNode | undefined = root;

	for (const segment of sectionPath(section)) {
		if (node?.kind === "object") {
			node = [...node.properties]
				.reverse()
				.find((property) => property.name === segment)?.value;
		} else if (node?.kind === "array") {
			node = node.items[Number(segment)];
		} else {
			return undefined;
		}
	}

	return node && { line: node.line, column: node.column };
}
