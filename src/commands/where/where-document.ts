import { unescapedGlob } from "../../base/glob.js";
import { toNative } from "../../base/path.js";
import {
	FileLocation,
	requireExpressionOf,
} from "../../domain/build/build-service.js";
import {
	DiagnosticJson,
	diagnosticToJson,
	fixToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { Answer, WhereAnswers } from "./where-answers.js";

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

export function whereDocument(answers: WhereAnswers): WhereDocument {
	return {
		locations: answers.bySource().flat().map(entryOf),
		diagnostics: answers.errors.map(diagnosticToJson),
	};
}
