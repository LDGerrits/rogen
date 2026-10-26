export type Point = [number, number];
type Point3 = [number, number, number];
type ViewBox = [number, number, number, number];

const CO = Math.cos(Math.PI / 6);
const SI = 0.5;

const v = (name: string) => `var(--${name})`;
const darken = (name: string, f: number) =>
	`color-mix(in srgb,var(--${name}) ${Math.round(f * 100)}%,#000)`;
const fill = (colour: string) => `style="fill:${colour}"`;

// A material names its top colour; the sides use --<m>-l and --<m>-r when the theme sets them.
const sides = (m: string) => [
	v(m),
	`var(--${m}-l,${darken(m, 0.8)})`,
	`var(--${m}-r,${darken(m, 0.6)})`,
];

const n1 = (n: number) => n.toFixed(1);

/** Isometric drawing helpers in world units, emitting SVG markup. */
function kit(ox: number, oy: number, s: number) {
	const box: ViewBox = [Infinity, Infinity, -Infinity, -Infinity];
	const grow = ([x, y]: Point) => {
		box[0] = Math.min(box[0], x);
		box[1] = Math.min(box[1], y);
		box[2] = Math.max(box[2], x);
		box[3] = Math.max(box[3], y);
	};
	const P = (x: number, y: number, z = 0): Point => [
		ox + (x - y) * CO * s,
		oy + (x + y) * SI * s - z * s,
	];
	const pts = (a: Point[]) =>
		a
			.map((p) => {
				grow(p);
				return n1(p[0]) + "," + n1(p[1]);
			})
			.join(" ");
	const quad = (
		x: number,
		y: number,
		z: number,
		w: number,
		d: number,
		attr: string
	) =>
		`<polygon points="${pts([P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)])}" ${attr}/>`;
	const face = (
		x0: number,
		x1: number,
		y: number,
		z0: number,
		z1: number,
		attr: string
	) =>
		`<polygon points="${pts([P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)])}" ${attr}/>`;
	const sface = (
		x: number,
		y0: number,
		y1: number,
		z0: number,
		z1: number,
		attr: string
	) =>
		`<polygon points="${pts([P(x, y0, z0), P(x, y1, z0), P(x, y1, z1), P(x, y0, z1)])}" ${attr}/>`;
	const cube = (
		x: number,
		y: number,
		z: number,
		w: number,
		d: number,
		h: number,
		m: string
	) => {
		const [t, l, r] = sides(m);
		const top = [
			P(x, y, z + h),
			P(x + w, y, z + h),
			P(x + w, y + d, z + h),
			P(x, y + d, z + h),
		];
		const front = [
			P(x, y + d, z),
			P(x + w, y + d, z),
			P(x + w, y + d, z + h),
			P(x, y + d, z + h),
		];
		const side = [
			P(x + w, y, z),
			P(x + w, y + d, z),
			P(x + w, y + d, z + h),
			P(x + w, y, z + h),
		];
		return `<g><polygon points="${pts(front)}" ${fill(l)}/><polygon points="${pts(side)}" ${fill(r)}/><polygon points="${pts(top)}" ${fill(t)}/></g>`;
	};
	const line = (a: Point3, b: Point3, attr: string) => {
		const p = P(...a);
		const q = P(...b);
		return `<line x1="${n1(p[0])}" y1="${n1(p[1])}" x2="${n1(q[0])}" y2="${n1(q[1])}" ${attr}/>`;
	};
	// Text lying on a horizontal surface, reading along +x.
	const flat = (
		x: number,
		y: number,
		z: number,
		text: string,
		size: number,
		colour: string
	) => {
		const [ex, ey] = P(x, y, z);
		grow([ex, ey]);
		const m = [CO, SI, -CO, SI].map((n) => +n.toFixed(4)).join(",");
		return `<text transform="matrix(${m},${n1(ex)},${n1(ey)})" font-size="${size}" style="fill:${colour};font-family:var(--mono)">${text}</text>`;
	};
	const studs = (x0: number, y0: number, w: number, d: number, z: number) => {
		let o = "";
		for (let i = 0; i < w - 0.5; i++)
			for (let j = 0; j < d - 0.5; j++) {
				const [cx, cy] = P(x0 + i + 0.5, y0 + j + 0.5, z);
				o += `<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(s * 0.14)}" ry="${n1(s * 0.08)}"/>`;
			}
		return `<g ${fill(v("stud"))}>${o}</g>`;
	};
	const road = (path: Point[]) => {
		let o = "";
		const w = 0.6;
		for (let i = 0; i < path.length - 1; i++) {
			const [ax, ay] = path[i];
			const [bx, by] = path[i + 1];
			o += quad(
				Math.min(ax, bx) - w / 2,
				Math.min(ay, by) - w / 2,
				0,
				Math.abs(bx - ax) + w,
				Math.abs(by - ay) + w,
				fill(v("road"))
			);
		}
		return o;
	};
	const centre = (path: Point[]) => {
		let o = "";
		for (let i = 0; i < path.length - 1; i++)
			o += line(
				[...path[i], 0],
				[...path[i + 1], 0],
				`style="stroke:${v("road-line")}" stroke-width="1" stroke-dasharray="5 7"`
			);
		return o;
	};
	/** The bounding box of everything drawn so far, padded and rounded. */
	const viewBox = (pad: number): ViewBox =>
		[
			box[0] - pad,
			box[1] - pad,
			box[2] - box[0] + pad * 2,
			box[3] - box[1] + pad * 2,
		].map((n) => Math.round(n)) as ViewBox;
	return {
		s,
		P,
		pts,
		quad,
		face,
		sface,
		box: cube,
		line,
		flat,
		studs,
		road,
		centre,
		viewBox,
	};
}

