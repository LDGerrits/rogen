"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
	Chevron,
	ClassIcon,
	FileIcon,
	hasChildren,
	IndentGuides,
	StudioWindow,
	Triangle,
	VsCodeWindow,
} from "../ide";
import type { Service } from "./explorer";
import { disk, Name, studio, studioClass } from "./inventory";
import { getLang, onLang, type Lang } from "./lang";

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

// What sits around src/Inventory in a project: the packages, and the files at the top.
const AROUND: Record<
	Lang,
	{ packages: string; files: string[]; studioPackages: string }
> = {
	luau: {
		packages: "Packages/",
		files: ["default.rogen.json", "rokit.toml", "wally.toml"],
		studioPackages: "Packages",
	},
	ts: {
		packages: "node_modules/",
		files: ["default.rogen.json", "package.json", "tsconfig.json"],
		studioPackages: "rbxts_include",
	},
};

type HeroDiskRow = {
	name: string;
	depth: number;
	key?: string;
	colour?: Service;
};
type HeroStudioRow = {
	name: string;
	depth: number;
	icon: string;
	key?: string;
	colour?: Service;
	closed?: boolean;
	arrives?: boolean;
};

function diskRows(lang: Lang): HeroDiskRow[] {
	const { packages, files } = AROUND[lang];
	return [
		{ name: packages, depth: 0 },
		...disk[lang].map(([name, depth, key, colour]) => ({
			name,
			depth,
			key,
			colour,
		})),
		...files.map((name) => ({ name, depth: 0 })),
	];
}

