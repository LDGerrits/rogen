import { DeclaredKeys } from "../config/declared-keys.js";
import { InitPlan } from "./init-service.js";

const LABEL_WIDTH = 10;

function wrapped(label: string, text: string, width: number): string[] {
	const room = width - LABEL_WIDTH;
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line !== "" && line.length + 1 + word.length > room) {
			lines.push(line);
			line = word;
		} else line = line === "" ? word : `${line} ${word}`;
	}
	lines.push(line);
	return lines.map(
		(one, at) => `${(at === 0 ? label : "").padEnd(LABEL_WIDTH)}${one}`
	);
}

export class InitSummary {
	static lines(plan: InitPlan, width = 76): string[] {
		const git = [
			plan.files.some(({ fileName }) => fileName === ".gitignore")
				? ".gitignore"
				: undefined,
			plan.gitInit ? "git init" : undefined,
		].filter((one) => one !== undefined);
		const commands = [
			...(plan.scaffold ? [plan.scaffold.command.command] : []),
			...plan.commands.map(({ command }) => command),
		];
		const rows: [string, string][] = [
			...plan.summary.map(({ area, text }): [string, string] => [
				area,
				text,
			]),
			...(git.length > 0
				? [["Git", git.join(", ")] as [string, string]]
				: []),
			...(plan.moves.length > 0
				? [
						[
							"Renames",
							plan.moves
								.map(({ from, to }) => `${from} → ${to}`)
								.join(", "),
						] as [string, string],
					]
				: []),
			[
				"Files",
				plan.files.length > 0
					? plan.files
							.map(({ fileName, addition }) =>
								addition === undefined
									? fileName
									: `${fileName} (edited)`
							)
							.join(", ")
					: "none",
			],
			...(commands.length > 0
				? [["Runs", commands.join(", ")] as [string, string]]
				: []),
			...plan.warnings.map(({ message }): [string, string] => [
				"Warning",
				message,
			]),
		];
		return rows.flatMap(([area, text]) => wrapped(area, text, width));
	}

	static code(
		dirs: readonly string[],
		routes: Readonly<Record<string, string>>
	): string {
		const { [DeclaredKeys.FALLBACK_ROUTE]: rest, ...keyed } = routes;
		return `${dirs.join(", ")} → ${Object.keys(keyed).join(", ")}${rest ? `; other files to ${rest}` : ""}`;
	}
}
