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

interface VariantEntry {
	readonly variant: string;
	readonly form: string;
}

/** What every answer about a path carries, whichever way it lands. */
interface FileEntryBase {
	readonly config: string;
	readonly mode?: string;
	readonly source: string;
	readonly exists: boolean;
	readonly diagnostics: readonly DiagnosticJson[];
}

/** What a location adds to its source, by status. */
type LocationFields =
	| {
			readonly status: "placed";
			readonly instancePath: readonly string[];
			readonly require?: string;
			readonly alsoAt?: readonly (readonly string[])[];
			readonly route: string;
			readonly routeMatch: string;
			readonly variants: readonly VariantEntry[];
			readonly hoisted?: true;
	  }
	| {
			readonly status: "pruned";
			readonly variants: readonly VariantEntry[];
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
	| { readonly status: "excluded"; readonly pattern: string }
	| {
			readonly status:
				| "unrouted"
				| "skipped"
				| "outside"
				| "ignored"
				| "missing"
				| "empty";
	  };

/** One config's answer about a path. */
export type WhereFileEntry = FileEntryBase & LocationFields;

/** One config's answer about an instance no file places. */
export interface WhereInstanceEntry {
	readonly config: string;
	readonly instance: string;
	readonly status: "noFile";
	/** Where a new file for it goes. */
	readonly folders?: readonly string[];
	/** The renames that would place it. */
	readonly fixes?: readonly ReturnType<typeof fixToJson>[];
	readonly diagnostics: readonly [];
}

export type WhereEntry = WhereFileEntry | WhereInstanceEntry;

/** Where each path lands, config by config, as one JSON document. */
export interface WhereDocument {
	readonly locations: readonly WhereEntry[];
	/** Why the configs that didn't load did not answer. */
	readonly diagnostics: readonly DiagnosticJson[];
}

const variantsOf = (
	variants: readonly VariantEntry[]
): readonly VariantEntry[] =>
	variants.map(({ variant, form }) => ({ variant, form }));

/** What `location` adds to its source and status in the document. */
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
				variants: variantsOf(location.variants),
				...(location.hoisted && { hoisted: true as const }),
			};
		}
		case "pruned":
			return {
				status: "pruned",
				variants: variantsOf(location.variants),
			};
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
		case "excluded":
			return {
				status: "excluded",
				pattern: unescapedGlob(location.pattern),
			};
		case "unrouted":
		case "skipped":
		case "outside":
		case "ignored":
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
			...(answer.mode.active && { mode: answer.mode.active }),
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

/** One entry per config and path, in the order the text form lists the paths. */
export function whereDocument(answers: WhereAnswers): WhereDocument {
	return {
		locations: answers.bySource().flat().map(entryOf),
		diagnostics: answers.errors.map(diagnosticToJson),
	};
}
