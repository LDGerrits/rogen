import { closestMatch, joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	replaceFixes,
} from "../../platform/diagnostics/diagnostic.js";
import { rojoKeys } from "./config-structure.js";
import { ROGEN_KEYS } from "./config.js";

const advisedCompiledPath = "It is called compiledPath now.";

const removedFields: Readonly<Record<string, string>> = {
	modes: "Write what a mode set in <name>.rogen.json as a complete file with the keys that differ.",
	mode: "Modes are gone with \"modes\". Name a file instead, as 'rogen write <name>'.",
	server: "rogen serve starts Rojo. To serve with Argon, run 'rogen write --watch' to keep the project files current and 'argon serve' beside it.",
	variants:
		"A file that replaces another goes in a later source path, which wins a clash.",
	conflicts:
		'Variants are gone, and so are their conflict groups. Sets that exclude each other are one complete <name>.rogen.json each, listing their own "sourcePaths".',
	extends:
		"Config files don't read each other. Write a second complete <name>.rogen.json with the keys that differ.",
	projects:
		"Write <name>.rogen.json as a complete file with the keys that differ.",
	serveProject:
		"rogen serve serves default.rogen.json, or the file you name.",
	template:
		'Write the tree inline: move the template\'s "tree" and its other keys into default.rogen.json.',
	outFile: "Rogen writes default.project.json beside default.rogen.json.",
	exclude:
		'"globIgnorePaths" keeps files out of routing, leaves out a mount of the tree that it ignores, and Rogen writes it for Rojo.',
	placePaths:
		"A place is a folder with its own complete default.rogen.json. Name the place: rogen serve places/lobby",
	rootDirs: 'It is called "sourcePaths" now.',
	syncDir: advisedCompiledPath,
	syncPath: advisedCompiledPath,
	rogen: `Rogen's keys sit at the top level, beside Rojo's: move ${joinedWithAnd(ROGEN_KEYS.map((key) => `"${key}"`))} out of the block.`,
};

/** The names people try for a Rogen key first. */
const triedNames: Readonly<Record<string, string>> = {
	outDir: "compiledPath",
	outputPath: "compiledPath",
};

/** Advice for a field Rogen once read and no longer does, in place of the unknown-key error. */
function configRemovedFieldAdvice(
	path: string,
	location: DiagnosticLocation
): Diagnostic | undefined {
	return Object.hasOwn(removedFields, path)
		? errorDiagnostic(
				"config.removedField",
				location,
				`"${path}" was removed. ${removedFields[path]}`
			)
		: undefined;
}

const knownKeys: readonly string[] = [...rojoKeys, ...ROGEN_KEYS];

export class ConfigKeys {
	/** A removed key, or one neither Rojo's nor Rogen's, which Rojo would reject in the written file. */
	static check(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation
	): Diagnostic[] {
		const errors: Diagnostic[] = [];
		for (const key of keys) {
			if (knownKeys.includes(key)) continue;
			const location = locationOf(key);
			const advice = configRemovedFieldAdvice(key, location);
			if (advice) {
				errors.push(advice);
				continue;
			}
			const open = knownKeys.filter((other) => !keys.includes(other));
			const tried = Object.hasOwn(triedNames, key)
				? triedNames[key]
				: undefined;
			const suggestion =
				tried !== undefined && open.includes(tried)
					? tried
					: closestMatch(key, open);
			errors.push(
				errorDiagnostic(
					"config.unknownField",
					location,
					`"${key}" is not a Rojo key and not Rogen's, and Rojo rejects a project file with a key it doesn't know.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
					suggestion
						? replaceFixes(
								location,
								JSON.stringify(key),
								JSON.stringify(suggestion)
							)
						: []
				)
			);
		}
		return errors;
	}
}
