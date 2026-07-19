import { RojoNode, RojoTree } from "./tree.js";

export class RojoProject {
	private tree: RojoTree;

	constructor(initialTree: RojoTree) {
		this.tree = structuredClone(initialTree);
	}

	getTree(): RojoTree {
		return this.tree;
	}

	getNode(path: readonly string[]): RojoNode | undefined {
		let current: RojoNode | undefined = this.tree.tree;

		for (const segment of path) {
			if (!current || typeof current !== "object") return undefined;
			current = current[segment] as RojoNode | undefined;
		}

		return current;
	}

	/**
	 * Atomic write operation. Ensures all parent folders exist, inserts/merges
	 * the leaf data, and automatically enforces domain safety rules.
	 */
	insertNode(path: readonly string[], data: Partial<RojoNode>): void {
		if (path.length === 0) return;

		const parentPath = path.slice(0, -1);
		const leafName = path[path.length - 1];

		const parent = this.ensureNode(parentPath);
		const existing = (parent[leafName] as RojoNode) || {};

		const updated = { ...existing, ...data };

		// Physical paths override Folder class
		if (updated.$path && updated.$className === "Folder") {
			delete updated.$className;
		}

		parent[leafName] = updated;
	}

	private ensureNode(path: readonly string[]): RojoNode {
		let current = this.tree.tree;

		for (const segment of path) {
			if (!current[segment]) {
				current[segment] = { $className: "Folder" };
			}
			current = current[segment] as RojoNode;
		}

		return current;
	}
}
