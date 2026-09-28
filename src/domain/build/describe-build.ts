import path from "path";
import { BuildSummary } from "./build.js";

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** One line per root dir, route and tag, for `--verbose`. */
export function describeBuild(summary: BuildSummary, cwd: string): string[] {
	const roots = summary.roots.map(
		({ rootDir, files, excluded, skippedLinks }) =>
			[
				`${path.relative(cwd, rootDir) || "."}: ${count(files, "file")}`,
				...(excluded > 0 ? [`${excluded} excluded`] : []),
				...(skippedLinks > 0
					? [count(skippedLinks, "skipped link")]
					: []),
			].join(", ")
	);
	const routes = summary.routes.map(
		({ key, target, files }) =>
			`route ${key} -> ${target}: ${count(files, "file")}`
	);
	const tags = summary.tags.map(({ tag, on, files }) =>
		on
			? `tag ${tag} on: ${count(files, "file")}`
			: `tag ${tag} off: ${count(files, "file")} left out`
	);
	const leftOut = [
		...(summary.unrouted > 0 ? [`${summary.unrouted} unrouted`] : []),
		...(summary.superseded > 0
			? [`${summary.superseded} replaced by a file with the same name`]
			: []),
	];
	return [
		...roots,
		...routes,
		...tags,
		...(leftOut.length > 0 ? [`left out: ${leftOut.join(", ")}`] : []),
	];
}
