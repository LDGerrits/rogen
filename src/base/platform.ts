export const isWindows = process.platform === "win32";

export const ignoresPathCase = isWindows || process.platform === "darwin";
