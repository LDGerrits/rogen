"use client";

import { useEffect, useRef } from "react";
import {
	cube,
	HERO_PLOT_Y,
	HERO_STREET,
	heroBuildings,
	heroKit,
	heroPlots,
	heroWorld,
	type Point,
	type Service,
} from "./iso";

const world = heroWorld();
const H = heroKit();
const START_DELAY = 650;
const EASE_OUT = "cubic-bezier(.16,1,.3,1)";

interface Parcel {
	g: SVGGElement;
	k: Service;
	path: Point[];
	segs: number[];
	length: number;
	t0: number;
	hit: boolean;
	depth: number;
}

function at(p: Parcel, d: number): Point {
	let i = 0;
	while (i < p.segs.length - 1 && d > p.segs[i]) {
		d -= p.segs[i];
		i++;
	}
	const a = p.path[i];
	const b = p.path[i + 1];
	const f = p.segs[i] ? Math.min(1, d / p.segs[i]) : 1;
	return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** The hero baseplate, with file cubes travelling from the feature plots to their service buildings. */
export function HeroWorld() {
	const ref = useRef<SVGSVGElement>(null);

	useEffect(() => {
		const svg = ref.current;
		if (!svg) return;
		const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const parcels = svg.querySelector<SVGGElement>("[data-parcels]")!;
		const glows: Partial<Record<Service, SVGElement>> = {};
		const bodies: Partial<Record<Service, SVGElement>> = {};
		svg.querySelectorAll<SVGElement>("[data-glow]").forEach(
			(g) => (glows[g.dataset.glow as Service] = g)
		);
		svg.querySelectorAll<SVGElement>("[data-bld]").forEach(
			(g) => (bodies[g.dataset.bld as Service] = g)
		);
		const tiles = {
			s: cube("s", 38, 0.5, 0.34, 0.02),
			c: cube("c", 38, 0.5, 0.34, 0.02),
			r: cube("r", 38, 0.5, 0.34, 0.02),
		};
		const lastHit: Partial<Record<Service, number>> = {};
		const live: Parcel[] = [];
		let seed = 11;
		const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

		const receive = (k: Service) => {
			if (reduced) return;
			const now = performance.now();
			glows[k]?.animate(
				[
					{ opacity: 0 },
					{ opacity: 0.85, offset: 0.2 },
					{ opacity: 0 },
				],
				{
					duration: 900,
					easing: EASE_OUT,
				}
			);
			if (now - (lastHit[k] ?? 0) > 450) {
				lastHit[k] = now;
				bodies[k]?.animate(
					[
						{ transform: "translateY(0)" },
						{ transform: "translateY(2px)", offset: 0.25 },
						{ transform: "translateY(0)" },
					],
					{ duration: 650, easing: EASE_OUT }
				);
			}
		};

		const spawn = (t: number, pre = 0) => {
			const plot = heroPlots[Math.floor(rand() * 3)];
			const k = plot.files[Math.floor(rand() * plot.files.length)][2];
			const b = heroBuildings[k];
			const path: Point[] = [
				[plot.x + 2, HERO_PLOT_Y + 0.2],
				[plot.x + 2, HERO_STREET],
				[b.door, HERO_STREET],
				[b.door, b.y + b.d + 0.05],
			];
			const segs = [0, 1, 2].map(
				(i) =>
					Math.abs(path[i + 1][0] - path[i][0]) +
					Math.abs(path[i + 1][1] - path[i][1])
			);
			const g = document.createElementNS(
				"http://www.w3.org/2000/svg",
				"g"
			);
			g.innerHTML = tiles[k];
			parcels.appendChild(g);
			live.push({
				g,
				k,
				path,
				segs,
				length: segs.reduce((a, n) => a + n, 0),
				t0: t - pre * 1000,
				hit: false,
				depth: 0,
			});
		};

		const step = (t: number) => {
			for (let i = live.length - 1; i >= 0; i--) {
				const p = live[i];
				const d = ((t - p.t0) / 1000) * 1.7;
				if (d >= p.length - 0.25 && !p.hit) {
					p.hit = true;
					receive(p.k);
				}
				if (d >= p.length) {
					p.g.remove();
					live.splice(i, 1);
					continue;
				}
				const [x, y] = at(p, d);
				const [sx, sy] = H.P(x, y, 0);
				p.depth = x + y;
				p.g.setAttribute(
					"transform",
					`translate(${sx.toFixed(1)},${sy.toFixed(1)})`
				);
				p.g.setAttribute(
					"opacity",
					Math.min(1, d / 0.5, (p.length - d) / 0.4).toFixed(2)
				);
			}
			live.sort((a, b) => a.depth - b.depth).forEach((p) =>
				parcels.appendChild(p.g)
			);
		};

		// The loop runs only while the hero is on screen; parcels resume where they paused.
		let last = 0;
		let prev = 0;
		let started = false;
		let raf = 0;
		const begin = performance.now() + START_DELAY;
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			if (now < begin) return;
			if (!started) {
				started = true;
				for (let n = 0; n < 6; n++) spawn(now, n * 1.15 + 0.2);
				last = prev = now;
			}
			const dt = now - prev;
			prev = now;
			if (dt > 100) {
				live.forEach((p) => (p.t0 += dt));
				last += dt;
			}
			if (now - last > 1050) {
				spawn(now);
				last = now;
			}
			step(now);
		};
		raf = requestAnimationFrame(loop);
		const io = new IntersectionObserver(([e]) => {
			if (e.isIntersecting) {
				if (!raf) raf = requestAnimationFrame(loop);
			} else {
				cancelAnimationFrame(raf);
				raf = 0;
			}
		});
		io.observe(svg);
		return () => {
			io.disconnect();
			cancelAnimationFrame(raf);
			parcels.innerHTML = "";
		};
	}, []);

	return (
		<svg
			ref={ref}
			className="world"
			viewBox={world.viewBox.join(" ")}
			role="img"
			aria-label="An isometric baseplate. Coloured files travel from the Combat, Inventory and Shop feature plots along roads into the coral ServerScriptService, teal ReplicatedStorage and yellow StarterPlayer buildings."
			dangerouslySetInnerHTML={{ __html: world.markup }}
		/>
	);
}
