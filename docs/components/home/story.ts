import {
	building,
	fill,
	kit,
	v,
	type Point,
	type Point3,
	type Service,
	type ViewBox,
} from "./iso";

// Progress P runs from 0 to 4; step i plays while P goes from i to i + 1.
const STEPS = [
	{
		kicker: "01 · On disk",
		line: '<code>src/<wbr><b class="feat">Inventory</b>/<wbr>InventoryService<span class="file">@Server</span>.luau</code>',
	},
	{
		kicker: "02 · Your routes",
		line: '<code class="pill"><span class="file">"Server"</span>: "ServerScriptService"</code>',
	},
	{
		kicker: "03 · What Rogen writes",
		line: '<span class="sent"><code>rogen serve</code> writes this for you, in the file Rojo reads.</span>',
	},
	{
		kicker: "04 · Roblox Studio",
		line: '<code>ServerScriptService/<wbr><b class="feat">Inventory</b>/<wbr><span class="file">InventoryService</span></code>',
	},
];

const STAGE_LABEL =
	"The name InventoryService@Server.luau is read from src/Inventory, matched to the Server route in default.rogen.json, and written into default.project.json as InventoryService inside an Inventory folder. Rojo syncs it into Roblox Studio as ServerScriptService/Inventory/InventoryService, with an Inventory folder under each of the three services.";

type Range = [number, number];

