import { IFileSystem } from "../fs/file-system.js";
import { RojoNode, RojoTree } from "./tree.js";

export class RojoProject {
	private tree: RojoTree;

	constructor(initialTree: RojoTree) {
		this.tree = JSON.parse(JSON.stringify(initialTree));
	}

	getTree(): RojoTree {
		return this.tree;
	}

	insertNode(pathKeys: string[], nodeData: RojoNode): void {
		let current = this.tree.tree;

		for (let i = 0; i < pathKeys.length; i++) {
			const key = pathKeys[i];
			const isLast = i === pathKeys.length - 1;

			if (!current[key]) {
				current[key] = isLast ? {} : { $className: "Folder" };
			}

			if (isLast) {
				const existing = current[key] as RojoNode;
				current[key] = { ...existing, ...nodeData };

				if (
					nodeData.$path &&
					(current[key] as RojoNode).$className === "Folder"
				) {
					delete (current[key] as RojoNode).$className;
				}
			} else {
				current = current[key] as RojoNode;
			}
		}
	}

	async pruneDeadPaths(
		fs: IFileSystem,
		outputDir: string,
		buildDir: string
	): Promise<string[]> {
		const removed: string[] = [];
		await this.traverseAndPrune(
			this.tree.tree,
			fs,
			outputDir,
			buildDir,
			removed
		);
		return removed;
	}

	private async traverseAndPrune(
		node: RojoNode,
		fs: IFileSystem,
		outputDir: string,
		buildDir: string,
		removed: string[]
	): Promise<void> {
		for (const key of Object.keys(node)) {
			const child = node[key];

			if (typeof child === "object" && child !== null) {
				const childNode = child as RojoNode;

				if (childNode.$path) {
					// Assume paths are kept during memory build
					if (childNode.$path.startsWith(buildDir + "/")) continue;

					const exists = await fs.exists(
						`${outputDir}/${childNode.$path}`
					);
					if (!exists) {
						delete node[key];
						removed.push(childNode.$path);
						continue;
					}
				}

				await this.traverseAndPrune(
					childNode,
					fs,
					outputDir,
					buildDir,
					removed
				);
			}
		}
	}
}
