import { toPosix } from "../../base/path.js";
import { ignoresPathCase } from "../../base/platform.js";
import { Diagnostic, filesOf, listsItsFiles } from "./diagnostic.js";

type Positions = Map<string, number[]>;

function add(positions: Positions, key: string, at: number): void {
	const found = positions.get(key);
	if (found) found.push(at);
	else positions.set(key, [at]);
}

function folded(path: string): string {
	return ignoresPathCase ? path.toLowerCase() : path;
}

function selfAndAncestors(path: string): string[] {
	const found = [path];
	for (
		let at = path.indexOf("/", 1);
		at !== -1;
		at = path.indexOf("/", at + 1)
	)
		found.push(path.slice(0, at));
	return found;
}

/**
 * Finds the diagnostics that `isAbout` and `reaches` hold for a path without
 * asking every diagnostic, so that a project of many files stays linear.
 */
export class DiagnosticIndex {
	private readonly named: Positions = new Map();
	private readonly within: Positions = new Map();
	private readonly covering: Positions = new Map();
	private readonly resources: Positions = new Map();

	constructor(
		private readonly diagnostics: readonly Diagnostic[],
		folderOf: (diagnostic: Diagnostic) => string
	) {
		diagnostics.forEach((diagnostic, at) => {
			for (const file of filesOf(diagnostic)) {
				add(this.named, file, at);
				for (const above of selfAndAncestors(file))
					add(this.within, folded(above), at);
			}
			if (!listsItsFiles(diagnostic))
				add(this.covering, folded(toPosix(folderOf(diagnostic))), at);
			add(this.resources, toPosix(diagnostic.resource), at);
		});
	}

	about(source: string, metaPaths: readonly string[]): Diagnostic[] {
		return this.pick([
			this.named.get(toPosix(source)),
			...metaPaths.map((meta) => this.resources.get(meta)),
		]);
	}

	reaching(target: string, metaPaths: readonly string[]): Diagnostic[] {
		const posix = toPosix(target);
		return this.pick([
			this.within.get(folded(posix)),
			...selfAndAncestors(posix).map((above) =>
				this.covering.get(folded(above))
			),
			...metaPaths.map((meta) => this.resources.get(meta)),
		]);
	}

	private pick(
		found: readonly (readonly number[] | undefined)[]
	): Diagnostic[] {
		const positions = new Set<number>();
		for (const list of found)
			for (const at of list ?? []) positions.add(at);
		return [...positions]
			.sort((a, b) => a - b)
			.map((at) => this.diagnostics[at]);
	}
}
