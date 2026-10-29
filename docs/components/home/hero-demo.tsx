"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { disk, Name, studio, StudioIcon } from "./inventory";
import { getLang, onLang, type Lang } from "./lang";
import { TreeGuides } from "./tree-guides";

// Both languages are in the page; the stylesheet shows the current one, so it is right before the page runs.
const LANGS: Lang[] = ["luau", "ts"];

// The order the highlight visits the files in.
const cycle = [
	"svc",
	"ctrl",
	"types",
	"hud",
	"store",
	"input",
	"cat",
	"icons",
	"slot",
];
const COMMAND = "rogen serve";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** rogen serve in a terminal, then each file of src/Inventory wired to where it lands in the Studio Explorer. */
export function HeroDemo() {
	const ref = useRef<HTMLElement>(null);

	useEffect(() => {
		const win = ref.current;
		if (!win) return;
		const split = win.querySelector<HTMLElement>("[data-split]")!;
		const wires = win.querySelector<SVGSVGElement>("[data-wires]")!;
		const typed = win.querySelector<HTMLElement>("[data-typed]")!;
		const lines = [...win.querySelectorAll<HTMLElement>("[data-l]")];
		const arrivals = [...win.querySelectorAll<HTMLElement>(".x.arr")];
		let active = cycle[0];
		let timer = 0;
		let hovering = false;
		let visible = true;
		let ready = false;
		let cancelled = false;

		const setActive = (k: string) => {
			active = k;
			win.querySelectorAll<HTMLElement>("[data-k]").forEach((el) =>
				el.classList.toggle("on", el.dataset.k === k)
			);
			wires
				.querySelectorAll<SVGPathElement>("path")
				.forEach((p) => p.classList.toggle("on", p.dataset.k === k));
		};
		const next = () => {
			clearTimeout(timer);
			if (hovering || !visible || !ready) return;
			timer = window.setTimeout(() => {
				setActive(cycle[(cycle.indexOf(active) + 1) % cycle.length]);
				next();
			}, 2000);
		};

		const draw = () => {
			if (getComputedStyle(wires).display === "none") return;
			const s = split.getBoundingClientRect();
			wires.setAttribute("viewBox", `0 0 ${s.width} ${s.height}`);
			wires.innerHTML = cycle
				.map((k) => {
					const shown = `[data-only="${getLang()}"]`;
					const from = win
						.querySelector(`.tree${shown} [data-k="${k}"] .nm`)!
						.getBoundingClientRect();
					const row = win.querySelector<HTMLElement>(
						`.xt${shown} [data-k="${k}"]`
					)!;
					const to = row
						.querySelector(".ic")!
						.getBoundingClientRect();
					const x1 = from.right - s.left + 10;
					const y1 = from.top - s.top + from.height / 2;
					const x2 = to.left - s.left - 24;
					const y2 = to.top - s.top + to.height / 2;
					const m = (x1 + x2) / 2;
					return `<path data-k="${k}" class="w-${row.dataset.c}" pathLength="1" d="M${x1.toFixed(1)} ${y1.toFixed(1)} C${m.toFixed(1)} ${y1.toFixed(1)} ${m.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
				})
				.join("");
			setActive(active);
		};

		// Types the command, prints the serve log and fills the Explorer once.
		const play = async () => {
			win.classList.add("play");
			typed.textContent = "";
			await sleep(700);
			for (let i = 1; i <= COMMAND.length && !cancelled; i++) {
				typed.textContent = COMMAND.slice(0, i);
				await sleep(55);
			}
			for (const [i, ms] of [280, 380, 420].entries()) {
				await sleep(ms);
				if (cancelled) return;
				lines[i].classList.add("in");
			}
			for (const row of arrivals) {
				await sleep(40);
				if (cancelled) return;
				row.classList.add("in");
			}
			await sleep(120);
			if (cancelled) return;
			wires.classList.add("in");
			lines[3].classList.add("in");
			await sleep(900);
			ready = true;
			next();
		};

		const enter = (e: Event) => {
			const k = (e.currentTarget as HTMLElement).dataset.k!;
			hovering = true;
			clearTimeout(timer);
			setActive(k);
		};
		const leave = () => {
			hovering = false;
			next();
		};
		const hoverable = [
			...win.querySelectorAll<HTMLElement>("[data-k]"),
		].filter((el) => el.tagName === "LI");
		hoverable.forEach((el) => {
			el.addEventListener("mouseenter", enter);
			el.addEventListener("mouseleave", leave);
		});

		draw();
		document.fonts?.ready.then(draw);
		addEventListener("resize", draw);
		const offLang = onLang(draw);
		const io = new IntersectionObserver(([e]) => {
			visible = e.isIntersecting;
			if (visible) next();
			else clearTimeout(timer);
		});
		io.observe(win);
		play();

		return () => {
			cancelled = true;
			clearTimeout(timer);
			io.disconnect();
			removeEventListener("resize", draw);
			offLang();
			hoverable.forEach((el) => {
				el.removeEventListener("mouseenter", enter);
				el.removeEventListener("mouseleave", leave);
			});
			win.classList.remove("play");
			typed.textContent = COMMAND;
			[...lines, ...arrivals, wires].forEach((el) =>
				el.classList.remove("in")
			);
		};
	}, []);

	return (
		<figure
			ref={ref}
			className="win"
			aria-label="rogen serve in a terminal, then the files of the Inventory feature on disk, each wired to where it appears in the Roblox Studio Explorer"
		>
			<div className="win-bar" aria-hidden="true">
				<span className="dots">
					<i />
					<i />
					<i />
				</span>
				<span>~/game</span>
				<span />
			</div>
			<div className="term">
				<span className="ln">
					<span className="ps">~/game</span>{" "}
					<span className="fr">$</span>{" "}
					<span className="cmd-t" data-typed="">
						{COMMAND}
					</span>
				</span>
				<span className="ln frame-top" data-l="">
					rogen serve · default.rogen.json
				</span>
				<span className="ln frame" data-l="">
					<span className="ok">✔</span>{" "}
					<span className="tx">
						Serving default.rogen.json with Rojo 7.7.1 at
						127.0.0.1:34872.
					</span>
				</span>
				<span className="ln frame" data-l="">
					Studio connected to default.rogen.json.
				</span>
				<span className="ln frame" data-l="">
					<span className="cur" aria-hidden="true" />
				</span>
			</div>
			<div className="wsplit" data-split="">
				<div className="side">
					<div className="pane-h">
						<b>src/</b>
						<span>VS Code</span>
					</div>
					{LANGS.map((lang) => (
						<ul key={lang} className="tree" data-only={lang}>
							{disk[lang].map(
								([name, depth, key, colour], i, rows) => (
									<li
										key={name}
										data-k={key}
										className={
											[
												!key && "b",
												colour && `k-${colour}`,
											]
												.filter(Boolean)
												.join(" ") || undefined
										}
									>
										<span className="band" />
										<TreeGuides
											depths={rows.map((row) => row[1])}
											i={i}
										/>
										<Name name={name} colour={colour} />
									</li>
								)
							)}
						</ul>
					))}
				</div>
				<div className="side">
					<div className="pane-h">
						<b>Explorer</b>
						<span>Roblox Studio</span>
					</div>
					{LANGS.map((lang) => (
						<ul key={lang} className="xt" data-only={lang}>
							{studio[lang].map(
								([key, name, depth, icon, colour], i) => (
									<li
										key={i}
										data-k={key || undefined}
										data-c={colour}
										className={`x k-${colour}${icon === "svc" ? " svc" : " arr"}`}
										style={
											{ "--d": depth } as CSSProperties
										}
									>
										<span className="band" />
										<StudioIcon icon={icon} />
										<span className="nm">{name}</span>
									</li>
								)
							)}
						</ul>
					))}
				</div>
				<svg className="wires" data-wires="" aria-hidden="true" />
			</div>
		</figure>
	);
}
