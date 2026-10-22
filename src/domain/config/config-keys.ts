import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	replaceFixes,
} from "../../platform/diagnostics/diagnostic.js";
import { rojoKeys } from "./config-structure.js";
import { ROGEN_BLOCK, ROGEN_KEYS } from "./config.js";

const rogenKeys: readonly string[] = ROGEN_KEYS;

const advisedCompiledPath =
	"It is called compiledPath now, inside the rogen block.";

const removedFields: Readonly<Record<string, string>> = {
	modes: "Write what a mode set in <name>.rogen.json as a complete file with the keys that differ.",
	mode: "Modes are gone with \"modes\". Name a file instead, as 'rogen build <name>'.",
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

export class ConfigKeys {
	/** A removed key, a Rogen key outside the `rogen` block, or one neither Rojo's nor Rogen's, which Rojo would reject in the written file. */
	static check(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation,
		/** Whether `locationOf` points at the key, which a replacement needs, and not at its value. */
		atKey = true,
		/** The text of a top-level entry, which moving a lone Rogen key into a new block replaces. */
		entryOf: (key: string) => string | undefined = () => undefined
	): Diagnostic[] {
		const misplaced = keys.filter((key) => rogenKeys.includes(key));
		const movable =
			atKey && misplaced.length === 1 && !keys.includes(ROGEN_BLOCK);
		return ConfigKeys.unknown(
			keys,
			[...rojoKeys, ROGEN_BLOCK],
			locationOf,
			atKey,
			(key, hint) =>
				`"${key}" is not a Rojo key and not Rogen's, and Rojo rejects a project file with a key it doesn't know.${hint}`,
			(key, location) => {
				if (!misplaced.includes(key)) return undefined;
				const entry = movable ? entryOf(key) : undefined;
				return errorDiagnostic(
					"config.rogenKeyOutsideBlock",
					location,
					`"${key}" is one of Rogen's keys, and the top level of the file is Rojo's. Move it into "${ROGEN_BLOCK}": { ... }.`,
					entry === undefined
						? []
						: replaceFixes(
								location,
								entry,
								`${JSON.stringify(ROGEN_BLOCK)}: { ${entry} }`
							)
				);
			}
		);
	}

	/** A key of the `rogen` block that is not Rogen's. */
	static checkBlock(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation
	): Diagnostic[] {
		return ConfigKeys.unknown(
			keys,
			rogenKeys,
			locationOf,
			true,
			(key, hint) => `"${key}" is not one of Rogen's keys.${hint}`
		);
	}

	private static unknown(
		keys: readonly string[],
		known: readonly string[],
		locationOf: (key: string) => DiagnosticLocation,
		atKey: boolean,
		describe: (key: string, hint: string) => string,
		special: (
			key: string,
			location: DiagnosticLocation
		) => Diagnostic | undefined = () => undefined
	): Diagnostic[] {
		const errors: Diagnostic[] = [];
		for (const key of keys) {
			if (known.includes(key)) continue;
			const location = locationOf(key);
			const found =
				special(key, location) ??
				configRemovedFieldAdvice(key, location);
			if (found) {
				errors.push(found);
				continue;
			}
			const suggestion = closestMatch(
				key,
				known.filter((other) => !keys.includes(other))
			);
			errors.push(
				errorDiagnostic(
					"config.unknownField",
					location,
					describe(
						key,
						suggestion ? ` Did you mean "${suggestion}"?` : ""
					),
					suggestion && atKey
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