type Kit = ReturnType<typeof kit>;
export type Service = "s" | "c" | "r";

export interface Building {
	x: number;
	y: number;
	w: number;
	d: number;
	h: number;
	door: number;
	name: string;
	cap?: number;
}

/** A service building: ServerScriptService striped, ReplicatedStorage capped, StarterPlayer windowed. */
function building(
	K: Kit,
	k: Service,
	b: Building,
	options: { cap?: number; stripe?: number; label?: number } = {}
) {
	const { x, y, w, d, h, door } = b;
	const fy = y + d;
	const body = "b" + k;
	const top = "c" + k;
	let o = K.box(x, y, 0, w, d, h, body);
	let roof = "";
	let cap: number;
	if (k === "s") {
		cap = options.cap ?? 0.18;
		for (let i = 0; i < 4; i++) {
			const z = 0.3 + i * (options.stripe ?? 0.3);
			o += K.line(
				[x + w, y + 0.3, z],
				[x + w, y + d - 0.3, z],
				`style="stroke:${darken(body, 0.42)}" stroke-width="1.5"`
			);
		}
		roof = K.box(x + 0.15, y + 0.15, h, w - 0.3, d - 0.3, cap, top);
	} else if (k === "r") {
		cap = options.cap ?? 0.26;
		roof =
			K.box(x + 0.2, y + 0.2, h, w - 0.4, d - 0.4, cap, top) +
			K.box(
				x + w * 0.36,
				y + d * 0.26,
				h + cap,
				w * 0.3,
				d * 0.34,
				0.14,
				"rcap"
			);
	} else {
		cap = options.cap ?? 0.22;
		for (let r = 0; r < 3; r++)
			for (let c = 0; c < 2; c++) {
				const z = 0.55 + r * 0.6;
				const yy = y + 0.35 + c * 0.9;
				o += K.sface(
					x + w,
					yy,
					yy + 0.5,
					z,
					z + 0.32,
					fill(darken(body, 0.38))
				);
			}
		roof = K.box(x + 0.2, y + 0.2, h, w - 0.4, d - 0.4, cap, top);
	}
	if (options.label)
		roof += K.flat(
			x + 0.3,
			fy - 0.32,
			h + cap,
			b.name,
			options.label,
			v("k" + k)
		);
	o += K.face(door - 0.35, door + 0.35, fy, 0, 0.62, fill(darken(body, 0.3)));
	return { body: o, roof };
}

