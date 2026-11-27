import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { LogLevel } from "../../../platform/log/log-service.js";
import { CoreToolLocator } from "../core-tool-locator.js";

const environment = (isWindows: boolean) =>
	new MockEnvironmentService(
		"/repo",
		LogLevel.Info,
		false,
		"/home/me",
		undefined,
		undefined,
		undefined,
		undefined,
		isWindows
	);

const rokitBin = (file: string) => path.join("/home/me", ".rokit", "bin", file);

describe("CoreToolLocator", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	const locator = (isWindows = false) =>
		new CoreToolLocator(processes, fs, environment(isWindows));

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		processes = new MockProcessService();
	});

	it("should find a program on the PATH first", async () => {
		await fs.writeFile(rokitBin("rokit"), "");
		processes.installed.set("rokit", "/usr/bin/rokit");

		expect(await locator().find("rokit")).toEqual("/usr/bin/rokit");
	});

	it("should look in Rokit's bin folder when the PATH has none", async () => {
		await fs.writeFile(rokitBin("rokit"), "");

		expect(await locator().find("rokit")).toEqual(rokitBin("rokit"));
	});

	it("should look for the .exe of a command without an extension on Windows", async () => {
		await fs.writeFile(rokitBin("rokit.exe"), "");
		await fs.writeFile(rokitBin("tool.cmd"), "");

		expect(await locator(true).find("rokit")).toEqual(
			rokitBin("rokit.exe")
		);
		expect(await locator(true).find("tool.cmd")).toEqual(
			rokitBin("tool.cmd")
		);
	});

	it("should find nothing when neither has it", async () => {
		expect(await locator().find("rokit")).toBeUndefined();
	});
});
