import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { RojoCompatibility } from "../rojo-compatibility.js";

const rojo = (version: string) => ({
	file: "/bin/rojo",
	version,
});

describe("RojoCompatibility", () => {
	let fs: MemoryFileSystemService;

	const compatibility = (windows: boolean) =>
		instantiationOf(
			[FileSystemService, fs],
			[
				EnvironmentService,
				Object.assign(new MockEnvironmentService("/repo"), {
					isWindows: windows,
				}),
			]
		).createInstance(RojoCompatibility);

	const written = (project: object) =>
		fs.writeFile("/repo/default.project.json", JSON.stringify(project));

	const problems = (version: string, windows = true, command = "sourcemap") =>
		compatibility(windows).problemsIn(
			rojo(version),
			["/repo/default.project.json"],
			command
		);

	const outside = {
		$className: "DataModel",
		ReplicatedStorage: {
			$className: "ReplicatedStorage",
			Shared: { $path: "../shared/src" },
		},
	};

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
	});

	it("should refuse Rojo 7.7.0 on Windows for a sourcemap of a $path outside the file's folder, with an ignore glob", async () => {
		await written({
			name: "game",
			globIgnorePaths: ["**/*.draft.luau"],
			tree: outside,
		});

		const [problem] = await problems("7.7.0");

		expect(problem.code).toBe("rojo.windowsRules");
		expect(problem.resource).toBe("/repo/default.project.json");
		expect(problem.message).toBe(
			'Rojo 7.7.0 on Windows applies no sync rule or ignore glob under a "$path" outside this file\'s folder, and this file has 1: "../shared/src". Update Rojo to 7.7.1 or later.'
		);
	});

	it("should refuse it for a sync rule, whatever its pattern", async () => {
		await written({
			name: "game",
			syncRules: [{ pattern: "*.md", use: "text" }],
			tree: { ...outside, Docs: { $path: { optional: "../docs" } } },
		});

		const [problem] = await problems("7.7.0");

		expect(problem.message).toContain('has 2: "../shared/src", "../docs"');
	});

	it.each(["serve", "build", "upload"])(
		"should not refuse Rojo 7.7.0 on Windows for %s, which it runs right",
		async (command) => {
			await written({
				name: "game",
				globIgnorePaths: ["**/*.draft.luau"],
				tree: outside,
			});

			expect(await problems("7.7.0", true, command)).toEqual([]);
		}
	);

	it.each(["7.7.1", "7.6.1", "7.5.0"])(
		"should not refuse Rojo %s on Windows",
		async (version) => {
			await written({
				name: "game",
				globIgnorePaths: ["**/*.draft.luau"],
				tree: outside,
			});

			expect(await problems(version)).toEqual([]);
		}
	);

	it("should refuse a Rojo before 7.5.0 for a file with sync rules", async () => {
		await written({
			name: "game",
			syncRules: [
				{ pattern: "*.md", use: "text" },
				{ pattern: "*.txt", use: "text" },
			],
		});

		const [problem] = await problems("7.4.4", false);

		expect(problem.code).toBe("rojo.syncRulesUnsupported");
		expect(problem.resource).toBe("/repo/default.project.json");
		expect(problem.message).toBe(
			'Rojo 7.4.4 does not read "syncRules" before 7.5.0, and this file has 2. Update Rojo to 7.5.0 or later.'
		);
	});

	it("should refuse a Rojo before 7.7.0 for a file with a ! glob", async () => {
		await written({
			name: "game",
			globIgnorePaths: ["**/*.spec.luau", "!**/Keep.spec.luau"],
		});

		const [problem] = await problems("7.6.1", false);

		expect(problem.code).toBe("rojo.negationUnsupported");
		expect(problem.resource).toBe("/repo/default.project.json");
		expect(problem.message).toBe(
			'Rojo 7.6.1 reads no "!" glob before 7.7.0, and this file has 1: "!**/Keep.spec.luau". Update Rojo to 7.7.0 or later.'
		);
	});

	it("should count the ! globs a Rojo before 7.7.0 ignores", async () => {
		await written({ name: "game", globIgnorePaths: ["!a", "!b"] });

		const [problem] = await problems("7.6.1", false);

		expect(problem.message).toContain('this file has 2: "!a", "!b".');
	});

	it("should say nothing of a Rojo whose version it can't read", async () => {
		await written({ name: "game", globIgnorePaths: ["!a"] });

		expect(await problems("unknown", false)).toEqual([]);
	});

	it.each(["7.7.0", "7.7.1"])(
		"should accept a ! glob from Rojo %s",
		async (version) => {
			await written({ name: "game", globIgnorePaths: ["!a"] });

			expect(await problems(version, false)).toEqual([]);
		}
	);

	it("should leave a Rojo before 7.5.0 alone for a file without sync rules", async () => {
		await written({ name: "game", globIgnorePaths: ["**/*.spec.luau"] });

		expect(await problems("7.4.4", false)).toEqual([]);
	});

	it("should accept sync rules from Rojo 7.5.0", async () => {
		await written({
			name: "game",
			syncRules: [{ pattern: "*.md", use: "text" }],
		});

		expect(await problems("7.5.0", false)).toEqual([]);
	});

	it("should not refuse Rojo 7.7.0 anywhere but Windows", async () => {
		await written({
			name: "game",
			globIgnorePaths: ["**/*.draft.luau"],
			tree: outside,
		});

		expect(await problems("7.7.0", false)).toEqual([]);
	});

	it("should accept a file whose paths stay in its folder", async () => {
		await written({
			name: "game",
			globIgnorePaths: ["**/*.draft.luau"],
			syncRules: [{ pattern: "**/*.md", use: "text" }],
			tree: {
				$className: "DataModel",
				ReplicatedStorage: {
					$className: "ReplicatedStorage",
					Shared: { $path: "src" },
				},
			},
		});

		expect(await problems("7.7.0")).toEqual([]);
	});

	it("should accept a $path outside the folder when the file has no sync rule or ignore glob", async () => {
		await written({ name: "game", tree: outside });

		expect(await problems("7.7.0")).toEqual([]);
	});

	it("should read a project file with a comment and a trailing comma, as Rojo does", async () => {
		await fs.writeFile(
			"/repo/default.project.json",
			`{
	// shared code lives beside the repo
	"name": "game",
	"globIgnorePaths": ["**/*.draft.luau",],
	"tree": {
		"$className": "DataModel",
		"ReplicatedStorage": { "Shared": { "$path": "../shared/src" } },
	},
}`
		);

		const [problem] = await problems("7.7.0");

		expect(problem.code).toBe("rojo.windowsRules");
		expect(problem.message).toContain('"../shared/src"');
	});

	it("should skip a file that isn't there, isn't JSON or isn't an object", async () => {
		await fs.writeFile("/repo/other.project.json", "{");
		await fs.writeFile("/repo/list.project.json", "[]");

		const found = await compatibility(true).problemsIn(
			rojo("7.7.0"),
			[
				"/repo/missing.project.json",
				"/repo/other.project.json",
				"/repo/list.project.json",
			],
			"sourcemap"
		);

		expect(found).toEqual([]);
	});
});
