import { classIconStyle, LUAU_ICON, setiOf } from "../ide";
import type { Icon } from "./explorer";
import type { Lang } from "./lang-script";

/*
 * The routing story: one file, InventoryService@Server.luau or its roblox-ts twin, goes from disk through
 * the routes and the project file into the Studio Explorer as the reader scrolls.
 * Each step has tracks, [state, from, to, easing] as fractions of the step's scroll.
 */
type Ease = "io" | "out";
type Track = [state: string, from: number, to: number, ease: Ease];
type State = Record<string, number>;

// The words of the story in one language: the file that travels, its route and where it lands.
interface Words {
	feature: string;
	file: string;
	suffix: string;
	ext: string;
	disk: string[];
	routes: [key: string, target: string][];
	path: string;
	shared: string;
}
const WORDS: Record<Lang, Words> = {
	luau: {
		feature: "Inventory",
		file: "InventoryService",
		suffix: "@Server",
		ext: ".luau",
		disk: [
			"UI/",
			"InventoryController@Client.luau",
			"InventoryInput@Client.luau",
			"InventoryService@Server.luau",
			"InventoryStore@Server.luau",
			"InventoryTypes.luau",
			"ItemCatalog.luau",
			"ItemIcons.rbxm",
		],
		routes: [
			["Server", "ServerScriptService"],
			["Client", "StarterPlayer/StarterPlayerScripts"],
			["Shared", "ReplicatedStorage/Shared"],
			["*", "ReplicatedStorage/Shared"],
		],
		path: "src/Inventory/InventoryService@Server.luau",
		shared: "Shared",
	},
	// roblox-ts: lowercase keys and folders, kebab-case files as in Next.js; Rojo reads the compiled .luau in out/.
	ts: {
		feature: "inventory",
		file: "inventory-service",
		suffix: "@server",
		ext: ".ts",
		disk: [
			"ui/",
			"inventory-controller@client.ts",
			"inventory-input@client.ts",
			"inventory-service@server.ts",
			"inventory-store@server.ts",
			"inventory-types.ts",
			"item-catalog.ts",
			"item-icons.ts",
		],
		routes: [
			["server", "ServerScriptService"],
			["client", "StarterPlayer/StarterPlayerScripts"],
			["shared", "ReplicatedStorage/shared"],
			["*", "ReplicatedStorage/shared"],
		],
		path: "out/inventory/inventory-service@server.luau",
		shared: "shared",
	},
};
// The language of the mounted story; mountStory sets it before building anything.
let W = WORDS.luau;
// The row that travels.
const FILE = 3;

const STEPS: { kicker: string; line: () => string; tracks: Track[] }[] = [
	{
		kicker: "VS Code",
		line: () =>
			`<span class="cpath">src/<wbr>${W.feature}/<wbr>${W.file}<span class="fi">${W.suffix}</span>${W.ext}</span>`,
		tracks: [
			["walk", 0, 0.5, "io"],
			["found", 0.5, 0.7, "out"],
		],
	},
	{
		kicker: "Your routes",
		line: () =>
			`<code class="pill">"${W.routes[0][0]}": "ServerScriptService"</code>`,
		tracks: [
			["tagIn", 0, 0.12, "out"],
			["trail", 0.12, 0.8, "io"],
			["route", 0.8, 0.9, "out"],
		],
	},
	{
		kicker: "What Rogen writes",
		line: () =>
			"<span><code>rogen serve</code> writes this for you, in the file Rojo reads.</span>",
		tracks: [
			["tab", 0, 0.12, "out"],
			["gap", 0.12, 0.3, "io"],
			["drop", 0.3, 0.5, "io"],
			["strip", 0.5, 0.7, "out"],
		],
	},
	{
		kicker: "Roblox Studio",
		line: () =>
			`<span class="cpath">ServerScriptService/<wbr>${W.feature}/<wbr>${W.file}</span>`,
		tracks: [
			["source", 0, 0.1, "out"],
			["lift", 0.1, 0.2, "out"],
			["ride", 0.2, 0.7, "io"],
			["expand", 0.55, 0.75, "io"],
			["settle", 0.7, 0.85, "out"],
		],
	},
];

// The project-file excerpt; i is the indent unit, wrap splits the "optional" value onto its own line.
const project = (i: string, wrap = false) => ({
	head: [
		`"<span class="feat">${W.feature}</span>": {`,
		`${i}<span class="k">"$className"</span>: <span class="s">"Folder"</span>,`,
	],
	key: `${i}<span class="q">"</span><span class="key">${W.file}</span><span class="q">": {</span>`,
	entry: [
		`${i}${i}<span class="k">"$path"</span>: {`,
		...(wrap
			? [
					`${i}${i}${i}<span class="k">"optional"</span>:`,
					`${i}${i}${i}${i}<span class="val">"${W.path}"</span>`,
				]
			: [
					`${i}${i}${i}<span class="k">"optional"</span>: <span class="val">"${W.path}"</span>`,
				]),
		`${i}${i}}`,
		`${i}},`,
	],
	tail: [`${i}…`, "}"],
});

