import { failureReason } from "../../base/errors.js";
import { JSONSchema } from "../../base/json-schema.js";
import { JsoncNode } from "../../base/jsonc.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	DiagnosticPosition,
	errorDiagnostic,
} from "../diagnostics/diagnostic.js";
import { FileSystemService, isMissingPath } from "../fs/file-system-service.js";
import {
	JsoncDocumentReader,
	WrongTypeAdvisor,
} from "../jsonc/jsonc-document-reader.js";
import { ConfigModel, ConfigSection, sectionPath } from "./config-models.js";

export interface ConfigFile {
	readonly file: string;
	readonly model: ConfigModel;
	/** Where the value at `section` starts in the file, for pointing a diagnostic at it. */
	positionOf(section: ConfigSection): DiagnosticPosition | undefined;
}

/** Why a config file didn't load: it couldn't be read at all, or what it holds is wrong. */
export type ConfigFileFailure =
	| {
			readonly kind: "unreadable";
			readonly diagnostics: readonly Diagnostic[];
			/** The file isn't there, rather than there and unreadable. */
			readonly missing: boolean;
			/** Why, without a Node error code. */
			readonly reason: string;
	  }
	| {
			readonly kind: "invalid";
			readonly diagnostics: readonly Diagnostic[];
	  };

/** Reads config files and checks them against `schema`. */
export class ConfigFileReader {
	private readonly documents: JsoncDocumentReader;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly schema: JSONSchema,
		advise?: WrongTypeAdvisor
	) {
		this.documents = new JsoncDocumentReader(
			{ codePrefix: "config", noun: "a config" },
			advise
		);
	}

	/** Never throws for a problem the user can cause; those come back as diagnostics. */
	async read(file: string): Promise<Result<ConfigFile, ConfigFileFailure>> {
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
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

/** `reason` is why it could not be read; none when the file does not exist. */
const unreadable = (location: DiagnosticLocation, reason?: string) =>
	errorDiagnostic(
		"config.unreadable",
		location,
		reason === undefined
			? `the config does not exist (looked for ${location.resource}).`
			: `the config could not be read: ${reason}.`
	);
