import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileType } from "../file-system-service.js";
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

	describe("readDirectory", () => {
		const canDenyAccess =
			process.platform !== "win32" && process.getuid?.() !== 0;

		(canDenyAccess ? it : it.skip)(
			"should list a link to a place it may not look into as a bare link",
			async () => {
				const locked = path.join(dir, "locked");
				fs.mkdirSync(locked);
				fs.writeFileSync(path.join(locked, "secret.txt"), "");
				fs.symlinkSync(
					path.join(locked, "secret.txt"),
					path.join(dir, "link")
				);
				fs.chmodSync(locked, 0o000);
				try {
					expect(await disk.readDirectory(dir)).toContainEqual([
						"link",
						FileType.SymbolicLink,
					]);
				} finally {
					fs.chmodSync(locked, 0o755);
				}
			}
		);
	});
});