export const cube = (k: Service, s: number, size = 0.62, h = 0.46, z = 0.16) =>
	kit(0, 0, s).box(-size / 2, -size / 2, z, size, size, h, "c" + k);

const part = (n: number, markup: string, style = "") =>
	`<g data-part="${n}"${style ? ` style="${style}"` : ""}>${markup}</g>`;

interface Plot {
	name: string;
	x: number;
	files: [number, number, Service, number][];
}

export const heroPlots: Plot[] = [
	{
		name: "Combat/",
		x: 0.9,
		files: [
			[0, 0, "s", 0.55],
			[1, 0, "r", 0.7],
			[2, 0, "c", 0.5],
			[0, 1, "r", 0.6],
			[1, 1, "s", 0.45],
		],
	},
	{
		name: "Inventory/",
		x: 5.9,
		files: [
			[0, 0, "c", 0.6],
			[1, 0, "s", 0.8],
			[2, 0, "s", 0.5],
			[0, 1, "c", 0.5],
			[1, 1, "r", 0.65],
			[2, 1, "r", 0.55],
		],
	},
	{
		name: "Shop/",
		x: 10.9,
		files: [
			[0, 0, "r", 0.55],
			[1, 0, "s", 0.7],
			[2, 0, "r", 0.6],
			[0, 1, "c", 0.5],
			[2, 1, "r", 0.45],
		],
	},
];

export const heroBuildings: Record<Service, Building> = {
	s: {
		x: 0.6,
		y: 1.0,
		w: 4.4,
		d: 2.4,
		h: 1.75,
		door: 2.2,
		name: "ServerScriptService",
	},
	r: {
		x: 5.7,
		y: 1.2,
		w: 4.1,
		d: 2.2,
		h: 1.1,
		door: 7.8,
		name: "ReplicatedStorage",
	},
	c: {
		x: 10.8,
		y: 1.3,
		w: 3.4,
		d: 2.1,
		h: 2.5,
		door: 12.6,
		name: "StarterPlayer",
	},
};

export const HERO_PLOT_Y = 8.5;
export const HERO_STREET = 5.6;
export const heroKit = () => kit(470, 230, 38);

/** The hero baseplate: three feature plots, roads and the three service buildings. */
export function heroWorld() {
	const H = heroKit();
	const PY = HERO_PLOT_Y;
	const ST = HERO_STREET;
	let s =
		H.box(0, 0, -0.45, 15.4, 12.4, 0.45, "plate") +
		H.studs(0, 0, 15.4, 12.4, 0);
	const roads: Point[][] = [
		[
			[0.4, ST],
			[15, ST],
		],
	];
	heroPlots.forEach((p) =>
		roads.push([
			[p.x + 2, PY],
			[p.x + 2, ST],
		])
	);
	Object.values(heroBuildings).forEach((b) =>
		roads.push([
			[b.door, ST],
			[b.door, b.y + b.d],
		])
	);
	roads.forEach((r) => (s += H.road(r)));
	roads.forEach((r) => (s += H.centre(r)));
	let out = part(0, s, "--dy:10px");
	(["s", "r", "c"] as Service[]).forEach((k, i) => {
		const b = building(H, k, heroBuildings[k], { label: 12.5 });
		out += part(
			1 + i,
			`<g data-bld="${k}">${b.body}${b.roof}<polygon data-glow="${k}" points="${glowPoints(H, heroBuildings[k])}" ${fill(v("c" + k))} opacity="0"/></g>`,
			`--dy:18px;animation-delay:${80 + i * 90}ms`
		);
	});
	out += '<g data-parcels=""></g>';
	heroPlots.forEach((p, i) => {
		let g = H.box(p.x, PY + 0.4, 0, 4, 2.8, 0.16, "plot");
		p.files.forEach(
			([a, b, k, h]) =>
				(g += H.box(
					p.x + 0.5 + a * 1.05,
					PY + 0.85 + b * 1.0,
					0.16,
					0.6,
					0.6,
					h * 0.7,
					"c" + k
				))
		);
		g += H.flat(p.x + 0.05, PY + 4.0, 0, p.name, 15, v("lbl"));
		out += part(4 + i, g, `--dy:-14px;animation-delay:${200 + i * 90}ms`);
	});
	return { markup: out, viewBox: H.viewBox(8) };
}

