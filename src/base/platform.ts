export const isWindows = process.platform === "win32";

/** Whether the file system ignores letter case by default, which makes `Src` and `src` one folder: Windows' and macOS'. */
export const ignoresPathCase = isWindows || process.platform === "darwin";
