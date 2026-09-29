import { BuildRecord, LeftOut, TagMatch } from "../build-record.js";
import { BuildSummary } from "../build-service.js";

export function summarizeBuild({
	config,
	roots,
	files,
	leftOut,
}: BuildRecord): BuildSummary {
	const countOf = (
		status: LeftOut["status"],
		paths: Iterable<LeftOut> = leftOut.values()
	) => [...paths].filter((why) => why.status === status).length;
	const carrying = (tag: string, tagSets: readonly (readonly TagMatch[])[]) =>
		tagSets.filter((tags) => tags.some((match) => match.tag === tag))
			.length;
	const placedTags = files.map((file) => file.tags);
	const prunedTags = [...leftOut.values()].flatMap((why) =>
		why.status === "pruned" ? [why.tags] : []
	);
	return {
		roots: roots.map((root) => ({
			rootDir: root.rootDir,
			files: root.entries.length,
			excluded: countOf("excluded", root.leftOut.values()),
			skippedLinks: countOf("skipped", root.leftOut.values()),
		})),
		routes: Object.entries(config.routes).map(([key, target]) => ({
			key,
			target,
			files: files.filter((file) => file.route === key).length,
		})),
		// Every routed file with an off tag was pruned, so off tags count those.
		tags: Object.entries(config.tags).map(([tag, on]) => ({
			tag,
			on,
			files: carrying(tag, on ? placedTags : prunedTags),
		})),
		unrouted: countOf("unrouted"),
		superseded: countOf("replaced"),
		displaced: countOf("displaced"),
	};
}
