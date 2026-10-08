import { spawn as e } from "node:child_process";
import { randomBytes as t } from "node:crypto";
import { existsSync as n } from "node:fs";
import { mkdir as r, readFile as i, writeFile as a } from "node:fs/promises";
import { createServer as o } from "node:net";
import { join as s } from "node:path";
import { BrowserWindow as c, app as l, dialog as u, ipcMain as d, safeStorage as f, session as p, shell as m } from "electron";
//#region electron/main.ts
var h = "X-Studio-Launch-Secret", g = "X-Studio-Broker-Secret", _ = "127.0.0.1", v = 15e3, y = [{
	name: "AASX package",
	extensions: ["aasx"]
}], b = process.env.STUDIO_BROKER_SECRET ?? t(32).toString("base64url"), x, S, C, w = !1;
function T(e) {
	let t = new URL(e), n = /* @__PURE__ */ new Set([
		"127.0.0.1",
		"::1",
		"localhost"
	]);
	if (t.protocol !== "http:" || !n.has(t.hostname)) throw Error("The Electron development server URL must use HTTP on loopback.");
	return t.href;
}
async function E() {
	let e = o();
	await new Promise((t, n) => {
		e.once("error", n), e.listen(0, _, t);
	});
	let t = e.address();
	if (!t || typeof t == "string") throw e.close(), Error("Could not allocate a loopback port for the Studio Service.");
	let n = t.port;
	return await new Promise((t, n) => {
		e.close((e) => e ? n(e) : t());
	}), n;
}
async function D(e, t, n) {
	let r = Date.now() + v, i, a = (e) => {
		i = e;
	};
	n.once("error", a);
	try {
		for (; Date.now() < r;) {
			if (i) throw i;
			if (n.exitCode !== null) throw Error(`The Studio Service exited during startup with code ${n.exitCode}.`);
			try {
				if ((await fetch(e, {
					headers: { [h]: t },
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
async function O() {
	if (!f.isEncryptionAvailable()) throw Error("The operating system credential store is not available.");
	if (process.platform === "linux" && f.getSelectedStorageBackend() === "basic_text") throw Error("No supported credential store (libsecret or kwallet) was found. BaSyx Studio does not store keys in plain text.");
	let e = s(l.getPath("userData"), "data-key.bin");
	if (n(e)) return f.decryptString(await i(e));
	let o = t(32).toString("base64url");
	return await r(l.getPath("userData"), { recursive: !0 }), await a(e, f.encryptString(o), { mode: 384 }), o;
}
async function k() {
	let r = s(l.getAppPath(), ".output", "server", "index.mjs");
	if (!n(r)) throw Error("The packaged Studio Service entry point is missing.");
	let i = await E(), a = t(32).toString("base64url"), o = `http://${_}:${i}/`, c = await O();
	return C = e(process.execPath, [r], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "1",
			NITRO_HOST: _,
			NITRO_PORT: String(i),
			NUXT_STUDIO_DEPLOYMENT_MODE: "desktop",
			STUDIO_DATA_DIR: s(l.getPath("userData"), "studio-data"),
			STUDIO_DATA_KEY: c,
			STUDIO_LAUNCH_SECRET: a,
			STUDIO_BROKER_SECRET: b
		},
		stdio: [
			"ignore",
			"inherit",
			"inherit"
		]
	}), await D(o, a, C), C.once("exit", (e, t) => {
		w || (u.showErrorBox("BaSyx Studio Service stopped", `The local Studio Service exited unexpectedly (${t ?? e ?? "unknown reason"}).`), l.quit());
	}), {
		launchSecret: a,
		url: o
	};
}
async function A(e, t) {
	let n = p.fromPartition("studio");
	t && n.webRequest.onBeforeSendHeaders({ urls: [`${e}*`] }, (e, n) => {
		n({ requestHeaders: {
			...e.requestHeaders,
			[h]: t
		} });
	});
	let r = new c({
		show: !1,
		title: "BaSyx Studio",
		webPreferences: {
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !0,
			session: n,
			preload: s(import.meta.dirname, "preload.cjs")
		}
	});
	P(r);
	let i = new URL(e).origin;
	r.webContents.on("will-navigate", (e, t) => {
		new URL(t).origin !== i && e.preventDefault();
	}), r.webContents.setWindowOpenHandler(({ url: e }) => {
		let t = new URL(e).protocol;
		return (t === "https:" || t === "http:") && m.openExternal(e), { action: "deny" };
	}), r.once("ready-to-show", () => r.show()), await r.loadURL(e), l.isPackaged || r.webContents.openDevTools();
}
async function j(e, t = {}) {
	if (!x) throw Error("The Studio Service is not running.");
	let n = await fetch(new URL(`api/studio/v1/${e}`, x), {
		method: t.method ?? "GET",
		headers: {
			[g]: b,
			...S ? { [h]: S } : {},
			...t.body === void 0 ? {} : { "Content-Type": "application/json" }
		},
		body: t.body === void 0 ? void 0 : JSON.stringify(t.body),
		signal: AbortSignal.timeout(1e4)
	});
	if (!n.ok) throw Error(`The Studio Service answered with HTTP ${n.status}.`);
	return await n.json();
}
function M(e) {
	let t = e.senderFrame;
	return !!(x && t && t === e.sender.mainFrame && new URL(t.url).origin === new URL(x).origin);
}
function N() {
	d.handle("studio:choose-aasx-file", async (e) => {
		if (!M(e)) throw Error("Untrusted sender.");
		let t = c.fromWebContents(e.sender), n = {
			properties: ["openFile"],
			filters: y
		}, r = t ? await u.showOpenDialog(t, n) : await u.showOpenDialog(n);
		return r.canceled || !r.filePaths[0] ? null : j("desktop/file-grants", {
			method: "POST",
			body: {
				path: r.filePaths[0],
				purpose: "open"
			}
		});
	}), d.handle("studio:choose-save-location", async (e, t) => {
		if (!M(e)) throw Error("Untrusted sender.");
		let n = c.fromWebContents(e.sender), r = {
			defaultPath: typeof t == "string" ? t.replaceAll(/[/\\]/g, "_") : void 0,
			filters: y
		}, i = n ? await u.showSaveDialog(n, r) : await u.showSaveDialog(r);
		return i.canceled || !i.filePath ? null : j("desktop/file-grants", {
			method: "POST",
			body: {
				path: i.filePath.toLowerCase().endsWith(".aasx") ? i.filePath : `${i.filePath}.aasx`,
				purpose: "save"
			}
		});
	});
}
function P(e) {
	let t = !1;
	e.on("close", (n) => {
		t || (n.preventDefault(), j("desktop/state").then((e) => e.unsavedWorkspaces).catch(() => []).then(async (n) => {
			if (n.length > 0) {
				let { response: t } = await u.showMessageBox(e, {
					type: "warning",
					buttons: ["Cancel", "Close without saving"],
					defaultId: 0,
					cancelId: 0,
					message: "Some packages have unsaved changes.",
					detail: n.join("\n")
				});
				if (t !== 1) {
					w = !1;
					return;
				}
			}
			t = !0, e.close();
		}));
	});
}
async function F() {
	N();
	let e = process.env.VITE_DEV_SERVER_URL;
	if (!l.isPackaged) {
		if (!e) throw Error("The Electron development server URL is missing.");
		x = T(e), await A(x);
		return;
	}
	let t = await k();
	x = t.url, S = t.launchSecret, await A(x, S);
}
function I(e) {
	let t = e instanceof Error ? e.message : "Unknown startup error.";
	u.showErrorBox("BaSyx Studio could not start", t), l.quit();
}
l.requestSingleInstanceLock() ? (l.on("second-instance", () => {
	let [e] = c.getAllWindows();
	e && (e.isMinimized() && e.restore(), e.focus());
}), l.whenReady().then(F).catch(I)) : l.quit(), l.on("activate", () => {
	c.getAllWindows().length === 0 && x && A(x, S).catch(I);
}), l.on("before-quit", () => {
	w = !0;
}), l.on("will-quit", () => {
	C?.kill(), C = void 0;
}), l.on("window-all-closed", () => {
	process.platform !== "darwin" && l.quit();
});
//#endregion
export {};
