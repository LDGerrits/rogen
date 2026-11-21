import { failureReason } from "../../base/errors.js";
import { JsonStructure } from "../../base/json-structure.js";
import { JsoncNode, parse } from "../../base/jsonc.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	DiagnosticPosition,
	errorDiagnostic,
} from "../diagnostics/diagnostic.js";
import { FileSystemService, isMissingPath } from "../fs/file-system-service.js";
import { JsoncDocumentReader } from "../jsonc/jsonc-document-reader.js";
import { ConfigModel, ConfigSection, sectionPath } from "./config-models.js";

export interface ConfigFile {
	readonly file: string;
	readonly text: string;
	readonly model: ConfigModel;
	positionOf(section: ConfigSection): DiagnosticPosition | undefined;
	positionOfKey(key: string): DiagnosticPosition | undefined;
	overriddenKeys(section: ConfigSection): readonly {
		readonly name: string;
		readonly position: DiagnosticPosition;
	}[];
}

export type ConfigFileFailure =
	| {
			readonly kind: "unreadable";
			readonly diagnostics: readonly Diagnostic[];
			readonly missing: boolean;
			readonly reason: string;
	  }
	| {
			readonly kind: "invalid";
			readonly diagnostics: readonly Diagnostic[];
			readonly value: unknown;
	  };

export class ConfigFileReader {
	private readonly documents: JsoncDocumentReader;

	constructor(
		private readonly structure: JsonStructure,
		@FileSystemService private readonly fileReader: FileSystemService
	) {
		this.documents = new JsoncDocumentReader({
			codePrefix: "config",
			noun: "a config",
		});
	}

	async read(file: string): Promise<Result<ConfigFile, ConfigFileFailure>> {
		const text = await tryWithAsync(() => this.fileReader.readFile(file));
		if (text.isErr()) {
			const missing = isMissingPath(text.error);
			const reason = failureReason(text.error);
			return err({
				kind: "unreadable",
				missing,
				reason,
				diagnostics: [
					unreadable(
						{ resource: file, position: { line: 1, column: 1 } },
						missing ? undefined : reason
					),
				],
			});
		}
		return this.parse(text.value, file);
	}

	parse(text: string, file: string): Result<ConfigFile, ConfigFileFailure> {
		const document = this.documents.read(text, file, this.structure);
		if (document.isErr()) {
			const parsed = parse(text);
			return err({
				kind: "invalid",
				diagnostics: document.error,
				value: parsed.isOk() ? parsed.value : undefined,
			});
		}

		const { root, value } = document.value;
		return ok({
			file,
			text,
			model: new ConfigModel(value),
			positionOf: (section) => positionIn(root, section),
			positionOfKey: (key) => {
				const property =
					root.kind === "object"
						? [...root.properties]
								.reverse()
								.find(({ name }) => name === key)
						: undefined;
				return (
					property && { line: property.line, column: property.column }
				);
			},
			overriddenKeys: (section) => {
				const node = nodeAt(root, section);
				if (node?.kind !== "object") return [];
				return node.properties
					.filter(({ name }, index) =>
						node.properties
							.slice(index + 1)
							.some((later) => later.name === name)
					)
					.map(({ name, line, column }) => ({
						name,
						position: { line, column },
					}));
			},
		});
	}
}

function positionIn(
	root: JsoncNode,
	section: ConfigSection
): DiagnosticPosition | undefined {
	const node = nodeAt(root, section);
	return node && { line: node.line, column: node.column };
}

function nodeAt(
	root: JsoncNode,
	section: ConfigSection
): JsoncNode | undefined {
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

	return node;
}

const unreadable = (location: DiagnosticLocation, reason?: string) =>
	errorDiagnostic(
		"config.unreadable",
		location,
		reason === undefined
			? `the config does not exist (looked for ${location.resource}).`
			: `the config could not be read: ${reason}.`
	);
