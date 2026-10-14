export const isWindows = process.platform === "win32";

/** Whether `Src` and `src` are one folder by default: Windows and macOS. */
export const ignoresPathCase = isWindows || process.platform === "darwin";
