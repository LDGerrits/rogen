const FORBIDDEN_CHARACTERS = /[<>:"|?*]/;
const CONTROL_CHARACTER = 32;
const WINDOWS_DEVICES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const PortableName = {
	/** Why `name` cannot be a file or folder name on every system Roblox developers use, or nothing when it can. */
	problemWith(name: string, stem: string): string | undefined {
		if (name.includes("\\"))
			return "has a backslash, which is read as a folder separator, so Rogen leaves it out";
		const forbidden =
			FORBIDDEN_CHARACTERS.exec(name)?.[0] ??
			[...name].find((c) => c.charCodeAt(0) < CONTROL_CHARACTER);
		if (forbidden !== undefined)
			return `has ${JSON.stringify(forbidden)}, which Windows file names cannot hold`;
		if (WINDOWS_DEVICES.test(name.split(".")[0]))
			return "is the name of a Windows device, which Windows cannot create";
		if (/[ .]$/.test(stem))
			return "ends in a space or a dot, which Windows removes from the end of a name";
		return undefined;
	},
} as const;
