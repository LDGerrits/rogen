import { isWindows } from "../../../base/platform.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { MockProcessService } from "../../../platform/process/__tests__/mock-process-service.js";
import { MockEnvironmentService } from "../../../platform/environment/__tests__/mock-environment-service.js";
import { CoreToolLocator } from "../core-tool-locator.js";

const exe = isWindows ? ".exe" : "";
const home = new MockEnvironmentService("/repo", undefined, false, "/home/me");

describe("CoreToolLocator", () => {
	let fs: MemoryFileSystemService;
	let processes: MockProcessService;

	beforeEach(() => {
		fs = new MemoryFileSystemService();
		processes = new MockProcessService();
	});

	it("should find a program on the PATH first", async () => {
		await fs.writeFile(`/home/me/.rokit/bin/rokit${exe}`, "");
		processes.installed.set("rokit", "/usr/bin/rokit");

		const locator = new CoreToolLocator(processes, fs, home);

		expect(await locator.find("rokit")).toEqual("/usr/bin/rokit");
	});

	it("should look in Rokit's bin folder when the PATH has none", async () => {
		await fs.writeFile(`/home/me/.rokit/bin/rokit${exe}`, "");

		const locator = new CoreToolLocator(processes, fs, home);

		expect(await locator.find("rokit")).toEqual(
			`/home/me/.rokit/bin/rokit${exe}`
		);
	});

	it("should find nothing when neither has it", async () => {
		const locator = new CoreToolLocator(processes, fs, home);

		expect(await locator.find("rokit")).toBeUndefined();
	});
});