/*
 * Explorer rows: [name, depth, icon, roles]. service: always there; default: appears when
 * its service expands; arrive: placed by the sync; feature: the feature colour; file: where
 * the chip lands; dim; open/shut: the arrow.
 */
const explorer = (): [string, number, Icon, string][] => [
	["ReplicatedStorage", 0, "svc", "service"],
	[W.shared, 1, "dir", "arrive open"],
	[W.feature, 2, "dir", "arrive feature shut"],
	["ServerScriptService", 0, "svc", "service"],
	[W.feature, 1, "dir", "arrive feature open"],
	[W.file, 2, "scr", "file"],
	[W.disk[4].replace(/@.*/, ""), 2, "scr", "arrive dim"],
	["StarterPlayer", 0, "svc", "service"],
	["StarterPlayerScripts", 1, "svc", "default open"],
	[W.feature, 2, "dir", "arrive feature shut"],
];

interface Metrics {
	tree: number;
	code: number;
	row: number;
	line: number;
	head: number;
	pad: number;
	cpad: number;
	pady: number;
	xpad: number;
	tab: number;
	ind: string;
}
const METRICS: Record<"normal" | "compact" | "mini", Metrics> = {
	normal: {
		tree: 13,
		code: 12.5,
		row: 22,
		line: 22,
		head: 35,
		pad: 14,
		cpad: 14,
		pady: 12,
		xpad: 8,
		tab: 12,
		ind: "  ",
	},
	compact: {
		tree: 12.5,
		code: 12,
		row: 20,
		line: 18,
		head: 30,
		pad: 10,
		cpad: 10,
		pady: 10,
		xpad: 6,
		tab: 10,
		ind: "  ",
	},
	mini: {
		tree: 12.5,
		code: 11,
		row: 20,
		line: 18,
		head: 30,
		pad: 10,
		cpad: 5,
		pady: 8,
		xpad: 6,
		tab: 10,
		ind: " ",
	},
};

type Rect = [x: number, y: number, w: number, h: number];
interface SceneSpec {
	m: keyof typeof METRICS;
	w: number;
	h: number;
	disk?: Rect;
	explorer?: Rect;
	editor?: Rect;
	strip?: Rect;
	routes?: Rect;
	project?: Rect;
	key?: Rect;
	lane1?: number;
	lane2?: number;
}
// Pane rects; wide and compact are the pinned stage (two over one), mini1-4 the small scenes.
const SCENES: Record<string, SceneSpec> = {
	wide: {
		m: "normal",
		w: 760,
		h: 596,
		disk: [0, 0, 300, 296],
		explorer: [466, 0, 294, 296],
		editor: [0, 316, 760, 280],
		lane1: 300,
		lane2: 446,
	},
	compact: {
		m: "compact",
		w: 610,
		h: 494,
		disk: [0, 0, 276, 272],
		explorer: [390, 0, 220, 272],
		editor: [0, 282, 610, 212],
		lane1: 276,
		lane2: 370,
	},
	mini1: { m: "mini", w: 326, h: 264, disk: [28, 0, 270, 264] },
	mini2: {
		m: "mini",
		w: 326,
		h: 260,
		strip: [0, 0, 326, 32],
		routes: [0, 64, 326, 196],
	},
	mini3: { m: "mini", w: 326, h: 246, project: [0, 0, 326, 246] },
	mini4: {
		m: "mini",
		w: 326,
		h: 356,
		key: [0, 0, 326, 32],
		explorer: [16, 80, 310, 276],
	},
};
// The smallest scale the pinned stage may shrink to before the story falls back to minis.
const FLOOR = 0.92;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const bez = (x1: number, y1: number, x2: number, y2: number) => (t: number) => {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	let lo = 0;
	let hi = 1;
	let x = t;
	for (let i = 0; i < 24; i++) {
		x = (lo + hi) / 2;
		const bx =
			3 * x1 * x * (1 - x) ** 2 + 3 * x2 * x * x * (1 - x) + x ** 3;
		if (bx < t) lo = x;
		else hi = x;
	}
	return 3 * y1 * x * (1 - x) ** 2 + 3 * y2 * x * x * (1 - x) + x ** 3;
};
const EASE: Record<Ease, (t: number) => number> = {
	io: bez(0.65, 0, 0.35, 1),
	out: bez(0.16, 1, 0.3, 1),
};

// g runs 0..4 over the story; each state is its track's eased progress. A step's tracks
// are stretched to fill it, so playing from i to i + 1 never pauses.
const stateAt = (g: number) => {
	const S: State = {};
	STEPS.forEach((st, i) => {
		const t = clamp(g - i);
		const fit = 1 / Math.max(...st.tracks.map((tr) => tr[2]));
		st.tracks.forEach(([k, a, b, e]) => {
			S[k] = EASE[e](clamp((t - a * fit) / ((b - a) * fit)));
		});
	});
	return S;
};