function studioRows(lang: Lang): HeroStudioRow[] {
	const rows: HeroStudioRow[] = [
		{ name: "Workspace", depth: 0, icon: "Workspace", closed: true },
		{ name: "Players", depth: 0, icon: "Players" },
		{ name: "Lighting", depth: 0, icon: "Lighting", closed: true },
	];
	for (const [key, name, depth, icon, colour] of studio[lang]) {
		rows.push({
			name,
			depth,
			icon: studioClass(icon, name),
			key: key || undefined,
			colour,
			arrives: icon !== "svc",
		});
		if (name === "ReplicatedStorage")
			rows.push({
				name: AROUND[lang].studioPackages,
				depth: 1,
				icon: "Folder",
				closed: true,
			});
	}
	return rows;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** VS Code with src/Inventory and rogen serve in its terminal, each file wired to where it lands in the Studio Explorer. */
export function HeroDemo() {
	const ref = useRef<HTMLElement>(null);

	useEffect(() => {
		const stage = ref.current;
		if (!stage) return;
		const wires = stage.querySelector<SVGSVGElement>("[data-wires]")!;
		const typed = stage.querySelector<HTMLElement>("[data-typed]")!;
		const lines = [...stage.querySelectorAll<HTMLElement>("[data-l]")];
		const arrivals = [...stage.querySelectorAll<HTMLElement>(".arr")];
		let active = cycle[0];
		let timer = 0;
		let hovering = false;
		let visible = true;
		let ready = false;
		let cancelled = false;

		const setActive = (k: string) => {
			active = k;
			stage
				.querySelectorAll<HTMLElement>("[data-k]")
				.forEach((el) => el.classList.toggle("on", el.dataset.k === k));
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
			const s = stage.getBoundingClientRect();
			wires.setAttribute("viewBox", `0 0 ${s.width} ${s.height}`);
			wires.innerHTML = cycle
				.map((k) => {
					const shown = `[data-only="${getLang()}"]`;
					const from = stage
						.querySelector(`.ide-vs ${shown} [data-k="${k}"] .nm`)!
						.getBoundingClientRect();
					const row = stage.querySelector<HTMLElement>(
						`.ide-st ${shown} [data-k="${k}"]`
					)!;
					const to = row
						.querySelector(".ide-ci")!
						.getBoundingClientRect();
					const x1 = from.right - s.left + 10;
					const y1 = from.top - s.top + from.height / 2;
					const x2 = to.left - s.left - 8;
					const y2 = to.top - s.top + to.height / 2;
					const m = (x1 + x2) / 2;
					return `<path data-k="${k}" class="w-${row.dataset.c}" pathLength="1" d="M${x1.toFixed(1)} ${y1.toFixed(1)} C${m.toFixed(1)} ${y1.toFixed(1)} ${m.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
				})
				.join("");
			setActive(active);
		};

		// Types the command, prints the serve log and fills the Explorer once.
		const play = async () => {
			stage.classList.add("play");
			typed.textContent = "";
			await sleep(700);
			for (let i = 1; i <= COMMAND.length && !cancelled; i++) {
				typed.textContent = COMMAND.slice(0, i);
				await sleep(55);
			}
			for (const [i, ms] of [280, 380, 200].entries()) {
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
			lines.slice(3).forEach((line) => line.classList.add("in"));
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
			...stage.querySelectorAll<HTMLElement>("li[data-k]"),
		];
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
		io.observe(stage);
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
			stage.classList.remove("play");
			typed.textContent = COMMAND;
			[...lines, ...arrivals, wires].forEach((el) =>
				el.classList.remove("in")
			);
		};
	}, []);

	return (
		<figure
			ref={ref}
			className="hero-ide ide"
			aria-label="VS Code with the Inventory feature and rogen serve in its terminal, each file wired to where it appears in the Roblox Studio Explorer"
		>
			<VsCodeWindow title="my-game">
				<div className="ide-main">
					<div className="ide-act" aria-hidden="true">
						<svg className="on" viewBox="0 0 24 24">
							<path d="M13.5 3H7a1 1 0 00-1 1v13a1 1 0 001 1h10a1 1 0 001-1V7.5zM13.5 3v4.5H18M9 21h9a1 1 0 001-1V10" />
						</svg>
						<svg viewBox="0 0 24 24">
							<circle cx="10.5" cy="10.5" r="6" />
							<path d="M15 15l5 5" />
						</svg>
						<svg viewBox="0 0 24 24">
							<circle cx="7" cy="5" r="2" />
							<circle cx="7" cy="19" r="2" />
							<circle cx="17" cy="8" r="2" />
							<path d="M7 7v10M17 10c0 4-10 3-10 7" />
						</svg>
					</div>
					<div className="ide-side">
						<div className="ide-hd">EXPLORER</div>
						<div className="ide-section">
							<Chevron open />
							MY-GAME
						</div>
						{LANGS.map((lang) => {
							const rows = diskRows(lang);
							return (
								<ul
									key={lang}
									className="ide-tree"
									data-only={lang}
								>
									{rows.map(
										({ name, depth, key, colour }, i) => {
											const folder = name.endsWith("/");
											return (
												<li
													key={`${name}${i}`}
													data-k={key || undefined}
													className={
														colour
															? `k-${colour}`
															: undefined
													}
													style={
														{
															"--d": depth,
														} as CSSProperties
													}
												>
													<span className="band" />
													<IndentGuides
														depth={depth}
													/>
													{folder && (
														<Chevron
															open={hasChildren(
																rows,
																i
															)}
														/>
													)}
													{!folder && (
														<FileIcon name={name} />
													)}
													<Name
														name={name.replace(
															/\/$/,
															""
														)}
														colour={colour}
													/>
												</li>
											);
										}
									)}
								</ul>
							);
						})}
					</div>
				</div>
				<div className="ide-panel">
					<div className="ide-tabs" aria-hidden="true">
						<span>PROBLEMS</span>
						<span>OUTPUT</span>
						<span className="on">TERMINAL</span>
						<span>PORTS</span>
					</div>
					<div className="ide-term">
						<span className="ln">
							<span className="ps">my-game %</span>{" "}
							<span className="cmd-t" data-typed="">
								{COMMAND}
							</span>
						</span>
						<span className="ln dim" data-l="">
							rogen serve · default.rogen.json
						</span>
						<span className="ln" data-l="">
							Serving my-game at localhost:34872 ·
							http://localhost:34872/
						</span>
						<span className="ln dim" data-l="">
							{"  "}In Studio, press Connect in the Rojo plugin.
						</span>
						<span className="ln" data-l="">
							Studio connected to my-game.
						</span>
						<span className="ln" data-l="">
							<span className="cur" aria-hidden="true" />
						</span>
					</div>
				</div>
			</VsCodeWindow>
			<StudioWindow>
				{LANGS.map((lang) => {
					const rows = studioRows(lang);
					return (
						<ul key={lang} className="ide-tree" data-only={lang}>
							{rows.map((row, i) => (
								<li
									key={i}
									data-k={row.key}
									data-c={row.colour}
									className={[
										row.colour && `k-${row.colour}`,
										row.arrives && "arr",
									]
										.filter(Boolean)
										.join(" ")}
									style={
										{ "--d": row.depth } as CSSProperties
									}
								>
									<span className="band" />
									<Triangle
										open={
											hasChildren(rows, i)
												? true
												: row.closed
													? false
													: undefined
										}
									/>
									<ClassIcon name={row.icon} />
									<span className="nm">{row.name}</span>
								</li>
							))}
						</ul>
					);
				})}
			</StudioWindow>
			<svg className="wires" data-wires="" aria-hidden="true" />
		</figure>
	);
}
