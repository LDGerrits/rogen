import { useConfigFixture, fs, service, write } from "./config-fixture.js";

describe("CoreConfigService.referenceTo", () => {
	useConfigFixture();

	const reference = (file: string, folder = "/repo") =>
		service.referenceTo(file, folder);

	it("should name nothing for the default config of the folder", async () => {
		await write("/repo/default.rogen.json", {});

		expect(await reference("/repo/default.rogen.json")).toBe("");
	});

	it("should name the folder of a default config in another folder", async () => {
		await write("/repo/places/lobby/default.rogen.jsonc", {});

		expect(await reference("/repo/places/lobby/default.rogen.jsonc")).toBe(
			"places/lobby"
		);
	});

	it("should name the folder of a default config above the folder", async () => {
		await write("/repo/default.rogen.json", {});

		expect(await reference("/repo/default.rogen.json", "/repo/src")).toBe(
			".."
		);
	});

	it("should name a config of the folder by its bare name", async () => {
		await write("/repo/lobby.rogen.json", {});

		expect(await reference("/repo/lobby.rogen.json")).toBe("lobby");
	});

	it("should name a config by its bare name when a folder of that name holds no default config", async () => {
		await write("/repo/lobby.rogen.json", {});
		await fs.createDirectory("/repo/lobby");

		expect(await reference("/repo/lobby.rogen.json")).toBe("lobby");
	});

	it("should name a config by its file when a folder of that name holds a default config", async () => {
		await write("/repo/lobby.rogen.json", {});
		await write("/repo/lobby/default.rogen.json", {});

		expect(await reference("/repo/lobby.rogen.json")).toBe(
			"lobby.rogen.json"
		);
	});

	it("should name a config by its file when a folder of that name holds a project file to adopt", async () => {
		await write("/repo/lobby.rogen.json", {});
		await write("/repo/lobby/default.project.json", {});

		expect(await reference("/repo/lobby.rogen.json")).toBe(
			"lobby.rogen.json"
		);
	});

	it("should name a config by its file when a file of that name is there", async () => {
		await write("/repo/lobby.rogen.json", {});
		await fs.writeFile("/repo/lobby", "");

		expect(await reference("/repo/lobby.rogen.json")).toBe(
			"lobby.rogen.json"
		);
	});

	it("should name a config by its file when a twin of the other extension would be read", async () => {
		await write("/repo/lobby.rogen.json", {});
		await write("/repo/lobby.rogen.jsonc", {});

		expect(await reference("/repo/lobby.rogen.json")).toBe(
			"lobby.rogen.json"
		);
	});

	it("should name a config of another folder by its path", async () => {
		await write("/repo/places/lobby.rogen.json", {});

		expect(await reference("/repo/places/lobby.rogen.json")).toBe(
			"places/lobby.rogen.json"
		);
	});

	it("should name a config the folder has not got yet by its bare name", async () => {
		expect(await reference("/repo/lobby.rogen.json")).toBe("lobby");
	});

	it("should name a config the folder has not got yet by its file when a folder of that name holds a default config", async () => {
		await write("/repo/lobby/default.rogen.json", {});

		expect(await reference("/repo/lobby.rogen.json")).toBe(
			"lobby.rogen.json"
		);
	});

	it("should name a config the folder has not got yet by its bare name when a project file of that name is there", async () => {
		await write("/repo/lobby.project.json", {});

		expect(await reference("/repo/lobby.rogen.json")).toBe("lobby");
	});

	it("should name a project file with no config by its bare name", async () => {
		await write("/repo/lobby.project.json", {});

		expect(await reference("/repo/lobby.project.json")).toBe("lobby");
	});

	it("should name a path outside the folder by its path", async () => {
		await write("/other/lobby.rogen.json", {});

		expect(await reference("/other/lobby.rogen.json")).toBe(
			"/other/lobby.rogen.json"
		);
	});
});
