import { ErrorUtils } from "../../base/errors.js";
import { JsoncNode, parseJsonc } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic, DiagnosticPosition } from "../diagnostics/diagnostic.js";
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

export interface ConfigFileFailure {
	/** `unreadable` when the file couldn't be read at all, `invalid` when what it holds is wrong. */
	readonly kind: "unreadable" | "invalid";
	readonly diagnostics: readonly Diagnostic[];
}

/** Reads config files and checks them against the registered schema. */
export class ConfigFileReader {
	constructor(private readonly fileSystemService: FileSystemService) {}

	/** Never throws for a problem the user can cause; those come back as diagnostics. */
	async read(file: string): Promise<Result<ConfigFile, ConfigFileFailure>> {
		let text: string;
		try {
			text = await this.fileSystemService.readFile(file);
		} catch (error) {
			return err({
				kind: "unreadable",
				diagnostics: [
					ConfigFileDiagnostics.unreadable(
						{ resource: file, position: { line: 1, column: 1 } },
						ErrorUtils.fromUnknown(error).message
					),
				],
			});
		}
		return this.parse(text, file);
	}

	private parse(
		text: string,
		file: string
	): Result<ConfigFile, ConfigFileFailure> {
		const invalid = (diagnostics: Diagnostic[]) =>
			err<ConfigFileFailure>({ kind: "invalid", diagnostics });
		const { root, value, errors } = parseJsonc(text);

		if (errors.length > 0) {
			return invalid(
				errors.map(({ message, line, column }) =>
					ConfigFileDiagnostics.invalidSyntax(
						{ resource: file, position: { line, column } },
						message
					)
				)
			);
		}

		if (root?.kind !== "object") {
			return invalid([
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
		if (problems.length > 0) return invalid(problems);

		return ok({
			file,
			model: new ConfigModel(value as Record<string, unknown>),
			positionOf: (section) => positionIn(root, section),
		});
	}
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
