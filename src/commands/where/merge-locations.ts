import { groupBy } from "../../base/collection.js";

export interface ConfigLines {
	readonly label: string;
	/** Each line with the source path it is about. */
	readonly lines: readonly (readonly [source: string, line: string])[];
}

/** One line per path when every config agrees; otherwise each config's line, headed by its name. Paths keep the order they were first given in, or are sorted. */
export function mergeLines(
	configs: readonly ConfigLines[],
	sorted = false
): string[] {
	const bySource = groupBy(
		configs.flatMap(({ label, lines }) =>
			lines.map(([source, line]) => ({ source, label, line }))
		),
		({ source }) => source
	);

	const sources = [...bySource.keys()];
	if (sorted) sources.sort();
	return sources.flatMap((source) => {
		const answers = bySource.get(source) ?? [];
		const [first] = answers;
		const agreed =
			answers.length === configs.length &&
			answers.every(({ line }) => line === first.line);
		return agreed || configs.length === 1
			? [first.line]
			: answers.map(({ label, line }) => `${label}: ${line}`);
	});
}
