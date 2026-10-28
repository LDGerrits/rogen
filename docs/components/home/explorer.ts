export type Service = "s" | "c" | "r";
export type Icon = "svc" | "dir" | "scr" | "mdl";

/** Roblox Studio Explorer icons, as the inner markup of a 16x16 SVG. */
export const icons: Record<Icon, string> = {
	svc: '<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="6" y="6" width="4" height="4" fill="currentColor"/>',
	dir: '<path d="M1.75 3.75h4.5l1.5 1.75h6.5v7.25H1.75z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
	scr: '<path d="M3.25 1.75h6.25l3.25 3.25v9.25h-9.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5.75 8.25h4.5M5.75 11h4.5" stroke="currentColor" stroke-width="1.4"/>',
	mdl: '<path d="M8 1.75l5.5 3v6.5L8 14.25l-5.5-3v-6.5zM2.5 4.75L8 7.75l5.5-3M8 7.75v6.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
};

export const iconSvg = (icon: Icon, cls = "ic") =>
	`<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${icons[icon]}</svg>`;

export type Guide = "pipe" | "none" | "tee" | "end";

/** The tree lines in front of row i, one per level, given each row's depth. */
export function guides(depths: number[], i: number): Guide[] {
	const d = depths[i];
	const more = (level: number) => {
		for (let j = i + 1; j < depths.length; j++)
			if (depths[j] <= level) return depths[j] === level;
		return false;
	};
	const g: Guide[] = [];
	if (!d) return g;
	for (let a = 1; a < d; a++) g.push(more(a) ? "pipe" : "none");
	g.push(more(d) ? "tee" : "end");
	return g;
}

const GLYPHS: Record<Guide, string> = {
	pipe: "│  ",
	none: "   ",
	tee: "├─ ",
	end: "└─ ",
};

/** The tree-drawing prefix of row i, given each row's depth. */
export const glyphs = (depths: number[], i: number) =>
	guides(depths, i)
		.map((guide) => GLYPHS[guide])
		.join("");
