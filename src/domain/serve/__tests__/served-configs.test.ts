import { PathSet } from "../../../base/path.js";
import { ResolvedConfig } from "../../config/config.js";
import { ServedConfigs } from "../served-configs.js";

const config = (file: string, parents: string[] = []) =>
	({ file, parents }) as unknown as ResolvedConfig;

describe("ServedConfigs", () => {
	it("should serve the synced config over the source-rooted one it extends", () => {
		const base = config("/repo/default.rogen.json");
		const sync = config("/repo/sync.rogen.json", [base.file]);

		expect(new ServedConfigs([base, sync], undefined).configs).toEqual([
			sync,
		]);
	});

	it("should serve each place and not the config they share", () => {
		const base = config("/repo/default.rogen.json");
		const lobby = config("/repo/lobby.rogen.json", [base.file]);
		const shop = config("/repo/shop.rogen.json", [base.file]);

		expect(
			new ServedConfigs([base, lobby, shop], undefined).configs
		).toEqual([lobby, shop]);
	});

	it("should serve a lone config, and one whose parent isn't selected", () => {
		const lone = config("/repo/default.rogen.json");
		const orphan = config("/repo/lobby.rogen.json", [
			"/other/base.rogen.json",
		]);

		expect(new ServedConfigs([lone, orphan], undefined).configs).toEqual([
			lone,
			orphan,
		]);
	});

	it("should serve the leaves of the configs named, however the extends is written", () => {
		const base = config("/repo/base.rogen.json");
		const lobby = config("/repo/lobby.rogen.json", [
			"/repo/Base.rogen.json",
		]);
		const shop = config("/repo/shop.rogen.json");

		const named = new PathSet([base.file], true);

		expect(
			new ServedConfigs([base, lobby, shop], named, [], true).configs
		).toEqual([lobby]);
	});

	it("should not count the config itself as its own namesake, whatever the letter case", () => {
		const lobby = {
			...config("/repo/lobby.rogen.json"),
			projectName: "Lobby",
		} as unknown as ResolvedConfig;
		const again = {
			...config("/repo/LOBBY.rogen.json"),
			projectName: "Lobby",
		} as unknown as ResolvedConfig;

		expect(
			new ServedConfigs([lobby], undefined, [again], true).namesakesOf(
				lobby
			)
		).toEqual([]);
		expect(
			new ServedConfigs([lobby], undefined, [again], false).namesakesOf(
				lobby
			)
		).toEqual([again]);
	});
});