// Timing inside a step, as fractions of its scroll.
const T: Record<string, Range> = {
	walk: [0, 0.5],
	name: [0.5, 0.7],
	tagIn: [0, 0.12],
	travel: [0.12, 0.8],
	serverLine: [0.8, 0.9],
	tab: [0, 0.12],
	gap: [0.12, 0.3],
	drop: [0.3, 0.4],
	slide: [0.4, 0.5],
	strip: [0.5, 0.7],
	preLight: [0, 0.1],
	lift: [0.1, 0.2],
	ride: [0.2, 0.7],
	rooms: [0.55, 0.75],
	land: [0.7, 0.85],
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const easeIO = (t: number) =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const seg = (t: number, r: Range) => clamp01((t - r[0]) / (r[1] - r[0]));
const loc = (P: number, i: number) => clamp01(P - i);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const f1 = (n: number) => n.toFixed(1);

interface StoryBuilding {
	x: number;
	y: number;
	w: number;
	d: number;
	h: number;
	cap: number;
	door: number;
	name: string;
	room: { x: number; y: number; w: number; d: number; h: number };
}

type Cell = [string, Service, number, number, number, boolean?];

const SK = kit(440, 60, 40);
const STREET = 5.0;
const JUNCTION_X = 7.4;
const PLOT = { x: 0.9, y: 6.8, w: 5.0, d: 2.8, h: 0.16 };
// Tree order: the highlight walks the back row to InventoryService.
const CELLS: Cell[] = [
	["UI", "r", 1.6, 7.5, 0, true],
	["InventoryController", "c", 2.8, 7.5, 0.5],
	["InventoryInput", "c", 4.0, 7.5, 0.42],
	["InventoryService", "s", 5.2, 7.5, 0.38],
	["InventoryStore", "s", 1.6, 8.7, 0.42],
	["InventoryTypes", "r", 2.8, 8.7, 0.55],
	["ItemCatalog", "r", 4.0, 8.7, 0.45],
	["ItemIcons", "r", 5.2, 8.7, 0.5],
];
const LANE: Point[] = [
	[5.2, 7.5],
	[7.4, 7.5],
	[7.4, 5.0],
];
const SERVER_ROAD: Point[] = [
	[7.4, 5.0],
	[11.0, 5.0],
	[11.0, 3.2],
];
const withRoom = (b: Omit<StoryBuilding, "room">): StoryBuilding => ({
	...b,
	room: {
		x: b.x + b.w * 0.22,
		y: b.y + 0.22,
		w: b.w * 0.56,
		d: b.d * 0.38,
		h: 0.5,
	},
});
const BLD: Record<Service, StoryBuilding> = {
	r: withRoom({
		x: 0.4,
		y: 1.0,
		w: 3.2,
		d: 2.1,
		h: 1.2,
		cap: 0.26,
		door: 1.9,
		name: "ReplicatedStorage",
	}),
	c: withRoom({
		x: 4.2,
		y: 1.1,
		w: 2.6,
		d: 2.0,
		h: 2.4,
		cap: 0.22,
		door: 5.5,
		name: "StarterPlayer",
	}),
	s: withRoom({
		x: 9.0,
		y: 0.6,
		w: 4.0,
		d: 2.6,
		h: 1.4,
		cap: 0.18,
		door: 11.0,
		name: "ServerScriptService",
	}),
};
const SERVICES: Service[] = ["r", "c", "s"];
const FILE = CELLS[3];
const FILE_TOP = 0.16 + FILE[4];

function drawScene(svg: SVGSVGElement, withPlot: boolean) {
	const K = SK;
	let s =
		K.box(0, 0, -0.45, 13.6, 10.8, 0.45, "plate") +
		K.studs(0, 0, 13.6, 10.8, 0);
	const roads: Point[][] = [
		[
			[0.4, STREET],
			[13.2, STREET],
		],
		[
			[5.9, 7.5],
			[JUNCTION_X, 7.5],
			[JUNCTION_X, STREET],
		],
		SERVER_ROAD.slice(1),
	];
	Object.values(BLD).forEach((b) =>
		roads.push([
			[b.door, STREET],
			[b.door, b.y + b.d],
		])
	);
	roads.forEach((r) => (s += K.road(r)));
	roads.forEach((r) => (s += K.centre(r)));
	s += K.quad(
		JUNCTION_X - 0.75,
		STREET - 0.75,
		0,
		1.5,
		1.5,
		fill(v("junction"))
	);
	s += K.quad(
		JUNCTION_X - 0.75,
		STREET - 0.75,
		0.005,
		1.5,
		1.5,
		`fill="none" style="stroke:${v("junction-line")}" stroke-width="1.3"`
	);
	SERVICES.forEach((k) => {
		const b = building(K, k, BLD[k], { cap: BLD[k].cap, stripe: 0.26 });
		s += `<g>${b.body}<g data-cap="${k}">${b.roof}</g></g>`;
	});
	if (withPlot) {
		s += K.box(PLOT.x, PLOT.y, 0, PLOT.w, PLOT.d, PLOT.h, "plot");
		CELLS.forEach(([, k, x, y, h, stack]) => {
			s += stack
				? K.box(x - 0.33, y - 0.33, 0.16, 0.66, 0.66, 0.3, "c" + k) +
					K.box(x - 0.33, y - 0.33, 0.5, 0.66, 0.66, 0.3, "c" + k)
				: K.box(x - 0.33, y - 0.33, 0.16, 0.66, 0.66, h, "c" + k);
		});
	}
	s += '<g data-k="rooms"></g><g data-k="landed"></g>';
	svg.innerHTML = `<g data-k="base">${s}</g>`;
}

// The silhouette of a box, as world points.
const silhouette = (
	x: number,
	y: number,
	z: number,
	w: number,
	d: number,
	h: number
): Point3[] => [
	[x, y, z + h],
	[x + w, y, z + h],
	[x + w, y, z],
	[x + w, y + d, z],
	[x, y + d, z],
	[x, y + d, z + h],
];

// viewBoxes in scene units: the full scene, crops to the plot, junction and buildings, and the mini-scenes.
const VB: Record<string, ViewBox> = {
	full: [58, 22, 862, 552],
	crop: [131, 22, 754, 356],
	cropTop: [131, 52, 754, 326],
	m0: [125, 196, 300, 186],
	m1: [125, 196, 500, 186],
	m3: [268, 14, 640, 380],
};

interface Metrics {
	fs: number;
	lh: number;
	padX: number;
	padY: number;
	tabH: number;
	bcH: number;
}
const MET: Record<"normal" | "compact" | "mini", Metrics> = {
	normal: { fs: 12.5, lh: 24, padX: 14, padY: 12, tabH: 34, bcH: 24 },
	compact: { fs: 12, lh: 18, padX: 12, padY: 10, tabH: 30, bcH: 18 },
	mini: { fs: 11, lh: 17, padX: 12, padY: 10, tabH: 28, bcH: 17 },
};

const routesRows = (ind: string) => [
	'"routes": {',
	`${ind}<span class="lit">"Server": "ServerScriptService",</span>`,
	`${ind}"Client": "StarterPlayer/StarterPlayerScripts",`,
	`${ind}"Shared": "ReplicatedStorage/Shared",`,
	`${ind}"*": "ReplicatedStorage/Shared"`,
	"}",
];
const KEY =
	'<i class="q">"</i><span class="key">InventoryService</span><i class="q">": {</i>';
// Project-file rows: markup, final row and, when shown in the first state, the first row.
type ProjectRow = [string, number, number?];
const PROJECT: Record<"main" | "mini", ProjectRow[]> = {
	main: [
		['"<b class="feat">Inventory</b>": {', 0, 0],
		['  "$className": "Folder",', 1, 1],
		["  " + KEY, 2],
		['    "$path": {', 3],
		[
			'      "optional": <span class="pv">"src/Inventory/InventoryService@Server.luau"</span>',
			4,
		],
		["    }", 5],
		["  },", 6],
		["  …", 7, 2],
		["}", 8, 3],
	],
	mini: [
		['"<b class="feat">Inventory</b>": {', 0, 0],
		[' "$className": "Folder",', 1, 1],
		[" " + KEY, 2],
		['  "$path": {', 3],
		['   "optional":', 4],
		[
			'    <span class="pv">"src/Inventory/InventoryService@Server.luau"</span>',
			5,
		],
		["  }", 6],
		[" },", 7],
		[" …", 8, 2],
		["}", 9, 3],
	],
};
const MODULE_ICON =
	'<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/><path d="M4 4.5h4M4 7.5h2.5"/></svg>';

type CardVariant = "main" | "m1" | "m2" | "strip";

interface Geometry {
	met: Metrics;
	cw: number;
	px?: (x: number, y: number, z?: number) => Point;
	card?: {
		x: number;
		y: number;
		w: number;
		h: number;
		top: number;
		variant: CardVariant;
	};
	rowY: (i: number) => number;
	colX: (c: number) => number;
	tagW: number;
	tagH: number;
	chipW: number;
	chipH: number;
	blk?: Point;
	plotSil?: Point[];
	junction?: Point;
	server?: Point[];
	path?: Point[];
	pathLen: number;
	junctionAt: number;
	rest?: Point;
	tail?: Point[];
	keyTag?: Point;
	rail?: Point[];
	chipPath?: Point[];
	chipLen: number;
	roomTop?: Point;
	trailLen: number;
	roadLen: number;
}

interface View {
	mini: boolean;
	mi: number;
	gfx: HTMLDivElement;
	sc: SVGSVGElement | null;
	ov: SVGSVGElement;
	card: HTMLDivElement | null;
	tabbar: HTMLDivElement | null;
	tag: HTMLDivElement;
	chip: HTMLDivElement;
	cur: SVGPolygonElement;
	trail: SVGPathElement;
	road: SVGPathElement;
	feats: SVGGElement;
	rail: SVGPathElement[];
	lbl: Record<string, HTMLElement>;
	rooms?: SVGGElement;
	landed?: SVGGElement;
	caps: Record<string, SVGGElement>;
	cap?: HTMLDivElement;
	g?: Geometry;
}

interface LayoutOptions {
	met: Metrics;
	vb?: ViewBox;
	s?: number;
	scene?: { x: number; y: number };
	card?: { x: number; y: number; w: number; variant: CardVariant };
	rest: "line" | "above";
	rail?: boolean;
	yGap?: number;
	juncAbove?: boolean;
	w: number;
	h: number;
	maxX?: number;
}

const isStrip = (g: Geometry) => g.card?.variant === "strip";

const polyLen = (pts: Point[]) =>
	pts.reduce(
		(L, p, i) =>
			i ? L + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0,
		0
	);

function along(pts: Point[], d: number): Point {
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
		if (d <= l || i === pts.length - 1) {
			const t = l ? clamp01(d / l) : 0;
			return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
		}
		d -= l;
	}
	return pts[pts.length - 1];
}

