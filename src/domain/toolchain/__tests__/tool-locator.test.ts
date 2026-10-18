import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { ToolLocator } from "../tool-locator.js";

describe("ToolLocator", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		processes = new MockProcessService();
	});

	it("should find a program on the PATH first", async () => {
		await fs.writeFile("/home/me/.rokit/bin/rokit", "");
		processes.installed.set("rokit", "/usr/bin/rokit");

		const locator = new ToolLocator(processes, fs, "/home/me");

		expect(await locator.find("rokit")).toBe("/usr/bin/rokit");
	});

	it("should look in Rokit's bin folder when the PATH has none", async () => {
		await fs.writeFile("/home/me/.rokit/bin/rokit", "");

		const locator = new ToolLocator(processes, fs, "/home/me");

		expect(await locator.find("rokit")).toBe("/home/me/.rokit/bin/rokit");
	});

	it("should find nothing when neither has it", async () => {
		const locator = new ToolLocator(processes, fs, "/home/me");

		expect(await locator.find("rokit")).toBeUndefined();
	});

	it("should look on the PATH alone without a home folder", async () => {
		await fs.writeFile("/home/me/.rokit/bin/rokit", "");

		expect(await new ToolLocator(processes).find("rokit")).toBeUndefined();
	});
});
