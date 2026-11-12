import { ConfigDiscovery } from "../config-discovery.js";
import { DefaultFolder } from "../default-folder.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { discoveryOf } from "./config-of.js";

describe("DefaultFolder", () => {
	let fs: MemoryFileSystemService;
	let discovery: ConfigDiscovery;

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		discovery = discoveryOf(fs, new MockEnvironmentService("/repo"));
	});

	describe("while adopting", () => {
		let folder: DefaultFolder;

		beforeEach(async () => {
			await fs.writeFile("/repo/default.project.json", "{}");
			folder = new DefaultFolder("/repo", discovery, "adopting");
		});

		it("should list the project file and hold its name", async () => {
			expect(await folder.list()).toEqual(["/repo/default.project.json"]);
			expect(folder.holds("default.project.json")).toBe(true);
			expect(folder.holds("default.rogen.json")).toBe(true);
		});

		it("should keep adopting while the project file is gone", async () => {
			await fs.delete("/repo/default.project.json");

			expect(await folder.list()).toEqual([]);
			expect(folder.holds("default.project.json")).toBe(true);
			expect(folder.holds("default.project.json")).toBe(true);
		});

		it("should not change before it lists", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");

			expect(folder.holds("default.project.json")).toBe(true);
			expect(folder.holds("default.project.json")).toBe(true);
		});

		it("should turn configured for good once a default config is listed", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");

			expect(await folder.list()).toEqual(["/repo/default.rogen.json"]);
			expect(folder.holds("default.project.json")).toBe(false);
			expect(folder.holds("default.project.json")).toBe(false);

			await fs.delete("/repo/default.rogen.json");

			expect(await folder.list()).toEqual([]);
			expect(folder.holds("default.project.json")).toBe(false);
		});
	});

	describe("when configured", () => {
		it("should list the default config and never the project file", async () => {
			await fs.writeFile("/repo/default.rogen.json", "{}");
			await fs.writeFile("/repo/default.project.json", "{}");
			const folder = new DefaultFolder("/repo", discovery, "configured");

			expect(await folder.list()).toEqual(["/repo/default.rogen.json"]);

			await fs.delete("/repo/default.rogen.json");

			expect(await folder.list()).toEqual([]);
			expect(folder.holds("default.project.json")).toBe(false);
			expect(folder.holds("default.rogen.jsonc")).toBe(true);
		});
	});
});
