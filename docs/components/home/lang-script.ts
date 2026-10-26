/** The language the home page's examples are written in. */
export type Lang = "luau" | "ts";

// Shared with the docs' Luau / roblox-ts tabs (groupId "language"), so a choice made in one shows in the other.
export const LANG_KEY = "language";
export const LANG_VALUE: Record<Lang, string> = {
	luau: "Luau",
	ts: "roblox-ts",
};

/** Runs before the page paints, so a roblox-ts reader never sees the Luau examples first. */
export const LANG_SCRIPT = `try{var v=sessionStorage.getItem("${LANG_KEY}")||localStorage.getItem("${LANG_KEY}");if(v==="${LANG_VALUE.ts}")document.documentElement.dataset.lang="ts"}catch(e){}`;
