import { MemoryFileSystemService } from "../../fs/memory-file-system-service.js";
import { CoreProductService } from "../core-product-service.js";

describe("CoreProductService", () => {
	it("should prefer the version a build baked in, as a binary has no package.json", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(
			"/app/package.json",
			JSON.stringify({ version: "1.2.3" })
		);

		expect(
			await new CoreProductService(fs, "/app", "2.0.0").readVersion()
		).toBe("2.0.0");
		expect(
			await new CoreProductService(
				new MemoryFileSystemService(),
				"/app",
				"2.0.0"
			).readVersion()
		).toBe("2.0.0");
	});

	it("should read the version from package.json in the starting directory", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(
			"/app/package.json",
			JSON.stringify({ version: "1.2.3" })
		);

		expect(await new CoreProductService(fs, "/app").readVersion()).toBe(
			"1.2.3"
		);
	});

	it("should walk up parent directories to find package.json", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(
			"/app/package.json",
			JSON.stringify({ version: "1.2.3" })
		);

		expect(
			await new CoreProductService(
				fs,
				"/app/dist/commands/version"
			).readVersion()
		).toBe("1.2.3");
	});

	it("should check the filesystem root itself, not just its ancestors", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile(
			"/package.json",
			JSON.stringify({ version: "4.5.6" })
		);

		expect(await new CoreProductService(fs, "/a/b").readVersion()).toBe(
			"4.5.6"
		);
	});

	it("should return 'unknown' when no package.json is found anywhere", async () => {
		const fs = new MemoryFileSystemService();

		expect(await new CoreProductService(fs, "/a/b/c").readVersion()).toBe(
			"unknown"
		);
	});

	it("should return 'unknown' when the found package.json has no version field", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile("/app/package.json", JSON.stringify({}));

		expect(await new CoreProductService(fs, "/app").readVersion()).toBe(
			"unknown"
		);
	});

	it("should return 'unknown' rather than throw when package.json is malformed", async () => {
		const fs = new MemoryFileSystemService();
		await fs.writeFile("/app/package.json", "{ not valid json");

		expect(await new CoreProductService(fs, "/app").readVersion()).toBe(
			"unknown"
		);
	});
});
