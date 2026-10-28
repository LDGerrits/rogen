import type { Root, RootContent } from "mdast";

/** The nodes, with each root that `<include>` leaves in its place opened into its children. */
const opened = (nodes: RootContent[]): RootContent[] =>
	nodes.flatMap((node) =>
		(node.type as string) === "root"
			? opened((node as unknown as Root).children)
			: [node]
	);

/**
 * Fits a Markdown file included whole, such as CHANGELOG.md, into a page: the page's title stands in for its `#` heading,
 * and a heading with nothing under it, such as an empty Unreleased, is left out.
 */
export function remarkFitIncluded() {
	return (tree: Root) => {
		const nodes = opened(tree.children).filter(
			(node) => !(node.type === "heading" && node.depth === 1)
		);
		tree.children = nodes.filter((node, index) => {
			if (node.type !== "heading") return true;
			const next = nodes[index + 1];
			return (
				next !== undefined &&
				!(next.type === "heading" && next.depth <= node.depth)
			);
		});
	};
}
