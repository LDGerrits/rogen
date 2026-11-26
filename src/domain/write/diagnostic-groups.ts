import { plural, unlistedNote } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { WHERE_SCRIPTS_RUN } from "../roblox/roblox.js";

const LISTED_PER_CODE = 10;

interface DiagnosticGroup {
	readonly headline: (count: number) => string;
	readonly tail?: (count: number) => string;
	readonly item?: (message: string) => string;
}

const either = (count: number, one: string, many: string) =>
	count === 1 ? one : many;

const GROUPS: Readonly<Record<string, DiagnosticGroup>> = {
	"scan.sourcePathNamedAfterKey": {
		headline: (count) =>
			`${count} source ${either(count, "path is", "paths are")} named after a route key, so ${either(count, "its name routes", "their names route")} nothing:`,
	},
	"route.strayAt": {
		headline: (count) =>
			`${count} ${either(count, "name has", "names have")} an "@" that misses its route, so Rogen stops until ${either(count, "it is", "they are")} fixed:`,
	},
	"route.dotRoute": {
		headline: (count) =>
			`${count} ${either(count, "name writes", "names write")} a route key after a dot, where only "@" routes, so Rogen stops until ${either(count, "it is", "they are")} fixed:`,
	},
	"route.patternClash": {
		headline: (count) =>
			`${plural(count, "file")} ${either(count, "matches", "match")} patterns as long as each other that send ${either(count, "it", "them")} to different places:`,
		item: (message) => {
			const end = message.indexOf(" both match");
			return end > 0 ? message.slice(0, end) : message;
		},
		tail: () =>
			"Lengthen the pattern that should win, or route the file with a folder or an @ name.",
	},
	"route.serverCodeShipped": {
		headline: (count) =>
			`${plural(count, "file")} in a folder named for a server route ${either(count, "ships", "ship")} to clients:`,
	},
	"tree.deadScript": {
		headline: (count) =>
			`${plural(count, "script")} will never run where ${either(count, "it lands", "they land")}:`,
		tail: () => WHERE_SCRIPTS_RUN,
	},
	"tree.runContextTarget": {
		headline: (count) =>
			`emitLegacyScripts: false makes ${either(count, "a client script", "client scripts")} in StarterPlayerScripts or StarterCharacterScripts ${either(count, "a Script", "Scripts")} with RunContext Client, which ${either(count, "runs", "run")} twice there:`,
		tail: () =>
			"Route client scripts to ReplicatedStorage, or remove emitLegacyScripts from the config.",
	},
	"tree.mountClash": {
		headline: (count) =>
			`${count} ${either(count, "file sits", "files sit")} next to an instance of the same name that a mount of the tree holds, so Rojo builds two of ${either(count, "it", "each")}:`,
		tail: (count) =>
			`Rename one of ${either(count, "them", "each pair")}, or route outside the mounted folder.`,
	},
};

function block(
	run: readonly Diagnostic[],
	group: DiagnosticGroup,
	file: string
): Diagnostic {
	const [{ severity, code }] = run;
	const unlisted = run.length - LISTED_PER_CODE;
	return {
		severity,
		code,
		resource: file,
		message: [
			group.headline(run.length),
			...run
				.slice(0, LISTED_PER_CODE)
				.map(
					({ resource, message }) =>
						`  ${resource} (${group.item ? group.item(message) : message})`
				),
			...(unlisted > 0 ? [`  ${unlistedNote(unlisted)}`] : []),
			...(group.tail ? [group.tail(run.length)] : []),
		].join("\n"),
	};
}

function grouped(
	diagnostics: readonly Diagnostic[],
	file: string
): Diagnostic[] {
	const printed: Diagnostic[] = [];
	for (let start = 0; start < diagnostics.length;) {
		const { code } = diagnostics[start];
		let end = start + 1;
		while (end < diagnostics.length && diagnostics[end].code === code)
			end++;
		const group = GROUPS[code];
		printed.push(
			...(group
				? [block(diagnostics.slice(start, end), group, file)]
				: diagnostics.slice(start, end))
		);
		start = end;
	}
	return printed;
}

const noted = (diagnostic: Diagnostic, note: string): Diagnostic => ({
	...diagnostic,
	message: `${diagnostic.message} ${note}`,
});

function capped(diagnostics: readonly Diagnostic[]): Diagnostic[] {
	const totals = new Map<string, number>();
	const warnings = diagnostics.filter(
		({ severity }) => severity === DiagnosticSeverity.Warning
	);
	for (const { code } of warnings)
		totals.set(code, (totals.get(code) ?? 0) + 1);
	const seen = new Map<string, number>();
	return diagnostics.flatMap((diagnostic) => {
		if (diagnostic.severity !== DiagnosticSeverity.Warning)
			return [diagnostic];
		const { code } = diagnostic;
		const position = (seen.get(code) ?? 0) + 1;
		seen.set(code, position);
		if (position > LISTED_PER_CODE) return [];
		const unlisted = totals.get(code)! - LISTED_PER_CODE;
		return position === LISTED_PER_CODE && unlisted > 0
			? [noted(diagnostic, unlistedNote(unlisted))]
			: [diagnostic];
	});
}

export function diagnosticGroups(
	diagnostics: readonly Diagnostic[],
	file: string
): Diagnostic[] {
	return capped(grouped(diagnostics, file));
}
