import path from "path";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ResultError } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { CoreConfigService } from "../../config/core-config-service.js";
import { BaseConfigReader } from "../base-config-reader.js";
import { directory } from "./init-fixtures.js";

describe("BaseConfigReader", () => {
	let fs: MemoryFileSystemService;

	const write = (file: string, content: unknown) =>
		fs.writeFile(path.join(directory, file), JSON.stringify(content));

	const readBase = (entries: readonly string[] = ["default.rogen.json"]) =>
		new BaseConfigReader(
			new CoreConfigService(fs, new MockEnvironmentService(directory)),
			directory
		).read(new Set(entries));

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(directory);
	});

	it("should read the root dirs of default.rogen.json relative to the directory", async () => {
		await write("default.rogen.json", { rootDirs: ["src", "shared"] });

		expect((await readBase()).unwrap()).toEqual({
			rootDirs: ["src", "shared"],
			ports: [],
			sharedPort: false,
		});
	});

	it("should read the resolved value through extends", async () => {
		await write("default.rogen.json", {
			extends: "./core.rogen.json",
			syncDir: "dist",
		});
		await write("core.rogen.json", { rootDirs: ["core"] });

		expect((await readBase()).unwrap()).toMatchObject({
			rootDirs: ["core"],
			syncDir: "dist",
		});
	});

	it("should take the sync dir from the synced config when default is source-rooted", async () => {
		await write("default.rogen.json", { rootDirs: ["src"] });
		await write("sync.rogen.json", {
			extends: "./default.rogen.json",
			syncDir: "dist",
		});

		expect(
			(await readBase(["default.rogen.json", "sync.rogen.json"])).unwrap()
		).toMatchObject({ rootDirs: ["src"], syncDir: "dist" });
	});

	it("should read the port every config's template serves on, skipping a broken config", async () => {
		await write("default.rogen.json", {
			template: "default.template.json",
		});
		await write("default.template.json", { servePort: 34872 });
		await write("lobby.rogen.json", {
			extends: "./default.rogen.json",
			template: "lobby.template.json",
		});
		await write("lobby.template.json", { servePort: 34873 });
		await fs.writeFile(path.join(directory, "broken.rogen.json"), "{ nope");

		expect(
			(
				await readBase([
					"default.rogen.json",
					"lobby.rogen.json",
					"broken.rogen.json",
					"lobby.template.json",
				])
			).unwrap().ports
		).toEqual([34872, 34873]);
	});

	it("should fail with diagnostics when default.rogen.json is broken", async () => {
		await fs.writeFile(
			path.join(directory, "default.rogen.json"),
			"{ nope"
		);

		const result = await readBase();

		expect(
			(result as ResultError<Diagnostic[]>).error.length
		).toBeGreaterThan(0);
	});
});
