import type { Root, RootContent } from "mdast";

const opened = (nodes: RootContent[]): RootContent[] =>
	nodes.flatMap((node) =>
		(node.type as string) === "root"
			? opened((node as unknown as Root).children)
			: [node]
	);

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