type Pt = [number, number];
const off = (el: HTMLElement | null, top: HTMLElement) => {
	let x = 0;
	let y = 0;
	while (el && el !== top) {
		x += el.offsetLeft;
		y += el.offsetTop;
		el = el.offsetParent as HTMLElement | null;
	}
	return { x, y };
};
const lens = (pts: Pt[]) =>
	pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
const total = (pts: Pt[]) => lens(pts).reduce((a, b) => a + b, 0);
const along = (pts: Pt[], f: number): Pt => {
	const seg = lens(pts);
	let s = f * seg.reduce((a, b) => a + b, 0);
	for (let i = 0; i < seg.length; i++) {
		if (s <= seg[i] || i === seg.length - 1) {
			const t = seg[i] ? clamp(s / seg[i]) : 1;
			return [
				pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
				pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
			];
		}
		s -= seg[i];
	}
	return pts[pts.length - 1];
};
// A polyline with rounded corners.
const corner = (pts: Pt[]) => {
	const f = (n: number) => n.toFixed(1);
	let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const [x0, y0] = pts[i - 1];
		const [x1, y1] = pts[i];
		const [x2, y2] = pts[i + 1];
		const l1 = Math.hypot(x1 - x0, y1 - y0);
		const l2 = Math.hypot(x2 - x1, y2 - y1);
		if (!l1 || !l2) continue;
		const rr = Math.min(12, l1 / 2, l2 / 2);
		d += ` L${f(x1 - ((x1 - x0) / l1) * rr)} ${f(y1 - ((y1 - y0) / l1) * rr)} Q${f(x1)} ${f(y1)} ${f(x1 + ((x2 - x1) / l2) * rr)} ${f(y1 + ((y2 - y1) / l2) * rr)}`;
	}
	const [xl, yl] = pts[pts.length - 1];
	return d + ` L${f(xl)} ${f(yl)}`;
};
const px = (r: Rect) =>
	`left:${r[0]}px;top:${r[1]}px;width:${r[2]}px;height:${r[3]}px`;
const line = (html: string, row: number, attrs = "") =>
	`<span class="l"${attrs} style="top:calc(var(--line) * ${row})"><span class="tx">${html}</span></span>`;
const sfx = (n: string) =>
	n.replace(W.suffix, `<span class="sfx">${W.suffix}</span>`);

// VS Code's and Studio's pieces as markup, as components/ide.tsx draws them.
const trafficLights = '<span class="ide-tl"><i></i><i></i><i></i></span>';
const bar = (title: string) =>
	`<div class="ide-bar">${trafficLights}<b>${title}</b></div>`;
const chev = (open: boolean) =>
	`<svg class="ide-chev" viewBox="0 0 16 16"><path d="${open ? "M4 6l4 4 4-4" : "M6 4l4 4-4 4"}"/></svg>`;
const fileIcon = (name: string) => {
	const seti = setiOf(name);
	return seti
		? `<span class="ide-fi seti ${seti[1]}">${seti[0]}</span>`
		: `<span class="ide-fi luau"><svg viewBox="0 0 60 60"><path fill-rule="evenodd" d="${LUAU_ICON}"/></svg></span>`;
};
const classIcon = (name: string) => {
	const style = classIconStyle(name) as Record<string, string>;
	return `<span class="ide-ci" style="--il:${style["--il"]};--id:${style["--id"]}"></span>`;
};
const studioClass = (icon: Icon, name: string) =>
	icon === "svc" ? name : icon === "dir" ? "Folder" : "ModuleScript";
const diskRow = (n: string, depth: number, cls = "") => {
	const folder = n.endsWith("/");
	const name = n.replace(/\/$/, "");
	return `<li${cls ? ` class="${cls}"` : ""} style="--d:${depth}">${folder ? chev(false) : `<span class="ide-chev"></span>${fileIcon(name)}`}<span class="nm">${cls === "file" ? sfx(name) : name}</span></li>`;
};

const diskHTML = () =>
	`${bar("my-game")}<div class="ide-section">${chev(true)}MY-GAME</div><ul class="tree dt"><span class="band"></span><li style="--d:0">${chev(true)}<span class="nm">src</span></li><li style="--d:1">${chev(true)}<span class="nm"><span class="feat">${W.feature}</span></span></li>${W.disk
		.map((n, i) => diskRow(n, 2, i === FILE ? "file" : ""))
		.join("")}</ul>`;
const stripHTML = () =>
	`<ul class="tree dt strip"><span class="band"></span>${diskRow(W.disk[FILE], 0, "file")}</ul>`;
