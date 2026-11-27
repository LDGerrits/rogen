import path from "path";
import { FileSystemService, FileType } from "../file-system-service.js";
import { OnDiskCase } from "../on-disk-case.js";
import { MemoryFileSystemService } from "../memory-file-system-service.js";
import { caseFoldingReader } from "./case-folding-reader.js";

describe("OnDiskCase", () => {
	const at = (...parts: string[]) => path.resolve("/project", ...parts);
	let disk: MemoryFileSystemService;
	let folding: FileSystemService;

	beforeEach(async () => {
		disk = new MemoryFileSystemService();
		folding = caseFoldingReader(disk);
		await folding.writeFile(at("src", "Greeter", "Server.luau"), "");
	});

	it("should give every name the case it has on disk", async () => {
		expect(
			await new OnDiskCase(folding).of(
				at("SRC", "greeter", "server.LUAU")
			)
		).toBe(at("src", "Greeter", "Server.luau"));
	});

	it("should keep the names that match, and the rest of a path that does not exist", async () => {
		expect(
			await new OnDiskCase(folding).of(
				at("src", "greeter", "New", "a.luau")
			)
		).toBe(at("src", "Greeter", "New", "a.luau"));
	});

	it("should leave a path alone where case matters", async () => {
		await disk.writeFile(at("lib", "Util.luau"), "");

		expect(await new OnDiskCase(disk).of(at("lib", "util.luau"))).toBe(
			at("lib", "util.luau")
		);
		expect(await new OnDiskCase(disk).of(at("lib", "Util.luau"))).toBe(
			at("lib", "Util.luau")
		);
	});

	it("should keep a name inside a folder it cannot list", async () => {
		disk.refuseListing(at("src"), "EACCES");

		expect(await new OnDiskCase(disk).of(at("src", "Greeter"))).toBe(
			at("src", "Greeter")
		);
	});

	it("should keep a name that exists but is listed under no name like it", async () => {
		const unlisted = {
			exists: async () => true,
			readDirectory: async (): Promise<[string, FileType][]> => [
				["Other", FileType.File],
			],
		};

		expect(await new OnDiskCase(unlisted as never).of(at("src"))).toBe(
			at("src")
		);
	});
});
