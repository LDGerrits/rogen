import { ErrorUtils } from "../../base/errors.js";
import { JsoncNode } from "../../base/jsonc.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	DiagnosticPosition,
	errorDiagnostic,
} from "../diagnostics/diagnostic.js";
import { FileSystemService } from "../fs/file-system-service.js";
import { JsoncDocumentReader } from "../jsonc/jsonc-document.js";
import { Registry } from "../registry/registry.js";
import { ConfigModel, ConfigSection, sectionPath } from "./config-models.js";
import { ConfigRegistry, Extensions } from "./config-registry.js";

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
	private static readonly documents = new JsoncDocumentReader({
		codePrefix: "config",
		noun: "a config",
	});

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
					unreadable(
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
		const schema = Registry.as<ConfigRegistry>(
			Extensions.Config
		).getJsonSchema();
		const document = ConfigFileReader.documents.read(text, file, schema);
		if (document.isErr()) {
			return err({ kind: "invalid", diagnostics: document.error });
		}

		const { root, value } = document.value;
		return ok({
			file,
			model: new ConfigModel(value),
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

const unreadable = (location: DiagnosticLocation, detail: string) =>
	errorDiagnostic(
		"config.unreadable",
		location,
		`the config could not be read: ${detail}.`
	);