const routesHTML = (M: Metrics) => {
	const i = M.ind;
	const wrap = M === METRICS.mini;
	let r = 0;
	let out = line('"routes": {', r++);
	W.routes.forEach(([k, v], n) => {
		const hit = k === W.routes[0][0] ? " data-hit" : "";
		const end = n < W.routes.length - 1 ? "," : "";
		const first = hit + (hit ? " data-r1" : "");
		if (wrap) {
			out += line(`${i}<span class="k">"${k}"</span>:`, r++, first);
			out += line(
				`${i}${i}<span class="s">"${v}"</span>${end}`,
				r++,
				hit
			);
		} else
			out += line(
				`${i}<span class="k">"${k}"</span>: <span class="s">"${v}"</span>${end}`,
				r++,
				first
			);
	});
	return `<div class="routes">${out + line("}", r)}</div>`;
};
const projHTML = (M: Metrics, top = 0) => {
	const P = project(M.ind, M === METRICS.mini);
	const E = 1 + P.entry.length;
	let out =
		P.head.map((h, r) => line(h, r)).join("") +
		line(P.key, 2, ' data-role="key"');
	out += P.entry.map((h, n) => line(h, 3 + n, ' data-role="entry"')).join("");
	out += P.tail
		.map((h, n) => line(h, 2 + n, ` data-role="tail" data-row="${2 + n}"`))
		.join("");
	return `<div class="proj" data-e="${E}" style="top:${top}px">${out}</div>`;
};
const exHTML = () =>
	`${bar("Explorer")}<div class="ide-search"><span>Search</span><span>•••</span></div><ul class="xt">${explorer()
		.map(([name, d, ic, roles]) => {
			const r = ` ${roles} `;
			const has = (role: string) => r.includes(` ${role} `);
			const arrow =
				has("service") || has("open") || has("shut")
					? `<span class="ar c${has("open") ? "" : " shut"}"></span>`
					: '<span class="ar"></span>';
			return `<li class="x ${roles}" data-r="${roles}" style="--d:${d}">${has("file") ? '<span class="band2"></span><span class="slot"></span>' : ""}${arrow}${classIcon(studioClass(ic, name))}<span class="nm">${name}</span></li>`;
		})
		.join("")}</ul>`;
const crumb =
	'<span class="crumb">tree › <span class="f">ServerScriptService</span></span>';

interface Wire {
	pts: Pt[];
	off: number;
	len?: number;
	poly?: number;
}
interface Geometry {
	xy?: number;
	tag1?: Pt[];
	tag2?: Pt[];
	trail?: Wire;
	chip?: Pt[];
	wire?: Wire;
}
interface Scene {
	name: string;
	el: HTMLDivElement;
	measure: () => void;
	paint: (S: State) => void;
}

