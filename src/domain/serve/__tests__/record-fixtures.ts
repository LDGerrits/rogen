import { BuildSetting } from "../../build/build.js";

/** The file and text of the record a serve left for the Rojo server on `port`. */
export const recordFile = (
	port: number,
	project: string,
	projectFile: string,
	{
		session = "s1",
		setting = { variants: {} },
		pid,
	}: { session?: string; setting?: BuildSetting; pid?: number } = {}
) =>
	[
		`/mock/tmp/rogen-serve/${port}.json`,
		JSON.stringify({
			host: "127.0.0.1",
			port,
			server: "rojo",
			pid,
			session,
			project,
			projectFile,
			mode: setting.mode,
			variants: setting.variants,
		}),
	] as const;
