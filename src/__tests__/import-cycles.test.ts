import fs from "fs";
import path from "path";

const SRC = path.resolve(import.meta.dirname, "..");
const IMPORT = /(?:from|import)\s+["'](\.{1,2}\/[^"']+)\.js["']/g;

function sourceFiles(dir: string): string[] {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.name !== "__tests__")
		.flatMap((entry) => {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory()) return sourceFiles(file);
			return entry.name.endsWith(".ts") ? [file] : [];
		});
}

function importsOf(file: string): string[] {
	const text = fs.readFileSync(file, "utf8");
	return [...text.matchAll(IMPORT)].map(
		([, specifier]) => `${path.resolve(path.dirname(file), specifier)}.ts`
	);
}

function findCycle(graph: ReadonlyMap<string, string[]>): string[] | undefined {
	const done = new Set<string>();
	const walking: string[] = [];

	const visit = (file: string): string[] | undefined => {
		const at = walking.indexOf(file);
		if (at >= 0) return [...walking.slice(at), file];
		if (done.has(file)) return undefined;
		walking.push(file);
		for (const next of graph.get(file) ?? []) {
			const cycle = visit(next);
			if (cycle) return cycle;
		}
		walking.pop();
		done.add(file);
		return undefined;
	};

	for (const file of graph.keys()) {
		const cycle = visit(file);
		if (cycle) return cycle;
	}
	return undefined;
}

function moduleOf(file: string): string {
	const [layer, module] = path.relative(SRC, file).split(path.sep);
	return module === undefined || module.endsWith(".ts")
		? layer
		: `${layer}/${module}`;
}

function moduleGraph(
	files: ReadonlyMap<string, string[]>
): ReadonlyMap<string, string[]> {
	const graph = new Map<string, Set<string>>();
	for (const [file, imports] of files) {
		const from = moduleOf(file);
		const edges = graph.get(from) ?? new Set<string>();
		for (const target of imports) {
			const to = moduleOf(target);
			if (to !== from) edges.add(to);
		}
		graph.set(from, edges);
	}
	return new Map([...graph].map(([from, edges]) => [from, [...edges]]));
}

describe("source imports", () => {
	it("should not form a cycle between files", () => {
		const graph = new Map(
			sourceFiles(SRC).map((file) => [file, importsOf(file)])
		);

		const cycle = findCycle(graph);

		expect(cycle?.map((file) => path.relative(SRC, file))).toBeUndefined();
	});

	it("should not form a cycle between modules", () => {
		const graph = new Map(
			sourceFiles(SRC).map((file) => [file, importsOf(file)])
		);

		expect(findCycle(moduleGraph(graph))).toBeUndefined();
	});
});
