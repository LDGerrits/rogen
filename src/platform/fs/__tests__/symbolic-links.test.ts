import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DiskFileSystemService } from "../disk-file-system-service.js";
import { FileSystemService, FileType } from "../file-system-service.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";

interface Fixture {
	readonly fileSystem: FileSystemService;
	readonly root: string;
	link(target: string, linkPath: string): Promise<void>;
	dispose(): void;
}

const fixtures: [string, () => Fixture][] = [
	[
		"DiskFileSystemService",
		() => {
			const root = fs.realpathSync(
				fs.mkdtempSync(path.join(os.tmpdir(), "rogen-links-"))
			);
			return {
				fileSystem: new DiskFileSystemService(),
				root,
				link: async (target, linkPath) => {
					await fs.promises.mkdir(path.dirname(linkPath), {
						recursive: true,
					});
					const isDirectory = fs
						.statSync(target, {
							throwIfNoEntry: false,
						})
						?.isDirectory();
					await fs.promises.symlink(
						target,
						linkPath,
						isDirectory ? "junction" : "file"
					);
				},
				dispose: () =>
					fs.rmSync(root, { recursive: true, force: true }),
			};
		},
	],
	[
		"MemoryFileSystemService",
		() => {
			const memory = new MemoryFileSystemService();
			return {
				fileSystem: memory,
				root: path.resolve("/repo"),
				link: (target, linkPath) =>
					memory.createSymbolicLink(target, linkPath),
				dispose: () => undefined,
			};
		},
	],
];

describe.each(fixtures)("%s: symbolic links", (_name, create) => {
	let fixture: Fixture;
	let at: (...segments: string[]) => string;

	beforeEach(() => {
		fixture = create();
		at = (...segments) => path.join(fixture.root, ...segments);
	});

	afterEach(() => fixture.dispose());

	const types = async (dir: string) =>
		Object.fromEntries(await fixture.fileSystem.readDirectory(dir));

	describe("readDirectory", () => {
		it("should report a link to a directory as a directory that is a link", async () => {
			await fixture.fileSystem.writeFile(at("shared/a.luau"), "");
			await fixture.link(at("shared"), at("src/Shared"));

			expect(await types(at("src"))).toEqual({
				Shared: FileType.Directory | FileType.SymbolicLink,
			});
		});

		it("should report a link to a file as a file that is a link", async () => {
			await fixture.fileSystem.writeFile(at("shared/a.luau"), "");
			await fixture.link(at("shared/a.luau"), at("src/A.luau"));

			expect(await types(at("src"))).toEqual({
				"A.luau": FileType.File | FileType.SymbolicLink,
			});
		});

		it("should report a link to nothing as only a link", async () => {
			await fixture.fileSystem.createDirectory(at("src"));
			await fixture.link(at("missing"), at("src/Broken"));

			expect(await types(at("src"))).toEqual({
				Broken: FileType.SymbolicLink,
			});
		});

		it("should list a linked directory's own entries", async () => {
			await fixture.fileSystem.writeFile(at("shared/a.luau"), "");
			await fixture.link(at("shared"), at("src/Shared"));

			expect(await types(at("src/Shared"))).toEqual({
				"a.luau": FileType.File,
			});
		});
	});

	describe("following a link", () => {
		it("should treat a link like its target for exists, isFile and isDirectory", async () => {
			await fixture.fileSystem.writeFile(at("shared/a.luau"), "");
			await fixture.link(at("shared"), at("src/Shared"));
			await fixture.link(at("shared/a.luau"), at("src/A.luau"));
			await fixture.link(at("missing"), at("src/Broken"));

			const { fileSystem } = fixture;
			expect(await fileSystem.isDirectory(at("src/Shared"))).toBe(true);
			expect(await fileSystem.isFile(at("src/Shared"))).toBe(false);
			expect(await fileSystem.isFile(at("src/A.luau"))).toBe(true);
			expect(await fileSystem.exists(at("src/Shared/a.luau"))).toBe(true);
			expect(await fileSystem.exists(at("src/Broken"))).toBe(false);
		});

		it("should read a file through a link", async () => {
			await fixture.fileSystem.writeFile(at("shared/a.luau"), "return 1");
			await fixture.link(at("shared"), at("src/Shared"));
			await fixture.link(at("shared/a.luau"), at("src/A.luau"));

			expect(await fixture.fileSystem.readFile(at("src/A.luau"))).toBe(
				"return 1"
			);
			expect(
				await fixture.fileSystem.readFile(at("src/Shared/a.luau"))
			).toBe("return 1");
		});

		it("should write a file through a linked directory into the target", async () => {
			await fixture.fileSystem.createDirectory(at("shared"));
			await fixture.link(at("shared"), at("src/Shared"));

			await fixture.fileSystem.writeFile(at("src/Shared/b.luau"), "x");

			expect(await fixture.fileSystem.readFile(at("shared/b.luau"))).toBe(
				"x"
			);
		});
	});

	describe("realPath", () => {
		it("should resolve a link to the same path as its target", async () => {
			await fixture.fileSystem.writeFile(at("shared/a.luau"), "");
			await fixture.link(at("shared"), at("src/Shared"));

			expect(await fixture.fileSystem.realPath(at("src/Shared"))).toBe(
				await fixture.fileSystem.realPath(at("shared"))
			);
			expect(
				await fixture.fileSystem.realPath(at("src/Shared/a.luau"))
			).toBe(await fixture.fileSystem.realPath(at("shared/a.luau")));
		});

		it("should follow a chain of links", async () => {
			await fixture.fileSystem.createDirectory(at("shared"));
			await fixture.link(at("shared"), at("one"));
			await fixture.link(at("one"), at("two"));

			expect(await fixture.fileSystem.realPath(at("two"))).toBe(
				await fixture.fileSystem.realPath(at("shared"))
			);
		});

		it("should reject with ENOENT for a link to nothing", async () => {
			await fixture.fileSystem.createDirectory(at("src"));
			await fixture.link(at("missing"), at("src/Broken"));

			await expect(
				fixture.fileSystem.realPath(at("src/Broken"))
			).rejects.toMatchObject({ code: "ENOENT" });
		});

		it("should reject with ELOOP for links that point at each other", async () => {
			await fixture.fileSystem.createDirectory(at("src"));
			await fixture.link(at("src/B"), at("src/A"));
			await fixture.link(at("src/A"), at("src/B"));

			await expect(
				fixture.fileSystem.realPath(at("src/A"))
			).rejects.toMatchObject({ code: "ELOOP" });
		});
	});

	describe("delete", () => {
		it("should remove only the link, never its target", async () => {
			await fixture.fileSystem.writeFile(at("shared/a.luau"), "");
			await fixture.link(at("shared"), at("src/Shared"));

			await fixture.fileSystem.delete(at("src/Shared"), true);

			expect(await types(at("src"))).toEqual({});
			expect(await fixture.fileSystem.exists(at("shared/a.luau"))).toBe(
				true
			);
		});
	});
});
