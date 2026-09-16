import { getVersion } from "../get-version.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";

describe("getVersion", () => {
	it("should read the version from package.json in the starting directory", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(
			"/app/package.json",
			JSON.stringify({ version: "1.2.3" })
		);

		expect(await getVersion(fs, "/app")).toBe("1.2.3");
	});

	it("should walk up parent directories to find package.json", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(
			"/app/package.json",
			JSON.stringify({ version: "1.2.3" })
		);

		expect(await getVersion(fs, "/app/dist/commands/version")).toBe(
			"1.2.3"
		);
	});

	it("should check the filesystem root itself, not just its ancestors", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(
			"/package.json",
			JSON.stringify({ version: "4.5.6" })
		);

		expect(await getVersion(fs, "/a/b")).toBe("4.5.6");
	});

	it("should return 'unknown' when no package.json is found anywhere", async () => {
		const fs = new MemoryFileSystemService();

		expect(await getVersion(fs, "/a/b/c")).toBe("unknown");
	});

	it("should return 'unknown' when the found package.json has no version field", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile("/app/package.json", JSON.stringify({}));

		expect(await getVersion(fs, "/app")).toBe("unknown");
	});

	it("should return 'unknown' rather than throw when package.json is malformed", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile("/app/package.json", "{ not valid json");

		expect(await getVersion(fs, "/app")).toBe("unknown");
	});
});