// One scene: its DOM, measure() for its paths and paint(S) to draw state S.
function makeScene(name: string): Scene {
	const C = SCENES[name];
	const M = METRICS[C.m];
	const el = document.createElement("div");
	el.className = "stage ide";
	el.style.cssText = `width:${C.w}px;height:${C.h}px;--tree:${M.tree}px;--code:${M.code}px;--row:${M.row}px;--line:${M.line}px;--head:${M.head}px;--pad:${M.pad}px;--cpad:${M.cpad}px;--pady:${M.pady}px;--tab:${M.tab}px`;
	if (C.strip) el.style.setProperty("--tagf", M.tree + "px");
	let h = "";
	if (C.disk)
		h += `<div class="pane p-disk ide-win ide-vs" style="${px(C.disk)}">${diskHTML()}</div>`;
	if (C.strip)
		h += `<div class="pane p-strip ide-win ide-vs" style="${px(C.strip)}">${stripHTML()}</div>`;
	if (C.routes)
		h += `<div class="pane p-routes ide-win ide-ed" style="${px(C.routes)}"><div class="code">${routesHTML(M)}</div></div>`;
	if (C.project)
		h += `<div class="pane p-proj ide-win ide-ed" style="${px(C.project)}"><div class="ed-tabs">${trafficLights}<span class="tab front">default.project.json</span></div><div class="code">${line(crumb, 0)}${projHTML(M, M.line)}</div></div>`;
	if (C.key)
		h += `<div class="pane p-key ide-win ide-ed" style="${px(C.key)}"><div class="code" style="margin:6px 0">${line(project(M.ind).key, 0)}</div></div>`;
	if (C.explorer)
		h += `<div class="pane p-ex ide-win ide-st" style="${px(C.explorer)}">${exHTML()}</div>`;
	if (C.editor) {
		const [x, y, w] = C.editor;
		h += `<div class="pane p-ed ide-win ide-ed" style="${px(C.editor)}"><div class="pane-h"></div><div class="code">${routesHTML(M)}${projHTML(M)}</div></div>`;
		h += `<div class="ed-bar" style="left:${x}px;top:${y}px;width:${w}px">${trafficLights}<span class="tab t1 front">default.rogen.json</span><span class="tab t2">default.project.json</span>${crumb}</div>`;
	}
	h +=
		'<svg class="ln trail" aria-hidden="true"><path d=""/></svg><svg class="ln wire" aria-hidden="true"><path d=""/></svg>';
	h += `<div class="tag" hidden><span class="tn">${W.file}</span><span class="ts">${W.suffix}${W.ext}</span></div>`;
	h += `<div class="chip" hidden>${classIcon("ModuleScript")}<span>${W.file}</span></div>`;
	el.innerHTML = h;

	const q = <T extends Element = HTMLElement>(s: string) =>
		el.querySelector<T>(s);
	const qa = <T extends Element = HTMLElement>(s: string) => [
		...el.querySelectorAll<T>(s),
	];
	let g: Geometry = {};
	const lights: [HTMLElement[], string][] = (
		[
			[".p-disk .feat", "found"],
			[".dt .file .sfx", "found"],
			[".dt .file", "source"],
			[".routes [data-hit]", "route"],
			[".proj .feat", "strip"],
			[".crumb .f", "strip"],
			[".proj .val", "source"],
		] as const
	).map(([s, k]) => [qa(s), k]);
	const lines = qa(".proj .l").map((l) => ({
		l,
		role: l.dataset.role,
		row: +(l.dataset.row || 0),
	}));
	const E = +(q(".proj")?.dataset.e ?? 0);
	const rows = qa(".p-ex .x").map((li) => ({
		li,
		r: ` ${li.dataset.r} `,
		ar: li.querySelector<HTMLElement>(".ar")!,
		slot: li.querySelector<HTMLElement>(".slot"),
	}));
	const tag = q(".tag")!;
	const chip = q(".chip")!;
	const trail = q<SVGPathElement>(".trail path")!;
	const wire = q<SVGPathElement>(".wire path")!;
	const draw = (path: SVGPathElement, d: Wire) => {
		path.setAttribute("d", corner(d.pts));
		d.len = path.getTotalLength();
		d.poly = total(d.pts);
		path.style.strokeDasharray = `${d.len} ${d.len}`;
		path.style.strokeDashoffset = String(d.len);
	};
	const stroke = (path: SVGPathElement, d: Wire, drawn: number) => {
		path.style.strokeDashoffset = (
			d.len! *
			(1 - clamp(drawn / d.poly!))
		).toFixed(1);
	};

	const measure = () => {
		const next: Geometry = {};
		const o = (e: HTMLElement | null) => off(e, el);
		const codeY = (sel: string, r: number) =>
			o(q(sel)).y + r * M.line + M.line / 2;
		const file = q(".dt .file");
		let fx = 0;
		let fy = 0;
		let fe = 0;
		if (file) {
			const nm = file.querySelector<HTMLElement>(".nm")!;
			fx = o(nm).x;
			fe = fx + nm.offsetWidth;
			fy = o(file).y + M.row / 2;
		}
		let ty = 0;
		let sx = 0;
		if (C.explorer) {
			const svc = rows.find((r) => r.r.includes(" file "))!;
			next.xy = o(q(".p-ex .xt")).y;
			ty = next.xy + M.xpad + rows.indexOf(svc) * M.row + M.row / 2;
			sx = o(svc.li.querySelector<HTMLElement>(".nm")).x;
		}
		if (C.editor && C.disk) {
			// The lanes run right of the default.project.json tab, so the lines never cross it.
			const tab = q(".ed-bar .t2")!;
			const lane1 = Math.max(C.lane1!, o(tab).x + tab.offsetWidth + 16);
			const lane2 = Math.max(C.lane2!, lane1 + 24);
			const r1 = codeY(".p-ed .routes", 1);
			const r2 = codeY(".p-ed .proj", 2);
			const kx = o(q(".p-ed .key")).x;
			const ktx = q(".p-ed [data-role='key'] .tx")!;
			const ke = o(ktx).x + ktx.offsetWidth;
			next.tag1 = [
				[fx - 6, fy],
				[lane1, fy],
				[lane1, r1],
			];
			next.trail = {
				pts: [
					[fe + 6, fy],
					[lane1, fy],
					[lane1, r1],
				],
				off: fe + 6 - (fx - 6),
			};
			next.tag2 = [
				[lane1, r1],
				[lane1, r2],
				[kx - 6, r2],
			];
			next.chip = [
				[kx - 21, r2],
				[lane2, r2],
				[lane2, ty],
				[sx - 21, ty],
			];
			next.wire = {
				pts: [
					[ke + 6, r2],
					[lane2, r2],
					[lane2, ty],
					[sx - 21, ty],
				],
				off: ke + 6 - (kx - 21),
			};
		}
		if (C.strip && C.routes) {
			const r1 = q(".p-routes [data-r1]")!;
			const tx = r1.querySelector<HTMLElement>(".tx")!;
			const lane = o(tx).x + tx.offsetWidth + 8;
			const r1y = o(r1).y + M.line / 2;
			const gy = (C.strip[1] + C.strip[3] + C.routes[1]) / 2;
			next.tag1 = [
				[fx - 6, fy],
				[fx - 6, gy],
				[lane, gy],
				[lane, r1y],
			];
			next.trail = {
				pts: [
					[fx - 6, fy + M.row / 2 + 2],
					[fx - 6, gy],
					[lane, gy],
					[lane, r1y],
				],
				off: M.row / 2 + 2,
			};
		}
		if (C.project) {
			const kx = o(q(".p-proj .key")).x;
			const r2 = codeY(".p-proj .proj", 2);
			next.tag2 = [
				[kx - 6, -M.line],
				[kx - 6, r2],
			];
		}
		if (C.key && C.explorer) {
			const kx = o(q(".p-key .key")).x;
			const ky = o(q(".p-key .l")).y + M.line / 2;
			const lane = kx - 21;
			next.chip = [
				[lane, ky],
				[lane, ty],
				[sx - 21, ty],
			];
			next.wire = {
				pts: [
					[lane, ky + 10],
					[lane, ty],
					[sx - 21, ty],
				],
				off: 10,
			};
		}
		if (next.trail) draw(trail, next.trail);
		if (next.wire) draw(wire, next.wire);
		g = next;
	};

	const paint = (S: State) => {
		const v = (n: number) => n.toFixed(3);
		lights.forEach(([els, k]) =>
			els.forEach((e) => e.style.setProperty("--v", v(S[k])))
		);
		const band = q(".p-disk .band");
		if (band)
			band.style.transform = `translateY(${(S.walk * FILE * M.row).toFixed(1)}px)`;
		// Editor tabs.
		if (C.editor) {
			const t2 = q(".ed-bar .t2")!;
			t2.style.opacity = v(S.tab);
			t2.style.transform = `translateX(${(-14 * (1 - S.tab)).toFixed(1)}px)`;
			t2.classList.toggle("front", S.tab >= 0.5);
			q(".ed-bar .t1")!.classList.toggle("front", S.tab < 0.5);
			q(".ed-bar .crumb")!.style.opacity = v(S.tab);
			q(".p-ed .routes")!.style.opacity = v(1 - S.tab);
			q(".p-ed .proj")!.style.opacity = v(S.tab);
		}
		// The project file: the gap opens, the entry fades in.
		lines.forEach(({ l, role, row }) => {
			if (role === "tail")
				l.style.top = `calc(var(--line) * ${(row + E * S.gap).toFixed(3)})`;
			if (role === "entry") l.style.opacity = v(S.strip);
		});
		qa(".proj .q").forEach((e) => (e.style.opacity = v(S.strip)));
		const key = q(".proj .key");
		if (key) key.style.opacity = S.strip >= 1 ? "1" : "0";
		// The name tag: lifts, travels, drops, strips.
		if (g.tag1 || g.tag2) {
			const p =
				g.tag2 && (S.drop > 0 || !g.tag1)
					? along(g.tag2, S.drop)
					: along(g.tag1!, S.trail);
			const on = S.tagIn > 0 && S.strip < 1;
			tag.hidden = !on;
			if (on) {
				const lift = g.tag1
					? -4 * S.tagIn * (1 - clamp((S.trail - 0.85) / 0.15))
					: 0;
				tag.style.opacity = g.tag1 ? v(S.tagIn) : "1";
				tag.style.setProperty("--s", v(S.strip));
				tag.style.transform = `translate(${p[0].toFixed(1)}px, ${(p[1] - (M.line - 2) / 2 + lift).toFixed(1)}px)`;
			}
		}
		if (g.trail && g.tag1)
			stroke(trail, g.trail, S.trail * total(g.tag1) - g.trail.off);
		// Explorer: services expand, rows part, the sync places the folders.
		let fileTop = 0;
		if (rows.length) {
			let y = M.xpad;
			const land = clamp((S.settle - 0.4) / 0.6);
			rows.forEach(({ li, r, ar, slot }) => {
				const service = r.includes(" service ");
				let op = 1;
				let dy = 0;
				if (r.includes(" default ")) op = S.expand;
				if (r.includes(" arrive ")) {
					op = S.settle * (r.includes(" dim ") ? 0.45 : 1);
					dy = -4 * (1 - S.settle);
				}
				if (r.includes(" file ")) {
					fileTop = y;
					li.style.setProperty("--land", v(land));
					if (slot) slot.style.opacity = v(S.expand * (1 - land));
				}
				li.style.transform = `translateY(${(y + dy).toFixed(1)}px)`;
				li.style.opacity = v(op);
				if (service) ar.classList.toggle("shut", S.expand < 0.5);
				y += M.row * (service ? 1 : S.expand);
			});
		}
		// The chip rides the Rojo wire.
		if (g.chip && g.wire && g.xy !== undefined) {
			const ty = g.xy + fileTop + M.row / 2;
			const pts = g.chip.map((p) => p.slice() as Pt);
			const wpts = g.wire.pts;
			pts[pts.length - 1][1] = pts[pts.length - 2][1] = ty;
			wpts[wpts.length - 1][1] = wpts[wpts.length - 2][1] = ty;
			draw(wire, g.wire);
			// The last leg, into the row, takes the last quarter of the ride, while the rows part.
			const head = pts.slice(0, -1);
			const lh = total(head);
			const ll = total(pts.slice(-2));
			const k = 0.75;
			const [x, y] =
				S.ride < k
					? along(head, S.ride / k)
					: along(pts.slice(-2), (S.ride - k) / (1 - k));
			const ridden =
				S.ride < k
					? (lh * S.ride) / k
					: lh + (ll * (S.ride - k)) / (1 - k);
			const fade = clamp((S.settle - 0.4) / 0.6);
			chip.hidden = !(S.lift > 0 && fade < 1);
			chip.style.opacity = v(1 - fade);
			const lift = -4 * S.lift * (1 - clamp((S.ride - 0.9) / 0.1));
			chip.style.transform = `translate(${x.toFixed(1)}px, ${(y - (M.row - 2) / 2 + lift).toFixed(1)}px)`;
			stroke(wire, g.wire, ridden - g.wire.off);
		}
	};

	return { name, el, measure, paint };
}

