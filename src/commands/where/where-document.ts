import { unescapedGlob } from "../../base/glob.js";
import { toNative } from "../../base/path.js";
import {
	FileLocation,
	requireExpressionOf,
} from "../../domain/build/build-service.js";
import {
	OptionalKey,
	OutputShape,
} from "../../platform/output/output-shape.js";
import {
	DiagnosticJson,
	diagnosticShape,
	diagnosticToJson,
	fixShape,
	fixToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Answer, WhereAnswers } from "./where-answers.js";

const S = OutputShape;

const instancePathShape = S.array(S.string);

const fileEntryBase = {
	config: S.string,
	source: S.string,
	exists: S.boolean,
	diagnostics: S.array(diagnosticShape),
};

const fileEntryShape = (
	status: OutputShape,
	fields: Readonly<Record<string, OutputShape | OptionalKey>> = {}
) => S.object({ ...fileEntryBase, status, ...fields });

/** The document of `where --json`. */
export const whereDocumentShape = S.object({
	locations: S.array(
		S.union(
			fileEntryShape(S.enum("placed"), {
				instancePath: instancePathShape,
				require: S.optional(S.string),
				alsoAt: S.optional(S.array(instancePathShape)),
				route: S.string,
				routeMatch: S.string,
				hoisted: S.optional(S.boolean),
			}),
			fileEntryShape(S.enum("replaced"), { by: S.string }),
			fileEntryShape(S.enum("extensionCase"), { rename: S.string }),
			fileEntryShape(S.enum("blocked"), {
				blockedBy: S.object({ file: S.string, code: S.string }),
			}),
			fileEntryShape(S.enum("displaced", "mounted"), {
				node: instancePathShape,
			}),
			fileEntryShape(S.enum("ignored"), { pattern: S.string }),
			fileEntryShape(
				S.enum(
					"unrouted",
					"skipped",
					"outside",
					"notInstance",
					"missing",
					"empty"
				)
			),
			S.object({
				config: S.string,
				instance: S.string,
				status: S.enum("noFile"),
				folders: S.optional(S.array(S.string)),
				fixes: S.optional(S.array(fixShape)),
				diagnostics: S.array(diagnosticShape),
			})
		)
	),
	diagnostics: S.array(diagnosticShape),
});

interface FileEntryBase {
	readonly config: string;
	readonly source: string;
	readonly exists: boolean;
	readonly diagnostics: readonly DiagnosticJson[];
}

type LocationFields =
	| {
			readonly status: "placed";
			readonly instancePath: readonly string[];
			readonly require?: string;
			readonly alsoAt?: readonly (readonly string[])[];
			readonly route: string;
			readonly routeMatch: string;
			readonly hoisted?: true;
	  }
	| { readonly status: "replaced"; readonly by: string }
	| { readonly status: "extensionCase"; readonly rename: string }
	| {
			readonly status: "blocked";
			readonly blockedBy: {
				readonly file: string;
				readonly code: string;
			};
	  }
	| {
			readonly status: "displaced" | "mounted";
			readonly node: readonly string[];
	  }
	| { readonly status: "ignored"; readonly pattern: string }
	| {
			readonly status:
				| "unrouted"
				| "skipped"
				| "outside"
				| "notInstance"
				| "missing"
				| "empty";
	  };

export type WhereFileEntry = FileEntryBase & LocationFields;

interface WhereInstanceEntry {
	readonly config: string;
	readonly instance: string;
	readonly status: "noFile";
	readonly folders?: readonly string[];
	readonly fixes?: readonly ReturnType<typeof fixToJson>[];
	readonly diagnostics: readonly [];
}

type WhereEntry = WhereFileEntry | WhereInstanceEntry;

interface WhereDocument {
	readonly locations: readonly WhereEntry[];
	readonly diagnostics: readonly DiagnosticJson[];
}

function fieldsOf(location: FileLocation): LocationFields {
	switch (location.status) {
		case "placed": {
			const require = requireExpressionOf(location);
			return {
				status: "placed",
				instancePath: location.instancePath,
				...(require && { require }),
				...(location.alsoAt && { alsoAt: location.alsoAt }),
				route: location.route,
				routeMatch: location.routeMatch,
				...(location.hoisted && { hoisted: true as const }),
			};
		}
		case "replaced":
			return { status: "replaced", by: toNative(location.by) };
		case "extensionCase":
			return { status: "extensionCase", rename: location.rename };
		case "blocked":
			return {
				status: "blocked",
				blockedBy: {
					file: toNative(location.by.resource),
					code: location.by.code,
				},
			};
		case "displaced":
		case "mounted":
			return { status: location.status, node: location.node };
		case "ignored":
			return {
				status: "ignored",
				pattern: unescapedGlob(location.pattern),
			};
		case "unrouted":
		case "skipped":
		case "outside":
		case "notInstance":
		case "missing":
		case "empty":
			return { status: location.status };
	}
}

function entryOf(answer: Answer): WhereEntry {
	if (answer.kind === "file") {
		const { location } = answer;
		const { status, ...fields } = fieldsOf(location);
		return {
			config: answer.label,
			source: toNative(location.source),
			status,
			exists: location.exists,
			...fields,
			diagnostics: answer.diagnostics.map(diagnosticToJson),
		} as WhereFileEntry;
	}
	return {
		config: answer.label,
		instance: answer.instance,
		status: "noFile",
		...(answer.folders.length > 0 && {
			folders: answer.folders.map((folder) => toNative(folder)),
		}),
		...(answer.fixes.length > 0 && {
			fixes: answer.fixes.map(({ rename }) => fixToJson({ rename })),
		}),
		diagnostics: [],
	};
}

/** `stale` is the project files that differ from what a build would write: warnings about the answer as a whole, after the errors. */
export function whereDocument(
	answers: WhereAnswers,
	stale: readonly Diagnostic[] = []
): WhereDocument {
	return {
		locations: answers.bySource().flat().map(entryOf),
		diagnostics: [...answers.errors, ...stale].map(diagnosticToJson),
	};
}
