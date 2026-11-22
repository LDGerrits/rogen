import { jest } from "@jest/globals";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { ignoresPathCase } from "../../../base/platform.js";
import { FileType } from "../file-system-service.js";
import { DiskFileSystemService } from "../disk-file-system-service.js";

const describeOnCaseSensitiveDisk = ignoresPathCase ? describe.skip : describe;

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

		it("should rename a folder in letter case only where the disk ignores case", async () => {
			await disk.createDirectory(path.join(dir, "server"));
			const lstat = fs.promises.lstat;
			const ignoringCase = jest
				.spyOn(fs.promises, "lstat")
				.mockImplementation(((target: string) =>
					lstat(
						path.join(
							path.dirname(target),
							path.basename(target).toLowerCase()
						)
					)) as typeof fs.promises.lstat);

			try {
				await disk.rename(
					path.join(dir, "server"),
					path.join(dir, "Server")
				);
			} finally {
				ignoringCase.mockRestore();
			}

			expect(fs.readdirSync(dir)).toEqual(["Server"]);
		});

		describeOnCaseSensitiveDisk(
			"where letter case tells names apart",
			() => {
				it("should refuse a name in another letter case that is a file of its own", async () => {
					await disk.writeFile(path.join(dir, "foo.txt"), "a");
					await disk.writeFile(path.join(dir, "Foo.txt"), "b");

					await expect(
						disk.rename(
							path.join(dir, "foo.txt"),
							path.join(dir, "Foo.txt")
						)
					).rejects.toMatchObject({ code: "EEXIST" });
				});
			}
		);

		it("should throw ENOENT when the source is missing", async () => {
			await expect(
				disk.rename(
					path.join(dir, "missing.txt"),
					path.join(dir, "b.txt")
				)
			).rejects.toMatchObject({ code: "ENOENT" });
		});
	});

	describe("copyFile", () => {
		it("should leave a copy of a read-only file writable", async () => {
			const from = path.join(dir, "a.luau");
			const to = path.join(dir, "m/a.luau");
			await disk.writeFile(from, "return 1");
			fs.chmodSync(from, 0o444);

			await disk.copyFile(from, to);
			await disk.writeFile(to, "return 2");

			expect(await disk.readFile(to)).toBe("return 2");
		});
	});

	describe("readDirectory", () => {
		const canDenyAccess =
			process.platform !== "win32" && process.getuid?.() !== 0;

		it("should list a link to a place it may not look into as a bare link", async () => {
			if (!canDenyAccess) return;
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
		});
	});

	describe("rename, refusing", () => {
		it("should pass on a failure to look at the destination other than its absence", async () => {
			await disk.writeFile(path.join(dir, "file"), "");
			await disk.writeFile(path.join(dir, "a.txt"), "");

			await expect(
				disk.rename(
					path.join(dir, "a.txt"),
					path.join(dir, "file", "b")
				)
			).rejects.toThrow(/ENOTDIR|EEXIST/);
		});

		it("should take a name in another letter case as free when its folder can't be listed", async () => {
			await disk.createDirectory(path.join(dir, "server"));
			const lstat = fs.promises.lstat;
			jest.spyOn(fs.promises, "lstat").mockImplementation(((
				target: string
			) =>
				lstat(
					path.join(
						path.dirname(target),
						path.basename(target).toLowerCase()
					)
				)) as typeof fs.promises.lstat);
			jest.spyOn(fs.promises, "readdir").mockRejectedValue(
				Object.assign(new Error("EACCES"), { code: "EACCES" })
			);

			try {
				await disk.rename(
					path.join(dir, "server"),
					path.join(dir, "Server")
				);
			} finally {
				jest.restoreAllMocks();
			}

			expect(fs.readdirSync(dir)).toEqual(["Server"]);
		});
	});

	describe("createFile", () => {
		const failure = (code: string) =>
			Object.assign(new Error(code), { code });

		afterEach(() => {
			jest.restoreAllMocks();
		});

		it("should create a file only where none is, without hard links where the disk has none", async () => {
			jest.spyOn(fs.promises, "link").mockRejectedValue(failure("EPERM"));
			const file = path.join(dir, "a.txt");

			expect(await disk.createFile(file, "first")).toBe(true);
			expect(await disk.createFile(file, "second")).toBe(false);
			expect(fs.readFileSync(file, "utf8")).toBe("first");
			expect(fs.readdirSync(dir)).toEqual(["a.txt"]);
		});

		it("should pass on a failure to write without a hard link", async () => {
			jest.spyOn(fs.promises, "link").mockRejectedValue(
				failure("ENOTSUP")
			);
			const writeFile = fs.promises.writeFile;
			jest.spyOn(fs.promises, "writeFile").mockImplementation(((
				target: string,
				...rest: [string, object]
			) =>
				target.endsWith(".tmp")
					? writeFile(target, ...rest)
					: Promise.reject(
							failure("EIO")
						)) as typeof fs.promises.writeFile);

			await expect(
				disk.createFile(path.join(dir, "a.txt"), "")
			).rejects.toThrow("EIO");
			expect(fs.readdirSync(dir)).toEqual([]);
		});

		it("should pass on a failure to link other than an unsupported one", async () => {
			jest.spyOn(fs.promises, "link").mockRejectedValue(failure("EIO"));

			await expect(
				disk.createFile(path.join(dir, "a.txt"), "")
			).rejects.toThrow("EIO");
			expect(fs.readdirSync(dir)).toEqual([]);
		});
	});

	describe("types", () => {
		const hasSockets = process.platform !== "win32";

		it("should not take a missing path for a folder", async () => {
			expect(await disk.isDirectory(path.join(dir, "missing"))).toBe(
				false
			);
		});

		it("should list what is neither a file nor a folder, and a link to it, as such", async () => {
			if (!hasSockets) return;
			const socket = path.join(dir, "s.sock");
			const server = net.createServer();
			await new Promise<void>((resolve) =>
				server.listen(socket, resolve)
			);
			fs.symlinkSync(socket, path.join(dir, "link"));

			try {
				expect(await disk.readDirectory(dir)).toEqual([
					["link", FileType.SymbolicLink],
					["s.sock", FileType.Unknown],
				]);
			} finally {
				await new Promise((resolve) => server.close(resolve));
			}
		});

		it("should pass on a failure to follow a link that isn't about the link", async () => {
			fs.writeFileSync(path.join(dir, "target"), "");
			fs.symlinkSync(path.join(dir, "target"), path.join(dir, "link"));
			jest.spyOn(fs.promises, "stat").mockRejectedValue(
				Object.assign(new Error("EIO"), { code: "EIO" })
			);

			try {
				await expect(disk.readDirectory(dir)).rejects.toThrow("EIO");
			} finally {
				jest.restoreAllMocks();
			}
		});
	});
});
