import path from "path";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import { TestRunnerDetector } from "../test-runner-detector.js";

describe("TestRunnerDetector", () => {
	const cwd = path.resolve("/mock/workspace");
	let fs: MemoryFileSystemService;

	const write = (file: string, content: string) =>
		fs.writeFile(path.join(cwd, file), content);
	const detect = () => new TestRunnerDetector(fs).detect(cwd);

	beforeEach(async () => {
		fs = new MemoryFileSystemService();
		await fs.createDirectory(cwd);
	});

	it("should find none in a workspace without manifests", async () => {
		expect(await detect()).toBeUndefined();
	});

	it("should find Jest among the dependencies of a Wally manifest", async () => {
		await write(
			"wally.toml",
			'[dev-dependencies]\nJest = "jsdotlua/jest@3.10.0"\n'
		);

		expect(await detect()).toBe("Jest");
	});

	it("should find TestEZ in a Wally manifest", async () => {
		await write(
			"wally.toml",
			'[dev-dependencies]\nTestEZ = "roblox/testez@0.4.1"\n'
		);

		expect(await detect()).toBe("TestEZ");
	});

	it("should find a runner in the dev dependencies of a package.json", async () => {
		await write(
			"package.json",
			JSON.stringify({ devDependencies: { "@rbxts/jest": "^3.0.0" } })
		);

		expect(await detect()).toBe("Jest");
	});

	it("should find a runner in a Pesde manifest", async () => {
		await write(
			"pesde.toml",
			'[dev_dependencies]\njest = "jsdotlua/jest"\n'
		);

		expect(await detect()).toBe("Jest");
	});

	it("should find a runner in a Pesde dependency written as a table", async () => {
		await write(
			"pesde.toml",
			'[dev_dependencies]\njest = { wally = "jsdotlua/jest", version = "^3" }\n'
		);

		expect(await detect()).toBe("Jest");
	});

	it("should not take a package that only has a runner in its name for one", async () => {
		await write(
			"package.json",
			JSON.stringify({ devDependencies: { "ts-jest": "^29.0.0" } })
		);

		expect(await detect()).toBeUndefined();
	});

	it("should ignore a runner named outside the dependencies", async () => {
		await write(
			"package.json",
			JSON.stringify({ name: "jest-demo", scripts: { test: "jest" } })
		);
		await write("wally.toml", '[package]\nname = "me/jest-demo"\n');

		expect(await detect()).toBeUndefined();
	});

	it("should ignore a package.json that is not JSON", async () => {
		await write("package.json", "{");

		expect(await detect()).toBeUndefined();
	});
});
