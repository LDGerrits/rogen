import path from "path";
import { toPosix } from "../../../base/path.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { CaseFoldingReader } from "../../../platform/fs/__tests__/case-folding-reader.js";
import { instantiationOf } from "../../../platform/instantiation/__tests__/instantiation-of.js";
import { LocateTargets } from "../locate/locate-targets.js";

describe("LocateTargets", () => {
	const root = path.resolve("/project");

	it("should ask about a path in the case it has on disk", async () => {
		const folding = new CaseFoldingReader(new MemoryFileSystemService());
		const onDisk = path.join(
			root,
			"src",
			"Greeter",
			"Server",
			"Greeter.server.luau"
		);
		await folding.writeFile(onDisk, "");
		const targets = instantiationOf([
			FileSystemService,
			folding as unknown as FileSystemService,
		]).createInstance(LocateTargets);

		const { asked, paths } = await targets.classify({
			args: ["src/greeter/server/greeter.server.luau"],
			cwd: root,
		});

		expect(paths).toEqual([onDisk]);
		expect(asked).toEqual([{ path: toPosix(onDisk) }]);
	});

	it("should read a path with Windows' extended prefix as the path without it", async () => {
		const targets = instantiationOf([
			FileSystemService,
			new MemoryFileSystemService(),
		]).createInstance(LocateTargets);
		const file = path.join(root, "src", "A.luau");

		const { paths } = await targets.classify({
			args: [`\\\\?\\${file}`, "\\\\?\\UNC\\host\\share\\A.luau"],
			cwd: root,
		});

		expect(paths[0]).toBe(file);
		expect(toPosix(paths[1])).toMatch(/host\/share\/A\.luau$/);
		expect(toPosix(paths[1])).not.toContain("?");
	});
});
