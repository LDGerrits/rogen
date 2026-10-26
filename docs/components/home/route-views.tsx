"use client";

import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { delay } from "./more-link";

type Colour = "s" | "c" | "r" | "o";
type ViewId = "name" | "folder";
type Row = [depth: number, cls: string, label: ReactNode, colour: Colour];

const suffix = (
	name: string,
	colour: "s" | "c",
	route: string,
	ext = ".luau"
) => (
	<>
		{name}
		<span className={`c-${colour}`}>{route}</span>
		{ext}
	</>
);

const ui: Row[] = [
	[0, "", "UI/", "r"],
	[1, "", "InventoryHud.luau", "r"],
	[1, "", "ItemSlot.luau", "r"],
];
const shared: Row[] = [
	[0, "", "InventoryTypes.luau", "r"],
	[0, "", "ItemCatalog.luau", "r"],
	[0, "", "ItemIcons.rbxm", "r"],
];

const views: Record<ViewId, { label: string; desc: string; rows: Row[] }> = {
	name: {
		label: "Route by name",
		desc: "Mark only the files that belong on one side. Everything else goes to ReplicatedStorage through the * route.",
		rows: [
			...ui,
			[0, "", suffix("InventoryController", "c", "@Client"), "c"],
			[0, "", suffix("InventoryInput", "c", "@Client"), "c"],
			[0, "me", suffix("InventoryService", "s", "@Server"), "s"],
			[0, "", suffix("InventoryStore", "s", "@Server"), "s"],
			...shared,
		],
	},
	folder: {
		label: "Route by folder",
		desc: "Put files in a Client or Server folder. In Studio, that folder disappears and its files sit directly in the feature's folder.",
		rows: [
			...ui,
			[
				0,
				"",
				<span key="c" className="c-c">
					Client/
				</span>,
				"o",
			],
			[1, "", "InventoryController.luau", "c"],
			[1, "", "InventoryInput.luau", "c"],
			[
				0,
				"",
				<span key="s" className="c-s">
					Server/
				</span>,
				"o",
			],
			[1, "me", "InventoryService.luau", "s"],
			[1, "", "InventoryStore.luau", "s"],
			...shared,
		],
	},
};
const ids = Object.keys(views) as ViewId[];

const studio: Row[] = [
	[0, "svc", "ReplicatedStorage", "r"],
	[1, "", "Shared", "r"],
	[2, "", "Inventory", "r"],
	[3, "", "InventoryTypes", "r"],
	[3, "", "ItemCatalog", "r"],
	[3, "", "ItemIcons", "r"],
	[3, "", "UI", "r"],
	[4, "", "InventoryHud", "r"],
	[4, "", "ItemSlot", "r"],
	[0, "svc", "ServerScriptService", "s"],
	[1, "", "Inventory", "s"],
	[2, "me", "InventoryService", "s"],
	[2, "", "InventoryStore", "s"],
	[0, "svc", "StarterPlayer", "c"],
	[1, "", "StarterPlayerScripts", "c"],
	[2, "", "Inventory", "c"],
	[3, "", "InventoryController", "c"],
	[3, "", "InventoryInput", "c"],
];

function Rows({ rows }: { rows: Row[] }) {
	return rows.map(([depth, cls, label, colour], i) => (
		<div
			key={i}
			className={cls || undefined}
			style={
				{
					"--d": depth,
					transitionDelay: `${Math.min(i, 6) * 30}ms`,
				} as CSSProperties
			}
		>
			<i className={`dia ${colour}`} />
			<span>{label}</span>
		</div>
	));
}

/** The Route by name / Route by folder toggle and the on-disk and Studio panels. */
export function RouteViews() {
	const [view, setView] = useState<ViewId>("name");
	const [shown, setShown] = useState<ViewId>("name");
	const [entering, setEntering] = useState(false);
	const toggle = useRef<HTMLDivElement>(null);
	const knob = useRef<HTMLSpanElement>(null);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	useLayoutEffect(() => {
		const measure = () => {
			const b = buttons.current[ids.indexOf(view)];
			if (!b || !knob.current || !toggle.current) return;
			knob.current.style.width = `${b.offsetWidth}px`;
			knob.current.style.transform = `translateX(${b.offsetLeft}px)`;
			toggle.current.dataset.ready = "";
		};
		measure();
		addEventListener("resize", measure);
		document.fonts?.ready.then(measure);
		return () => removeEventListener("resize", measure);
	}, [view]);

	// New rows mount hidden, then fade up on the next frame.
	useEffect(() => {
		if (!entering) return;
		let raf = requestAnimationFrame(() => {
			raf = requestAnimationFrame(() => setEntering(false));
		});
		return () => cancelAnimationFrame(raf);
	}, [entering]);

	useEffect(() => () => clearTimeout(timer.current), []);

	const select = (next: ViewId) => {
		setView(next);
		clearTimeout(timer.current);
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setShown(next);
			return;
		}
		timer.current = setTimeout(() => {
			setShown(next);
			setEntering(true);
		}, 260);
	};

	const onKeyDown = (e: KeyboardEvent, i: number) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		const n = 1 - i;
		buttons.current[n]?.focus();
		select(ids[n]);
	};

	const swapping = shown !== view || entering;

	return (
		<div className="views">
			<div className="cols views-top">
				<div className="vt rv">
					<div
						ref={toggle}
						className="toggle"
						role="tablist"
						aria-label="Routing style"
					>
						<span ref={knob} className="knob" aria-hidden="true" />
						{ids.map((id, i) => (
							<button
								key={id}
								ref={(el) => {
									buttons.current[i] = el;
								}}
								type="button"
								role="tab"
								aria-selected={view === id}
								tabIndex={view === id ? 0 : -1}
								onClick={() => select(id)}
								onKeyDown={(e) => onKeyDown(e, i)}
							>
								{views[id].label}
							</button>
						))}
					</div>
					<p className="vdesc" aria-live="polite">
						{views[view].desc}
					</p>
				</div>
			</div>
			<div className="cols board rv" style={delay(80)}>
				<div className="panel src">
					<div className="ph">
						<b>src/Inventory</b>
						<span>on disk</span>
					</div>
					<div className={`rows${swapping ? " swap" : ""}`}>
						<Rows rows={views[shown].rows} />
					</div>
				</div>
				<div className="via" aria-hidden="true">
					<svg viewBox="0 0 120 40" fill="none">
						<path
							className="dash"
							d="M4 20H104"
							strokeOpacity=".45"
							strokeWidth="1.5"
							strokeDasharray="4 6"
						/>
						<path
							className="head"
							d="M100 13 112 20 100 27"
							strokeWidth="2"
						/>
					</svg>
				</div>
				<div className="panel dst">
					<div className="ph">
						<b>Result in Roblox Studio</b>
						<span>same for both views</span>
					</div>
					<div className="rows">
						<Rows rows={studio} />
					</div>
				</div>
			</div>
		</div>
	);
}
