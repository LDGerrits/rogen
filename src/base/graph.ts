interface Node<T> {
	readonly key: string;
	readonly data: T;
	readonly incoming: Map<string, Node<T>>;
	readonly outgoing: Map<string, Node<T>>;
}

/** A directed graph that keeps one node per key, as VS Code's `Graph` does. */
export class Graph<T> {
	private readonly nodes = new Map<string, Node<T>>();

	constructor(private readonly hashFn: (element: T) => string) {}

	roots(): Node<T>[] {
		return [...this.nodes.values()].filter(
			(node) => node.outgoing.size === 0
		);
	}

	insertEdge(from: T, to: T): void {
		const fromNode = this.lookupOrInsertNode(from);
		const toNode = this.lookupOrInsertNode(to);
		fromNode.outgoing.set(toNode.key, toNode);
		toNode.incoming.set(fromNode.key, fromNode);
	}

	removeNode(data: T): void {
		const key = this.hashFn(data);
		this.nodes.delete(key);
		for (const node of this.nodes.values()) {
			node.outgoing.delete(key);
			node.incoming.delete(key);
		}
	}

	lookupOrInsertNode(data: T): Node<T> {
		const key = this.hashFn(data);
		let node = this.nodes.get(key);
		if (!node) {
			node = {
				key,
				data,
				incoming: new Map(),
				outgoing: new Map(),
			};
			this.nodes.set(key, node);
		}
		return node;
	}

	isEmpty(): boolean {
		return this.nodes.size === 0;
	}

	/** The first cycle found, as `a -> b -> a`, or `undefined`; it tries every node, so it is for errors only. */
	findCycleSlow(): string | undefined {
		for (const [key, node] of this.nodes) {
			const seen = new Set<string>([key]);
			const cycle = this.findCycle(node, seen);
			if (cycle) return cycle;
		}
		return undefined;
	}

	toString(): string {
		return [...this.nodes.entries()]
			.map(
				([key, node]) =>
					`${key}\n\t(-> incoming)[${[...node.incoming.keys()].join(", ")}]\n\t(outgoing ->)[${[...node.outgoing.keys()].join(",")}]\n`
			)
			.join("\n");
	}

	private findCycle(node: Node<T>, seen: Set<string>): string | undefined {
		for (const [key, next] of node.outgoing) {
			if (seen.has(key)) return [...seen, key].join(" -> ");
			seen.add(key);
			const cycle = this.findCycle(next, seen);
			if (cycle) return cycle;
			seen.delete(key);
		}
		return undefined;
	}
}
