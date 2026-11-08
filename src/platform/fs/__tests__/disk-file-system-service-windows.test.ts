import { jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import path from "path";

jest.unstable_mockModule("../../../base/platform.js", () => ({
	isWindows: true,
	ignoresPathCase: false,
}));

const { DiskFileSystemService } =
	await import("../disk-file-system-service.js");

const failure = (code: string) =>
	Object.assign(new Error(code), { code }) as NodeJS.ErrnoException;

describe("DiskFileSystemService on Windows", () => {
	let dir: string;
	let source: string;
	let destination: string;
	const service = new DiskFileSystemService();
	const rename = fs.promises.rename;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "rogen-rename-"));
		source = path.join(dir, "new.json");
		destination = path.join(dir, "default.project.json");
		fs.writeFileSync(source, "new");
		fs.writeFileSync(destination, "old");
		jest.spyOn(global, "setTimeout").mockImplementation(((
			done: () => void
		) => {
			done();
			return 0;
		}) as never);
	});

	afterEach(() => {
		jest.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("should replace a file another program held open for a moment", async () => {
		const spy = jest
			.spyOn(fs.promises, "rename")
			.mockRejectedValueOnce(failure("EPERM"))
			.mockRejectedValueOnce(failure("EBUSY"))
			.mockImplementation(rename);

		await service.rename(source, destination, true);

		expect(fs.readFileSync(destination, "utf8")).toBe("new");
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it("should fail with the error when the file stays held", async () => {
		jest.spyOn(fs.promises, "rename").mockRejectedValue(failure("EPERM"));

		await expect(
			service.rename(source, destination, true)
		).rejects.toMatchObject({ code: "EPERM" });
	});

	it("should not retry a failure that waiting can't fix", async () => {
		const spy = jest
			.spyOn(fs.promises, "rename")
			.mockRejectedValue(failure("ENOENT"));

		await expect(
			service.rename(source, destination, true)
		).rejects.toMatchObject({ code: "ENOENT" });
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
