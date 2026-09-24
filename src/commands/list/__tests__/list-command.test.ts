import { jest } from "@jest/globals";
import "../list-command.js";
import "../../../domain/config/config.js";
import { DisposableStore } from "../../../base/disposable.js";
import { Result, ResultError } from "../../../base/result.js";
import { ConfigService } from "../../../domain/config/config-service.js";
import { CoreConfigService } from "../../../domain/config/core-config-service.js";
import { CoreCommandService } from "../../../platform/commands/core-command-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { EnvironmentService } from "../../../platform/environment/environment-service.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { ServiceCollection } from "../../../platform/instantiation/service-collection.js";
import {
	LogService,
	NullLogService,
} from "../../../platform/log/log-service.js";

describe("list command", () => {
	let store: DisposableStore;
	let fs: MemoryFileSystemService;
	let info: jest.SpiedFunction<NullLogService["info"]>;
	let run: () => Promise<Result<void, Error>>;

	const write = (file: string, config: Record<string, unknown> | string) =>
		fs.writeFile(
			`/repo/${file}`,
			typeof config === "string" ? config : JSON.stringify(config)
		);

	const printed = () => info.mock.calls.map(([message]) => message);

	beforeEach(async () => {
		store = new DisposableStore();
		fs = new MemoryFileSystemService();
		await fs.createDirectory("/repo");
		const logService = new NullLogService();
		info = jest.spyOn(logService, "info");
		const environment = new MockEnvironmentService(undefined, "/repo");
		const services = new ServiceCollection();
		services.set(LogService, logService);
		services.set(FileSystemService, fs);
		services.set(EnvironmentService, environment);
		services.set(
			ConfigService,
			store.add(new CoreConfigService(fs, environment, logService))
		);
		const commandService = store.add(
			new CoreCommandService(services, logService)
		);
		run = () => commandService.executeCommand("list", { _: ["list"] });
	});

	afterEach(() => {
		store[Symbol.dispose]();
	});

	it("should show a config's root dirs, sync dir, project file and active tags", async () => {
		await write("default.rogen.json", {
			rootDirs: ["src", "lobby"],
			syncDir: "out",
			tags: { mock: true, dev: false, prod: true },
		});

		const result = await run();

		expect(result.isOk()).toBe(true);
		expect(printed()).toEqual([
			[
				"default.rogen.json",
				"  root dirs: src, lobby",
				"  sync dir: out",
				"  project file: default.project.json",
				"  tags: mock, prod",
			].join("\n"),
		]);
	});

	it("should say so when there is no sync dir and no active tag", async () => {
		await write("default.rogen.json", {});

		await run();

		expect(printed()[0]).toContain("  sync dir: (none)");
		expect(printed()[0]).toContain("  tags: (none)");
	});

	it("should show the extends chain of a config", async () => {
		await write("root.rogen.json", {});
		await write("base.rogen.json", { extends: "root.rogen.json" });
		await write("default.rogen.json", { extends: "base.rogen.json" });

		await run();

		const row = printed().find((text) =>
			text.startsWith("default.rogen.json")
		);
		expect(row).toContain("  extends: base.rogen.json -> root.rogen.json");
	});

	it("should list every config here, in name order", async () => {
		await write("lobby.rogen.json", {});
		await write("default.rogen.json", {});
		await write("notes.json", {});

		await run();

		expect(printed().map((text) => text.split("\n")[0])).toEqual([
			"default.rogen.json",
			"lobby.rogen.json",
		]);
	});

	it("should report a broken config in place, print the rest and fail", async () => {
		await write("a.rogen.json", {});
		await write("b.rogen.json", `{\n\t"bogus": 1\n}`);
		await write("c.rogen.json", {});

		const result = await run();

		expect(printed().map((text) => text.split("\n")[0])).toEqual([
			"a.rogen.json",
			"b.rogen.json",
			"c.rogen.json",
		]);
		expect(printed()[1]).toContain("/repo/b.rogen.json:2:2 - error:");
		expect(printed()[1]).not.toContain("project file");
		expect(result.isErr()).toBe(true);
	});

	it("should still show the extends chain of a broken config", async () => {
		await write("base.rogen.json", { bogus: 1 });
		await write("broken.rogen.json", { extends: "base.rogen.json" });

		await run();

		const row = printed().find((text) =>
			text.startsWith("broken.rogen.json")
		);
		expect(row).toContain("  extends: base.rogen.json");
		expect(row).toContain("error:");
	});

	it("should fail when there is no config here", async () => {
		const result = await run();

		expect((result as ResultError<Error>).error.message).toContain(
			"No config file found"
		);
	});
});
