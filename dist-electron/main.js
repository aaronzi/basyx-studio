import { spawn as e } from "node:child_process";
import { randomBytes as t } from "node:crypto";
import { existsSync as n } from "node:fs";
import { mkdir as r, readFile as i, writeFile as a } from "node:fs/promises";
import { createServer as o } from "node:net";
import { join as s } from "node:path";
import { BrowserWindow as c, app as l, dialog as u, safeStorage as d, session as f, shell as p } from "electron";
//#region electron/main.ts
var m = "X-Studio-Launch-Secret", h = "127.0.0.1", g = 15e3, _, v, y, b = !1;
function x(e) {
	let t = new URL(e), n = /* @__PURE__ */ new Set([
		"127.0.0.1",
		"::1",
		"localhost"
	]);
	if (t.protocol !== "http:" || !n.has(t.hostname)) throw Error("The Electron development server URL must use HTTP on loopback.");
	return t.href;
}
async function S() {
	let e = o();
	await new Promise((t, n) => {
		e.once("error", n), e.listen(0, h, t);
	});
	let t = e.address();
	if (!t || typeof t == "string") throw e.close(), Error("Could not allocate a loopback port for the Studio Service.");
	let n = t.port;
	return await new Promise((t, n) => {
		e.close((e) => e ? n(e) : t());
	}), n;
}
async function C(e, t, n) {
	let r = Date.now() + g, i, a = (e) => {
		i = e;
	};
	n.once("error", a);
	try {
		for (; Date.now() < r;) {
			if (i) throw i;
			if (n.exitCode !== null) throw Error(`The Studio Service exited during startup with code ${n.exitCode}.`);
			try {
				if ((await fetch(e, {
					headers: { [m]: t },
					signal: AbortSignal.timeout(1e3)
				})).ok) return;
			} catch {}
			await new Promise((e) => setTimeout(e, 100));
		}
	} finally {
		n.off("error", a);
	}
	throw Error("Timed out while starting the local Studio Service.");
}
async function w() {
	if (!d.isEncryptionAvailable()) throw Error("The operating system credential store is not available.");
	if (process.platform === "linux" && d.getSelectedStorageBackend() === "basic_text") throw Error("No supported credential store (libsecret or kwallet) was found. BaSyx Studio does not store keys in plain text.");
	let e = s(l.getPath("userData"), "data-key.bin");
	if (n(e)) return d.decryptString(await i(e));
	let o = t(32).toString("base64url");
	return await r(l.getPath("userData"), { recursive: !0 }), await a(e, d.encryptString(o), { mode: 384 }), o;
}
async function T() {
	let r = s(l.getAppPath(), ".output", "server", "index.mjs");
	if (!n(r)) throw Error("The packaged Studio Service entry point is missing.");
	let i = await S(), a = t(32).toString("base64url"), o = `http://${h}:${i}/`, c = await w();
	return y = e(process.execPath, [r], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			NITRO_HOST: h,
			NITRO_PORT: String(i),
			NUXT_STUDIO_DEPLOYMENT_MODE: "desktop",
			STUDIO_DATA_DIR: s(l.getPath("userData"), "studio-data"),
			STUDIO_DATA_KEY: c,
			STUDIO_LAUNCH_SECRET: a
		},
		stdio: [
			"ignore",
			"inherit",
			"inherit"
		]
	}), await C(o, a, y), y.once("exit", (e, t) => {
		b || (u.showErrorBox("BaSyx Studio Service stopped", `The local Studio Service exited unexpectedly (${t ?? e ?? "unknown reason"}).`), l.quit());
	}), {
		launchSecret: a,
		url: o
	};
}
async function E(e, t) {
	let n = f.fromPartition("studio");
	t && n.webRequest.onBeforeSendHeaders({ urls: [`${e}*`] }, (e, n) => {
		n({ requestHeaders: {
			...e.requestHeaders,
			[m]: t
		} });
	});
	let r = new c({
		show: !1,
		title: "BaSyx Studio",
		webPreferences: {
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !0,
			session: n
		}
	}), i = new URL(e).origin;
	r.webContents.on("will-navigate", (e, t) => {
		new URL(t).origin !== i && e.preventDefault();
	}), r.webContents.setWindowOpenHandler(({ url: e }) => {
		let t = new URL(e).protocol;
		return (t === "https:" || t === "http:") && p.openExternal(e), { action: "deny" };
	}), r.once("ready-to-show", () => r.show()), await r.loadURL(e), l.isPackaged || r.webContents.openDevTools();
}
async function D() {
	let e = process.env.VITE_DEV_SERVER_URL;
	if (!l.isPackaged) {
		if (!e) throw Error("The Electron development server URL is missing.");
		_ = x(e), await E(_);
		return;
	}
	let t = await T();
	_ = t.url, v = t.launchSecret, await E(_, v);
}
function O(e) {
	let t = e instanceof Error ? e.message : "Unknown startup error.";
	u.showErrorBox("BaSyx Studio could not start", t), l.quit();
}
l.requestSingleInstanceLock() ? (l.on("second-instance", () => {
	let [e] = c.getAllWindows();
	e && (e.isMinimized() && e.restore(), e.focus());
}), l.whenReady().then(D).catch(O)) : l.quit(), l.on("activate", () => {
	c.getAllWindows().length === 0 && _ && E(_, v).catch(O);
}), l.on("before-quit", () => {
	b = !0, y?.kill(), y = void 0;
}), l.on("window-all-closed", () => {
	process.platform !== "darwin" && l.quit();
});
//#endregion
export {};