const num = (i: number) => String(i + 1).padStart(2, "0");
const kick = (i: number) =>
	`<p class="skick"><span class="n">${num(i)}</span> · ${STEPS[i].kicker}</p>`;

/*
 * Mounts the story in root. From 600x600 up the stage pins (CSS sticky) and the scroll
 * picks the step: each step gets a stretch of scroll, and entering it plays the step
 * as a short animation of its own, so the motion is the same however fast or slow the
 * reader scrolls, and the page is never scrolled for them. Below that, each step has
 * its own small scene that plays as it comes into view.
 */
export function mountStory(root: HTMLElement, lang: Lang) {
	W = WORDS[lang];
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const field = root.querySelector<HTMLElement>("[data-field]")!;
	root.querySelector("[data-steps]")!.innerHTML = STEPS.map(
		(s, i) =>
			`<li class="st"><button type="button" aria-label="${num(i)} ${s.kicker}"><span class="n">${num(i)}</span><span class="lb">${s.kicker}</span></button><span class="bar"></span></li>`
	).join("");
	root.querySelector("[data-bodies]")!.innerHTML = STEPS.map(
		(s, i) =>
			`<div class="bd">${kick(i)}<span class="prog"><i></i></span><p class="cline">${s.line()}</p></div>`
	).join("");
	root.querySelector("[data-slides]")!.innerHTML = STEPS.map(
		(s, i) =>
			`<li class="slide">${kick(i)}<p class="cline">${s.line()}</p><div class="mini" aria-hidden="true"></div></li>`
	).join("");
	const stepEls = [...root.querySelectorAll<HTMLElement>(".st")];
	const bodyEls = [...root.querySelectorAll<HTMLElement>(".bd")];
	const pin = root.querySelector<HTMLElement>(".pin")!;
	const odo = root.querySelector<HTMLElement>("[data-odo]")!;
	odo.innerHTML = `<span>${STEPS.map((_, i) => num(i)).join("</span><span>")}</span>`;
	let main: Player | null = null;
	let minis: (Player & { view: HTMLElement; i: number })[] | null = null;
	let mode = "";
	let per = 300;
	// A step becomes active this far (in steps) before its stretch of scroll starts.
	const LEAD = 0.4;
	const short = () => innerHeight < 760;
	// Where the scroll reaches the story: when the pin sticks, centred in the viewport.
	const start = () =>
		root.getBoundingClientRect().top +
		scrollY -
		parseFloat(getComputedStyle(pin).top);
	const raw = () => (scrollY - start()) / per;

	// A scene and how far it has played (shown) towards where the scroll wants it (target).
	interface Player {
		sc: Scene;
		shown: number;
		target: number;
	}
	const players = () => [...(main ? [main] : []), ...(minis ?? [])];

	// Played at one step per 0.8s, faster when a quick scroll skips steps, so it never lags far behind.
	let last = 0;
	let loop = 0;
	const tick = (now: number) => {
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		let moving = false;
		players().forEach((p) => {
			const d = p.target - p.shown;
			if (!d) return;
			const rate = Math.max(1 / 0.8, Math.abs(d) / 1.2);
			p.shown =
				Math.abs(d) <= rate * dt
					? p.target
					: p.shown + Math.sign(d) * rate * dt;
			p.sc.paint(stateAt(p.shown));
			moving ||= p.shown !== p.target;
		});
		loop = moving ? requestAnimationFrame(tick) : 0;
	};
	const play = () => {
		if (loop) return;
		last = performance.now();
		loop = requestAnimationFrame(tick);
	};

	// Captions and the step bars follow the scroll directly; they are the scroll's feedback.
	const captions = (r: number) => {
		const n = clamp(Math.floor(r + LEAD), 0, STEPS.length - 1);
		const fill = (i: number) =>
			String(i < n ? 1 : i === n ? clamp(r + LEAD - n).toFixed(3) : 0);
		stepEls.forEach((el, i) => {
			el.classList.toggle("on", i === n);
			el.classList.toggle("done", i < n);
			el.style.setProperty("--f", fill(i));
		});
		bodyEls.forEach((el, i) => {
			el.classList.toggle("on", i === n);
			el.querySelector<HTMLElement>(".prog")!.style.setProperty(
				"--f",
				fill(i)
			);
		});
		odo.style.setProperty("--g", String(n));
		field.style.setProperty("--drift", (r * 60).toFixed(1));
	};

	// Picks the layout and scales the stage into the field; false when even compact falls below the floor.
	const fit = () => {
		const tight = short();
		const ix = tight ? 24 : 40;
		const iy = tight ? 24 : 40;
		const fw = field.clientWidth - ix;
		const fh = field.clientHeight - iy;
		const scale = (n: string) =>
			Math.min(1, fw / SCENES[n].w, fh / SCENES[n].h);
		const name = tight
			? "compact"
			: scale("wide") >= FLOOR
				? "wide"
				: "compact";
		if (scale(name) < FLOOR) return false;
		if (!main || main.sc.name !== name) {
			main?.sc.el.remove();
			main = { sc: makeScene(name), shown: 0, target: 0 };
			field.appendChild(main.sc.el);
		}
		main.sc.measure();
		const s = scale(name);
		main.sc.el.style.transform = s < 1 ? `scale(${s.toFixed(4)})` : "";
		return true;
	};

	// Step i plays from i to i + 1; before the first step the stage shows its opening picture.
	const update = () => {
		if (mode === "pinned" && main) {
			const r = raw();
			captions(r);
			main.target = clamp(Math.floor(r + LEAD) + 1, 0, STEPS.length);
		} else if (mode === "minis" && minis)
			minis.forEach((m) => {
				const b = m.view.getBoundingClientRect();
				m.target = b.top < innerHeight * 0.75 ? m.i + 1 : m.i;
			});
		play();
	};
	const setMode = (next: string) => {
		mode = next;
		root.dataset.mode = mode;
		root.classList.toggle("short", mode === "pinned" && short());
		root.style.height =
			mode === "pinned"
				? `calc(var(--ph) + ${(STEPS.length - LEAD - 0.2) * per}px)`
				: "";
	};
	// Lays the story out and shows where the scroll is now, without playing anything.
	const setup = () => {
		per = clamp(innerHeight * 0.32, 220, 320);
		setMode(innerWidth < 600 || innerHeight < 600 ? "minis" : "pinned");
		if (mode === "pinned" && !fit()) setMode("minis");
		if (mode === "minis")
			minis ??= [...root.querySelectorAll<HTMLElement>(".slide")].map(
				(li, i) => {
					const sc = makeScene("mini" + (i + 1));
					const view = li.querySelector<HTMLElement>(".mini")!;
					view.appendChild(sc.el);
					return { sc, view, i, shown: i, target: i };
				}
			);
		minis?.forEach((m) => m.sc.measure());
		update();
		players().forEach((p) => {
			p.shown = p.target;
			p.sc.paint(stateAt(p.shown));
		});
	};

	const jumps = stepEls.map((el, i) => {
		const go = () => {
			if (mode !== "pinned") return;
			scrollTo({
				top: start() + (i + 0.1) * per,
				behavior: reduce ? "auto" : "smooth",
			});
		};
		el.querySelector("button")!.addEventListener("click", go);
		return go;
	});

	let frame = 0;
	const onScroll = () => {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			update();
		});
	};
	let resize = 0;
	const onResize = () => {
		cancelAnimationFrame(resize);
		resize = requestAnimationFrame(setup);
	};
	setup();
	document.fonts?.ready.then(setup);
	addEventListener("scroll", onScroll, { passive: true });
	addEventListener("resize", onResize);

	return () => {
		removeEventListener("scroll", onScroll);
		removeEventListener("resize", onResize);
		cancelAnimationFrame(frame);
		cancelAnimationFrame(resize);
		cancelAnimationFrame(loop);
		stepEls.forEach((el, i) =>
			el.querySelector("button")!.removeEventListener("click", jumps[i])
		);
		field.textContent = "";
		root.style.height = "";
		delete root.dataset.mode;
	};
}
