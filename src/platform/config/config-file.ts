import { failureReason } from "../../base/errors.js";
import { JSONSchema } from "../../base/json-schema.js";
import { JsoncNode, parse, parseJsoncSpans } from "../../base/jsonc.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	DiagnosticPosition,
	errorDiagnostic,
} from "../diagnostics/diagnostic.js";
import { FileReader, isMissingPath } from "../fs/file-system-service.js";
import { JsoncDocumentReader } from "../jsonc/jsonc-document-reader.js";
import { ConfigModel, ConfigSection, sectionPath } from "./config-models.js";

export interface ConfigFile {
	readonly file: string;
	readonly model: ConfigModel;
	/** Where the value at `section` starts in the file, for pointing a diagnostic at it. */
	positionOf(section: ConfigSection): DiagnosticPosition | undefined;
	/** Where the key starts in the object at `within`, the top level by default. */
	positionOfKey(
		key: string,
		within?: ConfigSection
	): DiagnosticPosition | undefined;
	/** The text of a top-level entry, from its key to the end of its value. */
	entryOf(key: string): string | undefined;
}

/** Why a config file didn't load: it couldn't be read at all, or what it holds is wrong. */
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
			/** What the file holds when it parses as JSON; `undefined` when it doesn't. */
			readonly value: unknown;
	  };

export class ConfigFileReader {
	private readonly documents: JsoncDocumentReader;

	constructor(
		private readonly fileReader: FileReader,
		private readonly schema: JSONSchema
	) {
		this.documents = new JsoncDocumentReader({
			codePrefix: "config",
			noun: "a config",
		});
	}

	/** Problems the user can cause come back as diagnostics, never thrown. */
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

	private parse(
		text: string,
		file: string
	): Result<ConfigFile, ConfigFileFailure> {
		const document = this.documents.read(text, file, this.schema);
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
			model: new ConfigModel(value),
			positionOf: (section) => positionIn(root, section),
			positionOfKey: (key, within = []) => {
				const parent = nodeAt(root, within);
				const property =
					parent?.kind === "object"
						? [...parent.properties]
								.reverse()
								.find(({ name }) => name === key)
						: undefined;
				return (
					property && { line: property.line, column: property.column }
				);
			},
			entryOf: (key) => {
				const spans = parseJsoncSpans(text);
				const entry = spans?.root.properties
					?.filter(({ name }) => name === key)
					.at(-1);
				return spans && entry
					? spans.text.slice(entry.start, entry.value.end)
					: undefined;
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

/** `reason` is why it could not be read; none when the file does not exist. */
const unreadable = (location: DiagnosticLocation, reason?: string) =>
	errorDiagnostic(
		"config.unreadable",
		location,
		reason === undefined
			? `the config does not exist (looked for ${location.resource}).`
			: `the config could not be read: ${reason}.`
	);