const dpath = (pts: Point[]) =>
	"M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join("L");
const pointList = (pts: Point[]) =>
	pts.map((p) => p.map(f1).join(",")).join(" ");

function normal(a: Point, b: Point): Point {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const l = Math.hypot(dx, dy) || 1;
	return [-dy / l, dx / l];
}

// A rail: two 1px lines 5px apart with a tie every 9px.
function railPaths(pts: Point[]) {
	const offset = (d: number) =>
		pts.map((p, i): Point => {
			const a = pts[Math.max(0, i - 1)];
			const b = pts[Math.min(pts.length - 1, i + 1)];
			const n1 = i ? normal(a, p) : normal(p, b);
			const n2 = i < pts.length - 1 ? normal(p, b) : n1;
			const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
			return [
				p[0] + ((n1[0] + n2[0]) / k) * d,
				p[1] + ((n1[1] + n2[1]) / k) * d,
			];
		});
	let ties = "";
	for (let i = 1; i < pts.length; i++) {
		const a = pts[i - 1];
		const b = pts[i];
		const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
		const n = normal(a, b);
		for (let s = 4; s < l - 2; s += 9) {
			const x = lerp(a[0], b[0], s / l);
			const y = lerp(a[1], b[1], s / l);
			ties += `M${f1(x - n[0] * 4.5)} ${f1(y - n[1] * 4.5)}L${f1(x + n[0] * 4.5)} ${f1(y + n[1] * 4.5)}`;
		}
	}
	return [dpath(offset(2.5)), dpath(offset(-2.5)), ties];
}

const setA = (el: Element | null | undefined, a: number) => {
	if (el) (el as HTMLElement).style.setProperty("--a", a.toFixed(3));
};

/** Positions a box element; ax/ay are the anchor inside it (0 left/top, .5 centre, 1 right/bottom). */
function put(
	el: HTMLElement | undefined,
	x: number,
	y: number,
	ax = 0.5,
	ay = 0.5,
	maxW = 0
) {
	if (!el) return;
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	let l = x - w * ax;
	if (maxW) l = Math.max(2, Math.min(maxW - w - 2, l));
	el.style.transform = `translate(${f1(l)}px,${f1(y - h * ay)}px)`;
	return l;
}

