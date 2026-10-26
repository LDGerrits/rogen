"use client";

import { useEffect, useRef } from "react";

const ROOMS = [
	["Combat/", "--agent-1", "agent 1"],
	["Inventory/", "--agent-2", "agent 2"],
	["Shop/", "--agent-3", "agent 3"],
] as const;
const WORDS = ["====", "======", "==", "========", "---", "-----", "+++", "::"];

/** Three feature folders drawn in box characters, each with an agent typing in it. */
export function AgentRooms() {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current;
		const cx = canvas?.getContext("2d");
		if (!canvas || !cx) return;
		const lines: string[][] = ROOMS.map(() => []);
		let seed = 7;
		const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

		const grow = () =>
			lines.forEach((L, k) => {
				if (!L.length || rand() < 0.14) L.push("");
				const i = L.length - 1;
				if (L[i].length < 30 + k * 4)
					L[i] +=
						(L[i] ? " " : "  ".repeat(Math.floor(rand() * 3))) +
						WORDS[Math.floor(rand() * WORDS.length)];
				else L.push("");
			});
		for (let n = 0; n < 40; n++) grow();

		const draw = (now: number) => {
			const css = getComputedStyle(canvas);
			const colour = (name: string) => css.getPropertyValue(name).trim();
			const frame = colour("--ink-3");
			const r = canvas.getBoundingClientRect();
			const d = Math.min(2, devicePixelRatio || 1);
			if (canvas.width !== Math.round(r.width * d)) {
				canvas.width = Math.round(r.width * d);
				canvas.height = Math.round(r.height * d);
			}
			cx.setTransform(d, 0, 0, d, 0, 0);
			cx.clearRect(0, 0, r.width, r.height);
			const fs = r.width < 640 ? 12 : 13;
			cx.font = `400 ${fs}px ${css.fontFamily}`;
			cx.textBaseline = "top";
			const cw = cx.measureText("0").width;
			const lh = fs * 1.55;
			const stacked = r.width < 640;
			const n = ROOMS.length;
			const rw = stacked ? r.width : (r.width - (n - 1) * 24) / n;
			const rh = stacked ? (r.height - 2 * 16) / 3 : r.height;
			ROOMS.forEach(([name, varName, who], k) => {
				const tint = colour(varName);
				const x0 = stacked ? 0 : k * (rw + 24);
				const y0 = stacked ? k * (rh + 16) : 0;
				const c = Math.floor(rw / cw);
				const rr = Math.floor(rh / lh);
				// The frame goes down cell by cell, so it stays on the grid whatever the glyph widths.
				const cell = (ch: string, col: number, row: number) =>
					cx.fillText(ch, x0 + col * cw, y0 + row * lh);
				const top = 3 + name.length + 1;
				const bottom = c - who.length - 4;
				cx.globalAlpha = 0.55;
				cx.fillStyle = frame;
				cell("┌", 0, 0);
				cell("┐", c - 1, 0);
				cell("└", 0, rr - 1);
				cell("┘", c - 1, rr - 1);
				for (let i = 1; i < c - 1; i++) {
					if (i < 2 || i >= top) cell("─", i, 0);
					if (i < bottom || i >= c - 3) cell("─", i, rr - 1);
				}
				for (let j = 1; j < rr - 1; j++) {
					cell("│", 0, j);
					cell("│", c - 1, j);
				}
				cx.globalAlpha = 1;
				cx.fillStyle = tint;
				cx.fillText(name, x0 + 3 * cw, y0);
				cx.fillText(who, x0 + (bottom + 1) * cw, y0 + (rr - 1) * lh);

				const L = lines[k];
				const maxL = rr - 3;
				const maxC = c - 6;
				while (L.length > maxL) L.shift();
				L.forEach((ln, j) => {
					const last = j === L.length - 1;
					cx.globalAlpha = last ? 1 : 0.5;
					cx.fillStyle = last ? tint : frame;
					cx.fillText(
						ln.slice(0, maxC),
						x0 + 2 * cw,
						y0 + (j + 1.4) * lh
					);
				});
				cx.globalAlpha = 1;
				if (Math.floor(now / 500) % 2) {
					const last = L[L.length - 1] ?? "";
					cx.fillStyle = tint;
					cx.fillRect(
						x0 + (2 + Math.min(last.length, maxC)) * cw + 2,
						y0 + (Math.max(L.length, 1) + 0.4) * lh,
						cw,
						lh - 5
					);
				}
			});
		};

		// The loop runs only while the rooms are on screen.
		let raf = 0;
		let last = 0;
		const loop = (now: number) => {
			raf = requestAnimationFrame(loop);
			if (now - last > 140) {
				grow();
				last = now;
			}
			draw(now);
		};
		const io = new IntersectionObserver(([e]) => {
			cancelAnimationFrame(raf);
			raf = e.isIntersecting ? requestAnimationFrame(loop) : 0;
		});
		io.observe(canvas);
		document.fonts?.ready.then(() => draw(performance.now()));
		return () => {
			io.disconnect();
			cancelAnimationFrame(raf);
		};
	}, []);

	return <canvas ref={ref} className="rooms rv" aria-hidden="true" />;
}
