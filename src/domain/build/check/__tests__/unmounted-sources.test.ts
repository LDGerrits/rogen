import { toPosix } from "../../../../base/path.js";
import { DiagnosticSeverity } from "../../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../../platform/fs/memory-file-system-service.js";
import { ResolvedConfigSpec } from "../../../config/__tests__/mock-config-service.js";
import { UnmountedSources } from "../unmounted-sources.js";
import {
	abs,
	configOf,
	indexOf,
	writeFiles,
} from "../../__tests__/fixtures.js";

describe("UnmountedSources", () => {
	let fs: MemoryFileSystemService;

	const write = (...paths: string[]) => writeFiles(fs, ...paths);

	const mounting = (...targets: (string | { optional: string })[]) => ({
		tree: {
			$className: "DataModel",
			ReplicatedStorage: Object.fromEntries(
				targets.map((target, index) => [
					`Mount${index}`,
					{ $path: target },
				])
			),
		},
	});

	const warningsOf = async (overrides: ResolvedConfigSpec = {}) => {
		const config = configOf({ routes: {}, sourcePaths: [], ...overrides });
		const index = await indexOf(fs, config.indexedPaths);
		return new UnmountedSources(config, index).diagnostics();
	};

	beforeEach(() => {
		fs = new MemoryFileSystemService();
	});

	it("should warn once with the count of files nothing mounts, at the src folder", async () => {
		await write("src/A.luau", "src/deep/B.luau", "src/deep/er/C.json");

		const warnings = await warningsOf();

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({
			severity: DiagnosticSeverity.Warning,
			code: "scan.unmountedSource",
			resource: abs("src"),
		});
		expect(warnings[0].message).toContain("3 files here are mounted");
		expect(warnings[0].message).toContain('Add "routes"');
		expect(warnings[0].message).toContain('"$path"');
	});

	it("should say it of one file in the singular", async () => {
		await write("src/A.luau");

		const [warning] = await warningsOf();

		expect(warning.message).toContain("1 file here is mounted");
		expect(warning.message).toContain("never syncs it");
	});

	it("should look in the src folder beside the config", async () => {
		await write("place/src/A.luau", "src/B.luau");

		const warnings = await warningsOf({ file: abs("place/rogen.json") });

		expect(warnings).toMatchObject([{ resource: abs("place/src") }]);
		expect(warnings[0].message).toContain("1 file here");
	});

	it("should not warn when the config declares routes", async () => {
		await write("src/A.luau");

		expect(
			await warningsOf({
				routes: { "*": "ReplicatedStorage" },
				sourcePaths: [abs("src")],
			})
		).toEqual([]);
	});

	it("should not warn when a $path mounts the src folder", async () => {
		await write("src/A.luau", "src/deep/B.luau");

		expect(await warningsOf({ project: mounting("src") })).toEqual([]);
	});

	it("should not warn when an optional $path mounts the src folder", async () => {
		await write("src/A.luau");

		expect(
			await warningsOf({ project: mounting({ optional: "src" }) })
		).toEqual([]);
	});

	it("should not warn when a $path mounts a folder above the src folder", async () => {
		await write("src/A.luau");

		expect(await warningsOf({ project: mounting(".") })).toEqual([]);
	});

	it("should count only the files outside the mounted folders", async () => {
		await write("src/Mounted/A.luau", "src/Loose.luau", "src/Other/B.luau");

		const [warning] = await warningsOf({
			project: mounting("src/Mounted"),
		});

		expect(warning.message).toContain("2 files here are mounted");
	});

	it("should count a file mounted by its own $path as mounted", async () => {
		await write("src/Only.luau");

		expect(
			await warningsOf({ project: mounting("src/Only.luau") })
		).toEqual([]);
	});

	it("should not count the files that ignored globs match", async () => {
		await write("src/A.luau", "src/A.spec.luau", "src/tests/B.luau");

		const [warning] = await warningsOf({
			ignored: [
				toPosix(abs("**/*.spec.luau")),
				toPosix(abs("src/tests/**")),
			],
		});

		expect(warning.message).toContain("1 file here is mounted");
	});

	it("should not warn when ignored globs match every file", async () => {
		await write("src/A.spec.luau");

		expect(
			await warningsOf({ ignored: [toPosix(abs("**/*.spec.luau"))] })
		).toEqual([]);
	});

	it("should not warn when there is no src folder", async () => {
		await write("lib/A.luau");

		expect(await warningsOf()).toEqual([]);
	});

	it("should not count files Rojo doesn't read", async () => {
		await write("src/README.md", "src/.gitkeep", "src/Types.d.ts");

		expect(await warningsOf()).toEqual([]);
	});

	it("should not warn when the src folder holds no files", async () => {
		await fs.createDirectory(abs("src/empty/deeper"));

		expect(await warningsOf()).toEqual([]);
	});
});