/** Runs the routing story inside `root`: a pinned stage, mini-scenes on small screens, or a static end state. */
export function mountStory(root: HTMLElement) {
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const stageEl = root.querySelector<HTMLElement>(".stage")!;
	const stageView = stageEl.querySelector<HTMLElement>(".view")!;
	const minisEl = root.querySelector<HTMLElement>(".minis")!;

	const probe = document.createElement("span");
	probe.style.cssText =
		"position:absolute;visibility:hidden;white-space:pre;font-family:var(--mono)";
	root.appendChild(probe);
	const charW = (fs: number) => {
		probe.style.fontSize = fs + "px";
		probe.textContent = "0".repeat(40);
		return probe.getBoundingClientRect().width / 40;
	};

	function makeView(host: HTMLElement, kind: string): View {
		const mini = kind !== "main";
		const mi = mini ? +kind[1] : -1;
		const hasScene = !mini || mi !== 2;
		const hasCard = !mini || mi === 1 || mi === 2;
		const strip = mi === 3;
		const gfx = document.createElement("div");
		gfx.className = "gfx";
		if (mini) {
			gfx.setAttribute("aria-hidden", "true");
			gfx.dataset.allowOverflow = "";
		} else {
			gfx.setAttribute("role", "img");
			gfx.setAttribute("aria-label", STAGE_LABEL);
		}
		let h = "";
		if (hasScene) h += '<svg class="sc" aria-hidden="true"></svg>';
		if (hasScene && mi !== 3)
			h +=
				'<div class="lbl blk" data-l="blk"><span class="tn">InventoryService</span><span class="file">@Server</span>.luau</div><div class="lbl" data-l="plot">src/<b class="feat">Inventory</b>/</div>';
		if (hasScene && mi !== 0 && mi !== 3)
			h +=
				'<div class="lbl" data-l="junc">default.rogen.json</div><div class="lbl" data-l="srv">"Server"</div>';
		if (hasScene && (!mini || mi === 3))
			h +=
				SERVICES.map(
					(k) =>
						`<div class="lbl bld" data-l="b${k}" style="--lk:var(--k${k});--lb:var(--c${k})">${BLD[k].name}</div><div class="lbl room" data-l="m${k}"><b class="feat">Inventory</b></div>`
				).join("") + '<div class="lbl" data-l="rojo">Rojo</div>';
		if (hasCard || strip)
			h +=
				'<div class="card"><div class="bc"></div><div class="pg rog"></div><div class="pg proj"></div></div>';
		h +=
			'<svg class="ov" aria-hidden="true"><g class="feats"></g><path class="road"/><path class="trail"/><g class="rail"><path/><path/><path/></g><polygon class="cur"/></svg>';
		if (hasCard && !strip)
			h +=
				'<div class="tabbar"><span class="t" data-t="rog">default.rogen.json</span><span class="t" data-t="proj">default.project.json</span></div>';
		h += `<div class="tag"><span class="tn">InventoryService</span><span class="ts">@Server.luau</span></div><div class="chip">${MODULE_ICON}<span>InventoryService</span></div>`;
		gfx.innerHTML = h;
		host.appendChild(gfx);
		const q = <E extends Element>(s: string) => gfx.querySelector<E>(s);
		const view: View = {
			mini,
			mi,
			gfx,
			sc: q<SVGSVGElement>(".sc"),
			ov: q<SVGSVGElement>(".ov")!,
			card: q<HTMLDivElement>(".card"),
			tabbar: q<HTMLDivElement>(".tabbar"),
			tag: q<HTMLDivElement>(".tag")!,
			chip: q<HTMLDivElement>(".chip")!,
			cur: q<SVGPolygonElement>(".cur")!,
			trail: q<SVGPathElement>(".trail")!,
			road: q<SVGPathElement>(".road")!,
			feats: q<SVGGElement>(".feats")!,
			rail: [...gfx.querySelectorAll<SVGPathElement>(".rail path")],
			lbl: {},
			caps: {},
		};
		gfx.querySelectorAll<HTMLElement>("[data-l]").forEach(
			(e) => (view.lbl[e.dataset.l!] = e)
		);
		if (view.sc) {
			drawScene(view.sc, mi !== 3);
			view.rooms = view.sc.querySelector<SVGGElement>("[data-k=rooms]")!;
			view.landed =
				view.sc.querySelector<SVGGElement>("[data-k=landed]")!;
			view.sc
				.querySelectorAll<SVGGElement>("[data-cap]")
				.forEach((c) => (view.caps[c.dataset.cap!] = c));
		}
		if (!mini) {
			view.cap = document.createElement("div");
			view.cap.className = "cap";
			host.appendChild(view.cap);
		}
		return view;
	}

	function fillCard(view: View, met: Metrics, variant: CardVariant) {
		const ind = variant === "main" ? "  " : " ";
		const card = view.card!;
		const rog = card.querySelector<HTMLElement>(".rog")!;
		const proj = card.querySelector<HTMLElement>(".proj")!;
		const bc = card.querySelector<HTMLElement>(".bc")!;
		const top =
			(variant === "strip" ? 0 : met.tabH) +
			met.padY +
			(variant === "main" || variant === "m2" ? met.bcH : 0);
		const row = (html: string, i: number, cls = "") =>
			`<div class="row ${cls}" style="top:${top + i * met.lh}px;left:${met.padX}px;font-size:${met.fs}px;line-height:${met.lh}px;height:${met.lh}px">${html}</div>`;
		if (variant === "strip") {
			rog.innerHTML = row(KEY, 0);
			proj.innerHTML = "";
			bc.style.display = "none";
		} else {
			rog.innerHTML = routesRows(ind)
				.map((r, i) => row(r, i))
				.join("");
			const rows = PROJECT[variant === "main" ? "main" : "mini"];
			proj.innerHTML =
				variant === "m1"
					? ""
					: rows
							.map(([html, at, first]) =>
								row(
									html,
									first ?? at,
									first != null && first !== at
										? "mv"
										: first == null
											? "nw"
											: ""
								)
							)
							.join("");
			proj.querySelectorAll<HTMLElement>(".row").forEach((r, i) => {
				r.dataset.at = String(rows[i][1]);
				r.dataset.first = String(rows[i][2] ?? "");
			});
			bc.style.cssText =
				variant === "m1"
					? "display:none"
					: `top:${met.tabH + met.padY}px;left:${met.padX}px;font-size:${met.fs}px;line-height:${met.bcH}px;height:${met.bcH}px`;
			bc.innerHTML =
				'tree › <span class="file">ServerScriptService</span>';
			if (view.tabbar)
				view.tabbar.querySelector<HTMLElement>(
					"[data-t=proj]"
				)!.style.display = variant === "m1" ? "none" : "";
		}
		const rows =
			variant === "strip"
				? 1
				: variant === "m1"
					? 6
					: variant === "main"
						? 9
						: 10;
		return { top, h: top + rows * met.lh + met.padY };
	}

	function layoutView(view: View, o: LayoutOptions) {
		const g: Geometry = {
			met: o.met,
			cw: charW(o.met.fs),
			rowY: () => 0,
			colX: () => 0,
			tagW: 0,
			tagH: 0,
			chipW: 0,
			chipH: 0,
			pathLen: 0,
			junctionAt: 0,
			chipLen: 0,
			trailLen: 0,
			roadLen: 0,
		};
		const pad = o.met.fs >= 12.5 ? "3px 4px" : "2px 3px";
		[view.tag, view.chip].forEach((e) => {
			e.style.fontSize = o.met.fs + "px";
			e.style.padding = pad;
		});
		view.gfx.querySelectorAll<HTMLElement>(".lbl.blk").forEach((e) => {
			e.style.fontSize = o.met.fs + "px";
			e.style.padding = pad;
		});
		if (view.sc && o.vb && o.s && o.scene) {
			const [vx, vy, vw, vh] = o.vb;
			const s = o.s;
			const scene = o.scene;
			view.sc.setAttribute("viewBox", o.vb.join(" "));
			view.sc.style.width = vw * s + "px";
			view.sc.style.height = vh * s + "px";
			view.sc.style.transform = `translate(${scene.x}px,${scene.y}px)`;
			g.px = (x, y, z = 0) => {
				const [ux, uy] = SK.P(x, y, z);
				return [scene.x + (ux - vx) * s, scene.y + (uy - vy) * s];
			};
		}
		if (view.card && o.card) {
			const met = o.met;
			const c = o.card;
			const f = fillCard(view, met, c.variant);
			g.card = {
				x: c.x,
				y: c.y,
				w: c.w,
				h: f.h,
				top: f.top,
				variant: c.variant,
			};
			Object.assign(view.card.style, {
				width: c.w + "px",
				height: f.h + "px",
				transform: `translate(${c.x}px,${c.y}px)`,
			});
			if (view.tabbar)
				Object.assign(view.tabbar.style, {
					width: c.w + "px",
					height: met.tabH + "px",
					transform: `translate(${c.x}px,${c.y}px)`,
				});
			g.rowY = (i) => c.y + f.top + i * met.lh + met.lh / 2;
			g.colX = (col) => c.x + met.padX + col * g.cw;
		}
		view.tag.style.display = view.chip.style.display = "";
		g.tagW = view.tag.offsetWidth;
		g.tagH = view.tag.offsetHeight;
		g.chipW = view.chip.offsetWidth;
		g.chipH = view.chip.offsetHeight;
		const tagPad = parseFloat(getComputedStyle(view.tag).paddingLeft) + 1;
		const ind = g.card?.variant === "main" ? 2 : 1;
		if (g.px) {
			const px = g.px;
			const L = view.lbl;
			const fileTop = px(FILE[2], FILE[3], FILE_TOP);
			if (L.blk) {
				const left = put(
					L.blk,
					fileTop[0],
					fileTop[1] - 12,
					0.5,
					1,
					o.w
				)!;
				g.blk = [
					left + L.blk.offsetWidth / 2,
					fileTop[1] - 12 - L.blk.offsetHeight / 2,
				];
			}
			if (L.plot) {
				const a = px(PLOT.x + PLOT.w * 0.5, PLOT.y + PLOT.d, 0);
				put(L.plot, a[0] - 30, a[1] + 14, 0.5, 0.5, o.w);
			}
			if (L.junc) {
				if (o.juncAbove) {
					const a = px(JUNCTION_X - 0.75, STREET - 0.75, 0);
					put(L.junc, a[0] + 20, a[1] - 18, 0.5, 1, o.w);
				} else {
					const a = px(JUNCTION_X + 0.75, STREET - 0.75, 0);
					put(L.junc, a[0] + 6, a[1] + 4, 0, 0.5);
				}
			}
			if (L.srv) {
				const a = px(9.0, STREET + 0.3, 0);
				put(L.srv, a[0], a[1] + 8, 0.5, 0, o.w);
			}
			SERVICES.forEach((k) => {
				const b = BLD[k];
				const rm = b.room;
				if (L["b" + k]) {
					const a = px(
						b.x + b.w * 0.5,
						b.y + b.d,
						k === "s" ? b.h : b.h * 0.62
					);
					put(L["b" + k], a[0], a[1], 0.5, 0.5, o.w);
				}
				if (L["m" + k]) {
					const a = px(rm.x + rm.w / 2, rm.y + rm.d / 2, b.h + rm.h);
					put(L["m" + k], a[0], a[1] - 22, 0.5, 1, o.w);
				}
			});
			g.plotSil = silhouette(
				PLOT.x,
				PLOT.y,
				0,
				PLOT.w,
				PLOT.d,
				PLOT.h
			).map((p) => px(...p));
			g.junction = px(JUNCTION_X, STREET, 0);
			g.server = SERVER_ROAD.map((p) => px(p[0], p[1], 0));
		}
		// The tag's path: off the label, along the lane to the junction, then down into the card.
		if (g.blk && g.card && g.px && g.junction && !isStrip(g)) {
			const px = g.px;
			const rest: Point =
				o.rest === "line"
					? [g.colX(ind + 32) + 4 + g.tagW / 2, g.rowY(1)]
					: [
							g.card.x + g.card.w - g.tagW / 2 - 2,
							g.card.y - g.tagH / 2 - 5,
						];
			const yGap = o.yGap ?? g.card.y - 14;
			const pts: Point[] = [g.blk, ...LANE.map((p) => px(p[0], p[1], 0))];
			pts.push([g.junction[0], yGap], [rest[0], yGap], rest);
			g.path = pts;
			g.pathLen = polyLen(pts);
			g.junctionAt = polyLen(pts.slice(0, LANE.length + 1)) / g.pathLen;
			g.rest = rest;
			if (o.rest !== "line")
				g.tail = [
					[rest[0], rest[1] + g.tagH / 2],
					[rest[0], g.rowY(1)],
				];
		} else if (g.card && view.mi === 2)
			g.rest = [
				g.card.x + g.card.w - g.tagW / 2 - 2,
				g.card.y - g.tagH / 2 - 6,
			];
		if (g.card && !isStrip(g))
			g.keyTag = [g.colX(ind + 1) - tagPad + g.tagW / 2, g.rowY(2)];
		// The chip's path: off the key, right along its row, up the Rojo rail, onto the ServerScriptService room.
		if (g.card && g.px && o.rail) {
			const strip = isStrip(g);
			const ky = strip ? g.rowY(0) : g.rowY(2);
			const kx = g.colX(strip ? 1 : ind + 1) + (16 * g.cw) / 2;
			const b = BLD.s;
			const rm = b.room;
			const roomTop = g.px(
				rm.x + rm.w * 0.35,
				rm.y + rm.d / 2,
				b.h + rm.h + 0.2
			);
			const right = Math.max(
				g.card.x + g.card.w,
				g.px(b.x + b.w, b.y, 0)[0]
			);
			const railX = Math.min(right + 16, o.maxX ?? Infinity);
			const roofY = roomTop[1] - 34;
			g.rail = [
				[g.card.x + g.card.w, ky],
				[railX, ky],
				[railX, roofY],
				[roomTop[0], roofY],
			];
			g.chipPath = [[kx, ky - 4], ...g.rail];
			g.chipLen = polyLen(g.chipPath);
			g.roomTop = [roomTop[0], roomTop[1] - g.chipH / 2 - 2];
			const rp = railPaths(g.rail);
			view.rail.forEach((p, i) => p.setAttribute("d", rp[i]));
			put(view.lbl.rojo, railX - 8, (ky + roofY) / 2 + 30, 1, 0.5);
		}
		view.ov.setAttribute("width", String(o.w));
		view.ov.setAttribute("height", String(o.h));
		if (g.path) {
			view.trail.setAttribute(
				"d",
				dpath(g.tail ? [...g.path, ...g.tail.slice(1)] : g.path)
			);
			g.trailLen = view.trail.getTotalLength();
			view.trail.style.strokeDasharray = `${g.trailLen} ${g.trailLen + 10}`;
		}
		if (g.server) {
			view.road.setAttribute("d", dpath(g.server));
			g.roadLen = view.road.getTotalLength();
			view.road.style.strokeDasharray = `${g.roadLen} ${g.roadLen + 10}`;
		}
		view.g = g;
	}

	function renderView(view: View, P: number) {
		const g = view.g;
		if (!g) return;
		const t0 = loc(P, 0);
		const t1 = loc(P, 1);
		const t2 = loc(P, 2);
		const t3 = loc(P, 3);
		const L = view.lbl;
		// 1: the highlight walks the plot and stops on the file; @Server and Inventory light.
		const name = eo(seg(t0, T.name));
		if (g.px && L.blk) {
			const px = g.px;
			const w = easeIO(seg(t0, T.walk));
			const x = lerp(CELLS[0][2], FILE[2], w);
			const y = FILE[3];
			const tint =
				P < 1 ? 1 : P < 3 ? 0 : view.mini ? 0 : eo(seg(t3, T.preLight));
			const corners: Point[] = [
				[x - 0.46, y - 0.46],
				[x + 0.46, y - 0.46],
				[x + 0.46, y + 0.46],
				[x - 0.46, y + 0.46],
			];
			view.cur.setAttribute(
				"points",
				pointList(corners.map((p) => px(p[0], p[1], 0.161)))
			);
			view.cur.style.fillOpacity = (0.25 + 0.75 * tint).toFixed(2);
			view.cur.style.display = "";
			setA(L.blk.querySelector(".file"), name);
			const pf = L.plot.querySelector(".feat")!;
			setA(pf, name);
			pf.classList.toggle("b", name > 0.5);
		} else view.cur.style.display = "none";
		let feats = "";
		if (g.plotSil && L.blk)
			feats += `<polygon points="${pointList(g.plotSil)}" opacity="${name.toFixed(2)}"/>`;
		// 2: the tag lifts off the label and travels; the trail draws behind it.
		const tagIn = eo(seg(t1, T.tagIn));
		const u = easeIO(seg(t1, T.travel));
		const line = eo(seg(t1, T.serverLine));
		if (g.path) {
			view.trail.style.strokeDashoffset = f1(
				g.trailLen -
					(g.pathLen * u +
						(g.tail ? (g.trailLen - g.pathLen) * line : 0))
			);
			view.trail.style.display = P > 1 ? "" : "none";
		} else view.trail.style.display = "none";
		if (g.server) {
			const r = clamp01((u - g.junctionAt + 0.02) / 0.1);
			view.road.style.strokeDashoffset = f1(g.roadLen * (1 - eo(r)));
			view.road.style.display = P > 1 ? "" : "none";
		}
		if (L.srv)
			L.srv.style.color =
				g.server && u > g.junctionAt ? "var(--t-s)" : "";
		// 3: the project tab opens, a gap opens, the tag drops in and strips to the key.
		const tab = eo(seg(t2, T.tab));
		const gap = easeIO(seg(t2, T.gap));
		const drop = easeIO(seg(t2, T.drop));
		const slide = easeIO(seg(t2, T.slide));
		const stripT = eo(seg(t2, T.strip));
		if (view.card) {
			const rog = view.card.querySelector<HTMLElement>(".rog")!;
			const proj = view.card.querySelector<HTMLElement>(".proj")!;
			const bc = view.card.querySelector<HTMLElement>(".bc")!;
			setA(rog.querySelector(".lit"), isStrip(g) ? 0 : line);
			if (!isStrip(g)) {
				rog.style.opacity = (1 - tab).toFixed(2);
				proj.style.opacity = tab.toFixed(2);
				bc.style.opacity = tab.toFixed(2);
				setA(bc.querySelector(".file"), stripT);
				proj.querySelectorAll<HTMLElement>(".row").forEach((r) => {
					if (r.classList.contains("mv"))
						r.style.transform = `translateY(${f1((+r.dataset.at! - +r.dataset.first!) * g.met.lh * gap)}px)`;
					if (r.classList.contains("nw"))
						r.style.opacity = r.querySelector(".key")
							? "1"
							: stripT.toFixed(2);
				});
				const feat = proj.querySelector(".feat");
				if (feat) {
					setA(feat, stripT);
					feat.classList.toggle("b", stripT > 0.5);
				}
				proj.querySelectorAll<HTMLElement>(".q").forEach(
					(e) => (e.style.opacity = stripT.toFixed(2))
				);
				const key = proj.querySelector<HTMLElement>(".key");
				if (key) key.style.opacity = P >= 2.7 ? "1" : "0";
				setA(
					proj.querySelector(".pv"),
					view.mini ? 0 : eo(seg(t3, T.preLight))
				);
				if (view.tabbar) {
					const tp =
						view.tabbar.querySelector<HTMLElement>(
							"[data-t=proj]"
						)!;
					tp.style.opacity = tab.toFixed(2);
					tp.style.transform = `translateX(${f1(-10 * (1 - tab))}px)`;
					view.tabbar
						.querySelector("[data-t=rog]")!
						.classList.toggle("on", tab < 0.5);
					tp.classList.toggle("on", tab >= 0.5);
				}
			} else
				rog.querySelectorAll<HTMLElement>(".q").forEach(
					(e) => (e.style.opacity = "1")
				);
		}
		// The tag's position and look.
		let tagShow = false;
		let tx = 0;
		let ty = 0;
		if (P >= 1 && P < 2.7 && (g.path || g.rest) && !isStrip(g)) {
			if (P < 2) {
				if (g.path) {
					const pt = along(g.path, g.pathLen * u);
					tx = pt[0];
					ty = pt[1] - 4 * tagIn;
					tagShow = tagIn > 0;
				}
			} else if (g.keyTag && g.rest) {
				tx = lerp(g.rest[0], g.keyTag[0], slide);
				ty = lerp(g.rest[1], g.keyTag[1], drop);
				tagShow = true;
			}
		}
		view.tag.style.display = tagShow ? "" : "none";
		if (tagShow) {
			put(view.tag, tx, ty);
			view.tag.style.opacity = P < 2 ? tagIn.toFixed(2) : "1";
			view.tag.style.setProperty("--b", (1 - stripT).toFixed(3));
			const ts = view.tag.querySelector<HTMLElement>(".ts")!;
			ts.style.opacity = (1 - stripT).toFixed(2);
			ts.style.transform = `translateY(${f1(6 * stripT)}px)`;
		}
		// 4: the chip lifts off the key and rides the Rojo rail; the three rooms rise; the chip lands.
		const lift = eo(seg(t3, T.lift));
		const ride = easeIO(seg(t3, T.ride));
		const rooms = eo(seg(t3, T.rooms));
		const land = easeIO(seg(t3, T.land));
		const railIn = g.rail ? eo(seg(t3, [0, 0.2])).toFixed(2) : "0";
		view.rail.forEach((p) => (p.style.opacity = railIn));
		if (L.rojo) L.rojo.style.opacity = railIn;
		const chipShow = !!g.chipPath && P >= 3 + T.lift[0] && land < 1;
		view.chip.style.display = chipShow ? "" : "none";
		if (chipShow && g.chipPath && g.roomTop) {
			let [x, y] = along(g.chipPath, g.chipLen * ride);
			if (ride <= 0) y = g.chipPath[0][1] + 4 * (1 - lift);
			if (land > 0) {
				x = lerp(x, g.roomTop[0], land);
				y = lerp(y, g.roomTop[1], land);
			}
			put(view.chip, x, y);
			view.chip.style.opacity = Math.min(lift, 1 - land).toFixed(2);
		}
		if (view.rooms && view.landed) {
			let r = "";
			let m = "";
			SERVICES.forEach((k) => {
				const b = BLD[k];
				const rm = b.room;
				const h = rm.h * rooms;
				view.caps[k]?.setAttribute("opacity", (1 - rooms).toFixed(2));
				if (rooms > 0) {
					r += SK.box(rm.x, rm.y, b.h, rm.w, rm.d, h, "room");
					if (g.px) {
						const px = g.px;
						feats += `<polygon points="${pointList(silhouette(rm.x, rm.y, b.h, rm.w, rm.d, h).map((p) => px(...p)))}" opacity="${rooms.toFixed(2)}"/>`;
					}
				}
				if (L["m" + k]) L["m" + k].style.opacity = rooms.toFixed(2);
			});
			if (rooms > 0) {
				const b = BLD.s;
				const rm = b.room;
				const z = b.h + rm.h * rooms;
				const C = kit(0, 0, 40);
				const at = (x: number) =>
					SK.P(x, rm.y + rm.d / 2, z)
						.map(f1)
						.join(",");
				m += `<g transform="translate(${at(rm.x + rm.w * 0.7)})" opacity="${(0.35 * rooms).toFixed(2)}">${C.box(-0.3, -0.3, 0, 0.6, 0.6, 0.4, "cs")}</g>`;
				if (land > 0.5)
					m += `<g transform="translate(${at(rm.x + rm.w * 0.35)})" opacity="${((land - 0.5) * 2).toFixed(2)}">${C.box(-0.3, -0.3, 0, 0.6, 0.6, 0.4, "cs")}</g>`;
			}
			const key =
				r.length +
				":" +
				m.length +
				":" +
				rooms.toFixed(3) +
				land.toFixed(3);
			if (view.rooms.dataset.h !== key) {
				view.rooms.innerHTML = r;
				view.landed.innerHTML = m;
				view.rooms.dataset.h = key;
			}
		}
		view.feats.innerHTML = feats;
		view.feats.setAttribute("class", "feats feat");
	}

	function fillCaption(view: View, variant: string) {
		const c = view.cap!;
		c.className = "cap " + variant;
		const items = STEPS.map(
			(s, i) =>
				`<div class="ci" data-i="${i}"><span class="k">${s.kicker}</span><span class="ln"><span>${s.line}</span></span></div>`
		).join("");
		const bar = variant.includes("bar")
			? `<div class="hbar">${STEPS.map((_, i) => `<span>${String(i + 1).padStart(2, "0")}</span>`).join("")}</div>`
			: "";
		const body = variant.includes("short")
			? STEPS.map(
					(s, i) =>
						`<div class="ci" data-i="${i}"><span class="k">${s.kicker}</span><div class="rule"><i></i></div><span class="ln"><span>${s.line}</span></span></div>`
				).join("")
			: items;
		c.innerHTML = `${bar}<div class="cis">${body}</div>`;
		c.querySelectorAll(".feat").forEach((f) => f.classList.add("b"));
	}

	function captionAt(view: View, P: number) {
		const n = Math.min(3, Math.floor(P));
		const c = view.cap!;
		c.querySelectorAll(".ci").forEach((e, i) => {
			e.classList.toggle("on", i === n);
			e.classList.toggle("done", i <= n);
		});
		c.querySelectorAll<HTMLElement>(".hbar span").forEach((e, i) => {
			e.style.setProperty("--f", clamp01(P - i).toFixed(3));
			e.classList.toggle("on", i === n);
		});
		c.querySelectorAll<HTMLElement>(".rule i").forEach((e) =>
			e.style.setProperty("--f", (P / 4).toFixed(3))
		);
	}

	const mainView = makeView(stageView, "main");
	let minis: View[] | null = null;
	let mode = "";
	let stepPx = 600;
	const pagePad = () => Math.max(20, Math.min(64, innerWidth * 0.045));

	function planMain(staticMode: boolean) {
		const vh = innerHeight;
		const cbW = root.clientWidth;
		const tall = staticMode || vh >= 760;
		const met = tall ? MET.normal : MET.compact;
		const pad = tall ? 24 : 12;
		const gap = tall ? 24 : 12;
		const cardW = Math.ceil(met.padX * 2 + 62 * charW(met.fs) + 4);
		const side = cbW >= 300 + 24 + cardW;
		const capVariant = staticMode
			? "list"
			: side
				? "side"
				: tall
					? "top bar"
					: "top short";
		fillCaption(mainView, capVariant);
		mainView.cap!.style.width = (side ? 300 : cbW) + "px";
		const capH = mainView.cap!.offsetHeight;
		const cardH = met.tabH + met.bcH + 2 * met.padY + 9 * met.lh;
		const band = side ? Math.max(cardH, capH) : capH + 8 + cardH;
		const avail = staticMode ? 1e4 : vh - 2 * pad - gap - band;
		let pick: { vb: ViewBox; s: number } | null = null;
		for (const [name, floor] of [
			["full", 0.8],
			["crop", 0.7],
			["cropTop", 0.7],
		] as const) {
			const vb = VB[name];
			const s = Math.min(1, avail / vb[3], cbW / vb[2]);
			if (s >= floor) {
				pick = { vb, s };
				break;
			}
		}
		if (!pick) return null;
		const sw = pick.vb[2] * pick.s;
		const sh = pick.vb[3] * pick.s;
		const top = staticMode
			? pad
			: Math.max(pad, (vh - sh - gap - band) / 2);
		const scene = { x: (cbW - sw) / 2, y: top };
		const sssRight =
			scene.x +
			(SK.P(BLD.s.x + BLD.s.w, BLD.s.y, 0)[0] - pick.vb[0]) * pick.s;
		let cardX = Math.min(cbW, sssRight) - cardW;
		cardX = side ? Math.max(cardX, 324) : Math.max(cardX, 0);
		const bandTop = top + sh + gap;
		const cardY = side ? bandTop : bandTop + capH + 8;
		return {
			met,
			gap,
			cbW,
			scene,
			vb: pick.vb,
			s: pick.s,
			card: { x: cardX, y: cardY, w: cardW, variant: "main" as const },
			bandTop,
			h: staticMode ? bandTop + band + pad : vh,
		};
	}

	function applyMain(plan: NonNullable<ReturnType<typeof planMain>>) {
		layoutView(mainView, {
			met: plan.met,
			vb: plan.vb,
			s: plan.s,
			scene: plan.scene,
			card: plan.card,
			rest: "line",
			rail: true,
			yGap: plan.bandTop - plan.gap / 2,
			w: plan.cbW,
			h: plan.h,
			maxX: plan.cbW + pagePad() - 8,
		});
		mainView.cap!.style.transform = `translate(0px,${plan.bandTop}px)`;
		stageView.style.height = plan.h + "px";
	}

	function buildMinis() {
		minisEl.innerHTML =
			`<li class="sr">${STAGE_LABEL}</li>` +
			STEPS.map(
				(s, i) =>
					`<li><span class="k">${s.kicker}</span><span class="ln">${s.line}</span><div class="view" data-m="${i}"></div></li>`
			).join("");
		minisEl.querySelectorAll(".feat").forEach((f) => f.classList.add("b"));
		return [...minisEl.querySelectorAll<HTMLElement>("[data-m]")].map(
			(el) => makeView(el, "m" + el.dataset.m)
		);
	}

	function layoutMinis(views: View[]) {
		const w = Math.min(350, root.clientWidth);
		const met = MET.mini;
		const cw = charW(met.fs);
		views.forEach((view) => {
			let h = 0;
			const o: LayoutOptions = { met, rest: "above", w, h: 0 };
			if (view.mi === 0 || view.mi === 1 || view.mi === 3) {
				const vb = VB["m" + view.mi];
				const s = w / vb[2];
				Object.assign(o, {
					vb,
					s,
					scene: { x: 0, y: view.mi === 3 ? 6 : 30 },
				});
				h = o.scene!.y + vb[3] * s;
			}
			if (view.mi === 1) {
				o.card = { x: 0, y: h + 40, w, variant: "m1" };
				o.yGap = h + 6;
				o.juncAbove = true;
			}
			if (view.mi === 2) o.card = { x: 0, y: 40, w, variant: "m2" };
			if (view.mi === 3) {
				o.card = {
					x: 0,
					y: h + 40,
					w: Math.ceil(12 * 2 + 21 * cw),
					variant: "strip",
				};
				o.rail = true;
				o.maxX = w - 4;
			}
			const cardH = o.card
				? o.card.variant === "strip"
					? met.lh + 2 * met.padY
					: met.tabH +
						met.padY * 2 +
						(o.card.variant === "m2"
							? met.bcH + 10 * met.lh
							: 6 * met.lh)
				: 0;
			o.h = o.card ? o.card.y + cardH : h;
			(view.gfx.parentNode as HTMLElement).style.height = o.h + "px";
			layoutView(view, o);
		});
	}

	function setMode() {
		const small = innerWidth < 600 || innerHeight < 600;
		let m = reduced ? "static" : small ? "mini" : "pinned";
		let plan: ReturnType<typeof planMain> = null;
		if (m !== "mini") {
			plan = planMain(m === "static");
			if (!plan) m = reduced ? "static-mini" : "mini";
		}
		if (reduced && m === "static" && small) m = "static-mini";
		root.dataset.mode = m.endsWith("mini") ? "mini" : m;
		mode = m;
		if (m.endsWith("mini")) {
			minis ??= buildMinis();
			layoutMinis(minis);
			root.style.height = "";
		} else if (plan) {
			applyMain(plan);
			stepPx = Math.max(480, Math.min(900, innerHeight * 0.75));
			root.style.height =
				m === "pinned" ? 4 * stepPx + innerHeight + "px" : "";
		}
	}

	function onScroll() {
		if (!mode) return;
		if (mode === "static") {
			renderView(mainView, 4);
			captionAt(mainView, 4);
			return;
		}
		if (mode === "static-mini") {
			minis?.forEach((view) => renderView(view, view.mi + 1));
			return;
		}
		if (mode === "mini") {
			const vh = innerHeight;
			minis?.forEach((view) => {
				const r = (
					view.gfx.parentNode as HTMLElement
				).getBoundingClientRect();
				const h = Math.min(r.height, 0.7 * vh);
				if (r.bottom < -100 || r.top > vh + 100) return;
				renderView(
					view,
					view.mi +
						clamp01((vh - h - r.top) / Math.max(0.85 * vh - h, 200))
				);
			});
			return;
		}
		const P = Math.max(
			0,
			Math.min(4, -root.getBoundingClientRect().top / stepPx)
		);
		renderView(mainView, P);
		captionAt(mainView, P);
	}

	let ticking = false;
	let frame = 0;
	const scroll = () => {
		if (ticking) return;
		ticking = true;
		frame = requestAnimationFrame(() => {
			ticking = false;
			onScroll();
		});
	};
	let resizeTimer: ReturnType<typeof setTimeout> | undefined;
	const resize = () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => {
			setMode();
			onScroll();
		}, 60);
	};
	let alive = true;
	addEventListener("scroll", scroll, { passive: true });
	addEventListener("resize", resize);
	setMode();
	onScroll();
	// Text metrics change once the web fonts load.
	document.fonts?.ready.then(() => {
		if (!alive) return;
		setMode();
		onScroll();
	});

	return () => {
		alive = false;
		removeEventListener("scroll", scroll);
		removeEventListener("resize", resize);
		cancelAnimationFrame(frame);
		clearTimeout(resizeTimer);
		probe.remove();
		stageView.innerHTML = "";
		stageView.style.height = "";
		minisEl.innerHTML = "";
		root.style.height = "";
		delete root.dataset.mode;
	};
}
