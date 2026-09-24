import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DiskFileSystemService } from "../disk-file-system-service.js";

describe("DiskFileSystemService", () => {
	let dir: string;
	let disk: DiskFileSystemService;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-disk-fs-"));
		disk = new DiskFileSystemService();
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	describe("rename", () => {
		it("should move a file to a new path, creating parent directories", async () => {
			await disk.writeFile(path.join(dir, "a.txt"), "data");

			await disk.rename(
				path.join(dir, "a.txt"),
				path.join(dir, "out/b.txt")
			);

			expect(await disk.exists(path.join(dir, "a.txt"))).toBe(false);
			expect(await disk.readFile(path.join(dir, "out/b.txt"))).toBe(
				"data"
			);
		});

		it("should replace the destination only if overwrite is true", async () => {
			await disk.writeFile(path.join(dir, "a.txt"), "new");
			await disk.writeFile(path.join(dir, "b.txt"), "old");

			await expect(
				disk.rename(path.join(dir, "a.txt"), path.join(dir, "b.txt"))
			).rejects.toMatchObject({ code: "EEXIST" });

			await disk.rename(
				path.join(dir, "a.txt"),
				path.join(dir, "b.txt"),
				true
			);
			expect(await disk.readFile(path.join(dir, "b.txt"))).toBe("new");
		});

		it("should throw ENOENT when the source is missing", async () => {
			await expect(
				disk.rename(
					path.join(dir, "missing.txt"),
					path.join(dir, "b.txt")
				)
			).rejects.toMatchObject({ code: "ENOENT" });
		});
	});
});