function glowPoints(K: Kit, b: Building) {
	const fy = b.y + b.d;
	return K.pts([
		K.P(b.door - 0.35, fy, 0),
		K.P(b.door + 0.35, fy, 0),
		K.P(b.door + 0.35, fy, 0.62),
		K.P(b.door - 0.35, fy, 0.62),
	]);
}

/** The Inventory plot, each file coloured by the service it goes to. */
export function inventoryPlot() {
	const K = kit(150, 30, 34);
	let base =
		K.box(0, 0, -0.3, 5.2, 4.2, 0.3, "plate") + K.studs(0, 0, 5.2, 4.2, 0);
	base += K.box(0.4, 0.4, 0, 4.4, 3.0, 0.16, "plot");
	const cells: [number, number, Service, number, boolean?][] = [
		[0, 0, "r", 0.9, true],
		[1, 0, "c", 0.7],
		[2, 0, "s", 0.85],
		[0, 1, "r", 0.55],
		[1, 1, "r", 0.6],
		[2, 1, "r", 0.45],
	];
	let out = part(0, base);
	[0, 1].forEach((row) => {
		let g = "";
		cells
			.filter((c) => c[1] === row)
			.forEach(([i, j, k, h, stack]) => {
				const x = 0.85 + i * 1.35;
				const y = 0.8 + j * 1.25;
				g += stack
					? K.box(x, y, 0.16, 0.7, 0.7, 0.34, "c" + k) +
						K.box(x, y, 0.54, 0.7, 0.7, 0.34, "c" + k)
					: K.box(x, y, 0.16, 0.7, 0.7, h * 0.6, "c" + k);
			});
		out += part(row + 1, g);
	});
	out += part(3, K.flat(0.45, 4.05, 0, "Inventory/", 15, v("ink")));
	return { markup: out, viewBox: K.viewBox(6) };
}

/** Three feature plots, each with its own agent, separated by low walls. */
export function agentsScene() {
	const A = kit(300, 70, 34);
	let out = part(
		0,
		A.box(0, 0, -0.45, 15, 7.2, 0.45, "plate") + A.studs(0, 0, 15, 7.2, 0)
	);
	const xs = [0.5, 5.4, 10.3];
	const names = ["Combat/", "Inventory/", "Shop/"];
	const sets: Service[][] = [
		["s", "r", "c", "r", "s", "r"],
		["c", "s", "s", "c", "r", "r"],
		["r", "s", "r", "c", "r", "r"],
	];
	const spots = [
		[0, 0, 0.6],
		[1, 0, 0.45],
		[2, 0, 0.7],
		[0, 1, 0.5],
		[2, 1, 0.55],
		[0, 2, 0.45],
	];
	xs.forEach((x, i) => {
		let g = A.box(x, 0.6, 0, 4.2, 5.0, 0.16, "plot");
		spots.forEach(
			([a, b, h], n) =>
				(g += A.box(
					x + 0.5 + a * 1.2,
					1.0 + b * 1.15,
					0.16,
					0.62,
					0.62,
					h * 0.7,
					"c" + sets[i][n]
				))
		);
		const cx = x + 1.85;
		const cy = 3.6;
		const L = 0.95;
		const T = 0.34;
		const chevron = [
			A.P(cx, cy, 0.17),
			A.P(cx + L, cy, 0.17),
			A.P(cx + L, cy + L, 0.17),
			A.P(cx + L - T, cy + L, 0.17),
			A.P(cx + L - T, cy + T, 0.17),
			A.P(cx, cy + T, 0.17),
		];
		g += `<polygon points="${A.pts(chevron)}" ${fill(v("ink"))}/>`;
		g += A.flat(x + 0.05, 6.4, 0, names[i], 14, v("lbl"));
		out += part(1 + i, g);
	});
	out += part(
		4,
		[4.9, 9.8]
			.map((x) => A.box(x, 0.4, 0, 0.12, 5.4, 0.38, "wall"))
			.join("")
	);
	return { markup: out, viewBox: A.viewBox(8) };
}
