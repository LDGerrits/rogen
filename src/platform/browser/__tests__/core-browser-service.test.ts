import { MockProcessService } from "../../process/__tests__/mock-process-service.js";
import { CoreBrowserService } from "../core-browser-service.js";

const OK = { code: 0, stdout: "", stderr: "" };

describe("CoreBrowserService", () => {
	let processes: MockProcessService;

	beforeEach(() => {
		processes = new MockProcessService();
	});

	it("should open a URL with xdg-open on Linux", async () => {
		processes.installed.set("xdg-open", "/usr/bin/xdg-open");
		processes.outputs.set("xdg-open", OK);

		const opened = await new CoreBrowserService(
			processes,
			"linux",
			"6.1.0"
		).open("https://example.com", "/repo");

		expect(opened).toBe(true);
		expect(processes.execs).toEqual([
			{ file: "xdg-open", args: ["https://example.com"], cwd: "/repo" },
		]);
	});

	it("should open a URL with open on macOS", async () => {
		processes.installed.set("open", "/usr/bin/open");
		processes.outputs.set("open", OK);

		await new CoreBrowserService(processes, "darwin").open("u", "/repo");

		expect(processes.execs[0].file).toBe("open");
	});

	it("should open a URL through rundll32 on Windows, which needs no lookup", async () => {
		processes.outputs.set("rundll32", OK);

		const opened = await new CoreBrowserService(processes, "win32").open(
			"u",
			"C:\\repo"
		);

		expect(opened).toBe(true);
		expect(processes.execs[0]).toMatchObject({
			file: "rundll32",
			args: ["url.dll,FileProtocolHandler", "u"],
		});
	});

	it("should say it could not when the program isn't installed", async () => {
		const opened = await new CoreBrowserService(
			processes,
			"linux",
			"6.1.0"
		).open("u", "/repo");

		expect(opened).toBe(false);
		expect(processes.execs).toEqual([]);
	});

	describe("on WSL", () => {
		const release = "6.6.87.2-microsoft-standard-WSL2";

		it("should open a URL with wslview when it is installed", async () => {
			processes.installed.set("wslview", "/usr/bin/wslview");
			processes.installed.set("explorer.exe", "/mnt/c/explorer.exe");
			processes.outputs.set("wslview", OK);

			const opened = await new CoreBrowserService(
				processes,
				"linux",
				release
			).open("u", "/repo");

			expect(opened).toBe(true);
			expect(processes.execs.map(({ file }) => file)).toEqual([
				"wslview",
			]);
		});

		it("should fall back to explorer.exe, whose exit code 1 means it opened the page", async () => {
			processes.installed.set("explorer.exe", "/mnt/c/explorer.exe");
			processes.outputs.set("explorer.exe", { ...OK, code: 1 });

			const opened = await new CoreBrowserService(
				processes,
				"linux",
				release
			).open("https://example.com", "/repo");

			expect(opened).toBe(true);
			expect(processes.execs).toEqual([
				{
					file: "explorer.exe",
					args: ["https://example.com"],
					cwd: "/repo",
				},
			]);
		});

		it("should try explorer.exe when wslview fails", async () => {
			processes.installed.set("wslview", "/usr/bin/wslview");
			processes.installed.set("explorer.exe", "/mnt/c/explorer.exe");
			processes.outputs.set("wslview", { ...OK, code: 2 });
			processes.outputs.set("explorer.exe", { ...OK, code: 1 });

			expect(
				await new CoreBrowserService(processes, "linux", release).open(
					"u",
					"/repo"
				)
			).toBe(true);
		});

		it("should say it could not when neither is there", async () => {
			expect(
				await new CoreBrowserService(processes, "linux", release).open(
					"u",
					"/repo"
				)
			).toBe(false);
		});
	});

	it("should say it could not when the program fails", async () => {
		processes.installed.set("xdg-open", "/usr/bin/xdg-open");
		processes.outputs.set("xdg-open", { ...OK, code: 3 });

		expect(
			await new CoreBrowserService(processes, "linux", "6.1.0").open(
				"u",
				"/repo"
			)
		).toBe(false);
	});
});
