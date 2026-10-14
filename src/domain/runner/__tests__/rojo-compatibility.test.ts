import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { RojoCompatibility } from "../rojo-compatibility.js";
import { SyncServer } from "../sync-server.js";

const rojo = (version: string) => ({
	server: SyncServer.ROJO,
	file: "/bin/rojo",
	version,
});

describe("RojoCompatibility", () => {
	let fs: MemoryFileSystemService;

	const written = (project: object) =>
		fs.writeFile("/repo/default.project.json", JSON.stringify(project));

	const problems = (version: string, windows = true) =>
		new RojoCompatibility(fs, windows).problemsIn(rojo(version), [
			"/repo/default.project.json",
		]);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
	});

	it("should refuse Rojo 7.7.0 on Windows for an ignore glob that starts with ../", async () => {
		await written({ name: "game", globIgnorePaths: ["../../src/*.md"] });

		const [problem] = await problems("7.7.0");

		expect(problem.code).toBe("rojo.windowsRules");
		expect(problem.resource).toBe("/repo/default.project.json");
		expect(problem.message).toBe(
			'Rojo 7.7.0 on Windows applies no sync rule or ignore glob that starts with "../", and this file has 1: "../../src/*.md". Rojo 7.7.1 fixed it: change your Rojo pin, or update the Rojo on the PATH.'
		);
	});

	it("should refuse it for a sync rule pattern that starts with ../", async () => {
		await written({
			name: "game",
			syncRules: [
				{ pattern: "../../docs/*.md", use: "text" },
				{ pattern: "notes/*.md", use: "text" },
			],
		});

		const [problem] = await problems("7.7.0");

		expect(problem.message).toContain('has 1: "../../docs/*.md"');
	});

	it.each(["7.7.1", "7.6.1", "7.5.0"])(
		"should not refuse Rojo %s on Windows",
		async (version) => {
			await written({ name: "game", globIgnorePaths: ["../x"] });

			expect(await problems(version)).toEqual([]);
		}
	);

	it("should not refuse Rojo 7.7.0 anywhere but Windows", async () => {
		await written({ name: "game", globIgnorePaths: ["../x"] });

		expect(await problems("7.7.0", false)).toEqual([]);
	});

	it("should accept a file whose patterns stay in its folder", async () => {
		await written({
			name: "game",
			globIgnorePaths: ["src/**/*.draft.luau"],
			syncRules: [{ pattern: "src/**/*.md", use: "text" }],
		});

		expect(await problems("7.7.0")).toEqual([]);
	});

	it("should skip a file that isn't there or isn't JSON", async () => {
		await fs.writeFile("/repo/other.project.json", "{");

		const found = await new RojoCompatibility(fs, true).problemsIn(
			rojo("7.7.0"),
			["/repo/missing.project.json", "/repo/other.project.json"]
		);

		expect(found).toEqual([]);
	});
});
