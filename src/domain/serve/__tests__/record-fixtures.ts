export const recordFile = (
	port: number,
	project: string,
	projectFile: string,
	{
		session = "s1",
		clients,
	}: {
		session?: string;
		clients?: number;
	} = {}
) =>
	[
		`/mock/tmp/rogen-serve/${port}.json`,
		JSON.stringify({
			host: "127.0.0.1",
			port,
			server: "rojo",
			clients,
			session,
			project,
			projectFile,
		}),
	] as const;
