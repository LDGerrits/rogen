import { Graph } from "../graph.js";

const graphOf = (...edges: [string, string][]) => {
	const graph = new Graph<string>((name) => name);
	for (const [from, to] of edges) graph.insertEdge(from, to);
	return graph;
};

describe("Graph", () => {
	it("should list the nodes with nothing outgoing as its leaves", () => {
		const graph = graphOf(["a", "b"], ["b", "c"]);

		expect(graph.leaves().map(({ data }) => data)).toEqual(["c"]);
	});

	it("should make a node a leaf once what it points at is removed", () => {
		const graph = graphOf(["a", "b"]);
		graph.removeNode("b");

		expect(graph.leaves().map(({ data }) => data)).toEqual(["a"]);
	});

	it("should find no cycle in a chain", () => {
		expect(graphOf(["a", "b"], ["b", "c"]).findCycleSlow()).toBeUndefined();
	});

	it("should name a cycle", () => {
		const graph = graphOf(["a", "b"], ["b", "c"], ["c", "a"]);

		expect(graph.findCycleSlow()).toBe("a -> b -> c -> a");
	});

	it("should be empty once every node is removed", () => {
		const graph = graphOf(["a", "b"]);
		graph.removeNode("a");
		graph.removeNode("b");

		expect(graph.isEmpty()).toBe(true);
	});
});
