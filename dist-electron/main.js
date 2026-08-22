import { BrowserWindow as e, app as t, clipboard as n, ipcMain as r, session as i } from "electron";
import a from "node:path";
import { fileURLToPath as o } from "node:url";
import { Socket as s } from "node:net";
Object.freeze({
	modbusRtu: !0,
	modbusTcp: !1,
	serialPorts: "browser-picker",
	filesystem: "limited",
	nodePlugins: !1,
	webPlugins: !0
});
//#endregion
//#region ../../packages/domain/src/config.ts
var c = {
	rtu: {
		baudRate: 9600,
		dataBits: 8,
		stopBits: 1,
		parity: "none",
		flowControl: "off",
		requestTimeoutMs: 1e3,
		retryCount: 1,
		interRequestDelayMs: 50,
		addressAdjust: "off"
	},
	tcp: {
		unitId: 0,
		connectTimeoutMs: 5e3,
		requestTimeoutMs: 1e3,
		retryCount: 1,
		autoReconnect: !1,
		interRequestDelayMs: 50
	},
	registerTable: {
		addressRadix: "dec",
		slaveAddress: 1,
		defaultRowCount: 50
	},
	polling: { maxPendingPollingTasks: 1 },
	logging: {
		maxCommunicationLogEntries: 1e4,
		maxApplicationMessages: 2e3
	},
	autosave: { debounceMs: 500 },
	trace: {
		maxContinueEntries: 1e4,
		speedMinMs: 100,
		speedMaxMs: 2e3
	}
};
//#endregion
//#region ../../packages/domain/src/errors.ts
function l(e) {
	let t = {
		code: e.code,
		category: e.category,
		severity: e.severity ?? "error",
		retryable: e.retryable ?? !1,
		userMessageKey: e.userMessageKey,
		technicalMessage: e.technicalMessage
	};
	return e.cause !== void 0 && (t.cause = e.cause), e.context !== void 0 && (t.context = e.context), t;
}
//#endregion
//#region ../../packages/domain/src/result.ts
function u(e) {
	return {
		ok: !0,
		value: e
	};
}
function d(e) {
	return {
		ok: !1,
		error: e
	};
}
//#endregion
//#region ../../packages/domain/src/raw-value.ts
var f = class e {
	value;
	constructor(e) {
		this.value = e;
	}
	static create(t) {
		let n = p(t);
		return n === null ? u(new e(t)) : d(n);
	}
};
function p(e) {
	return typeof e == "number" ? Number.isInteger(e) ? e < 0 || e > 65535 ? l({
		code: "RAW_VALUE_OUT_OF_RANGE",
		category: "validation",
		userMessageKey: "errors.rawValueOutOfRange",
		technicalMessage: `raw register value must be within 0..65535, got ${e}`
	}) : null : l({
		code: "RAW_VALUE_NOT_INTEGER",
		category: "validation",
		userMessageKey: "errors.rawValueNotInteger",
		technicalMessage: `raw register value must be an integer, got ${e}`
	}) : l({
		code: "RAW_VALUE_INVALID_TYPE",
		category: "validation",
		userMessageKey: "errors.rawValueInvalidType",
		technicalMessage: `raw register value must be a number, got ${String(e)}`
	});
}
//#endregion
//#region ../../packages/domain/src/register-address.ts
var ee = class e {
	value;
	constructor(e) {
		this.value = e;
	}
	static create(t) {
		return typeof t != "number" || !Number.isInteger(t) ? d(l({
			code: "REGISTER_ADDRESS_INVALID",
			category: "validation",
			userMessageKey: "errors.registerAddressInvalid",
			technicalMessage: `register address must be an integer, got ${String(t)}`
		})) : t < 0 || t > 65535 ? d(l({
			code: "REGISTER_ADDRESS_OUT_OF_RANGE",
			category: "validation",
			userMessageKey: "errors.registerAddressOutOfRange",
			technicalMessage: `register address must be within 0..65535, got ${t}`
		})) : u(new e(t));
	}
};
//#endregion
//#region ../../packages/domain/src/tcp-profile.ts
function te(e, t, n) {
	return l({
		code: e,
		category: "validation",
		userMessageKey: t,
		technicalMessage: n
	});
}
function ne(e) {
	return typeof e == "number" && Number.isInteger(e) && e > 0;
}
function re(e) {
	return typeof e == "number" && Number.isInteger(e) && e >= 0;
}
function ie(e) {
	if (typeof e != "object" || !e) return d(te("TCP_HOST_INVALID", "errors.tcpHostInvalid", "tcp connection profile must be an object"));
	let t = e;
	if (typeof t.host != "string" || t.host.trim().length === 0) return d(te("TCP_HOST_INVALID", "errors.tcpHostInvalid", `host must be a non-empty string, got ${String(t.host)}`));
	if (typeof t.port != "number" || !Number.isInteger(t.port) || t.port < 1 || t.port > 65535) return d(te("TCP_PORT_OUT_OF_RANGE", "errors.tcpPortOutOfRange", `port must be an integer within 1..65535, got ${String(t.port)}`));
	if (typeof t.unitId != "number" || !Number.isInteger(t.unitId) || t.unitId < 0 || t.unitId > 255) return d(te("TCP_UNIT_ID_OUT_OF_RANGE", "errors.tcpUnitIdOutOfRange", `unitId must be an integer within 0..255, got ${String(t.unitId)}`));
	let n = c.tcp;
	return u({
		id: typeof t.id == "string" && t.id.length > 0 ? t.id : "",
		name: typeof t.name == "string" && t.name.length > 0 ? t.name : "TCP",
		protocol: "tcp",
		host: t.host,
		port: t.port,
		unitId: t.unitId,
		connectTimeoutMs: ne(t.connectTimeoutMs) ? t.connectTimeoutMs : n.connectTimeoutMs,
		requestTimeoutMs: ne(t.requestTimeoutMs) ? t.requestTimeoutMs : n.requestTimeoutMs,
		retryCount: re(t.retryCount) ? t.retryCount : n.retryCount,
		autoReconnect: typeof t.autoReconnect == "boolean" ? t.autoReconnect : n.autoReconnect,
		interRequestDelayMs: re(t.interRequestDelayMs) ? t.interRequestDelayMs : n.interRequestDelayMs
	});
}
//#endregion
//#region ../../packages/domain/src/workspace-model.ts
var ae = 0;
function oe(e) {
	return ae += 1, `${e}-${Date.now().toString(36)}-${ae.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function se() {
	return oe("row");
}
function ce() {
	let e = Date.now();
	return {
		rowId: se(),
		order: 0,
		name: "",
		comment: "",
		addressDraft: "",
		addressValue: null,
		dataType: "hex",
		pollingEnabled: !1,
		traceEnabled: !1,
		cellText: "",
		lastKnownRawValue: null,
		createdAt: e,
		updatedAt: e
	};
}
//#endregion
//#region ../../packages/platform-node/src/real-socket.ts
function le(e) {
	return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
}
var ue = class {
	socket = new s();
	host;
	port;
	opened = !1;
	dataListeners = /* @__PURE__ */ new Set();
	errorListeners = /* @__PURE__ */ new Set();
	closeListeners = /* @__PURE__ */ new Set();
	constructor(e) {
		this.host = e.host, this.port = e.port, this.socket.on("data", (e) => {
			let t = le(e);
			for (let e of this.dataListeners) e(t);
		}), this.socket.on("error", (e) => {
			for (let t of this.errorListeners) t(e);
		}), this.socket.on("close", () => {
			this.opened = !1;
			for (let e of this.closeListeners) e();
		});
	}
	get isOpen() {
		return this.opened;
	}
	open() {
		return new Promise((e, t) => {
			if (this.opened) {
				e();
				return;
			}
			let n = () => {
				a(), this.opened = !0, e();
			}, r = (e) => {
				a(), t(e);
			}, i = () => {
				a(), t(/* @__PURE__ */ Error(`tcp connection closed before connect (${this.host}:${this.port})`));
			}, a = () => {
				this.socket.off("connect", n), this.socket.off("error", r), this.socket.off("close", i);
			};
			this.socket.once("connect", n), this.socket.once("error", r), this.socket.once("close", i), this.socket.connect({
				host: this.host,
				port: this.port
			});
		});
	}
	close() {
		return new Promise((e) => {
			if (this.socket.readyState === "closed") {
				e();
				return;
			}
			this.socket.once("close", () => e()), this.socket.destroy();
		});
	}
	write(e) {
		return new Promise((t, n) => {
			this.socket.write(e, (e) => e ? n(e) : t());
		});
	}
	onData(e) {
		return this.dataListeners.add(e), () => this.dataListeners.delete(e);
	}
	onError(e) {
		return this.errorListeners.add(e), () => this.errorListeners.delete(e);
	}
	onClose(e) {
		return this.closeListeners.add(e), () => this.closeListeners.delete(e);
	}
}, de = class {
	connect(e) {
		return new ue(e);
	}
};
//#endregion
//#region ../../packages/platform-node/src/error-mapping.ts
function fe(e) {
	return typeof e == "string" ? e : "";
}
function pe(e, t) {
	let n = fe(e?.code), r = e instanceof Error ? e.message : String(e), i = r.toLowerCase();
	return n === "EADDRINUSE" ? l({
		code: "TCP_PORT_IN_USE",
		category: "permission",
		retryable: !1,
		userMessageKey: "errors.tcpPortInUse",
		technicalMessage: `tcp port already in use: ${r}`,
		cause: e
	}) : n === "ECONNREFUSED" || n === "EHOSTUNREACH" || n === "ENETUNREACH" || n === "ENOTFOUND" || n === "EAI_AGAIN" || n === "ETIMEDOUT" || n === "ECONNRESET" || n === "EPIPE" ? l({
		code: "TCP_CONNECTION_FAILED",
		category: "connection",
		retryable: !0,
		userMessageKey: "errors.tcpConnectionFailed",
		technicalMessage: `tcp connection failed: ${r}`,
		cause: e
	}) : i.includes("address already in use") || i.includes("port already in use") ? l({
		code: "TCP_PORT_IN_USE",
		category: "permission",
		retryable: !1,
		userMessageKey: "errors.tcpPortInUse",
		technicalMessage: r,
		cause: e
	}) : i.includes("connection refused") || i.includes("no such host") || i.includes("host unreachable") || i.includes("network is unreachable") || i.includes("getaddrinfo") ? l({
		code: "TCP_CONNECTION_FAILED",
		category: "connection",
		retryable: !0,
		userMessageKey: "errors.tcpConnectionFailed",
		technicalMessage: r,
		cause: e
	}) : l(t === "open" ? {
		code: "TCP_OPEN_FAILED",
		category: "transport",
		retryable: !0,
		userMessageKey: "errors.tcpOpenFailed",
		technicalMessage: r,
		cause: e
	} : {
		code: "TCP_CONNECTION_FAILED",
		category: "connection",
		retryable: !0,
		userMessageKey: "errors.tcpConnectionFailed",
		technicalMessage: r,
		cause: e
	});
}
function me(e) {
	return pe(e, "io");
}
function he(e) {
	return pe(e, "open");
}
//#endregion
//#region ../../packages/platform-node/src/node-tcp-transport.ts
var ge = class {
	kind = "node-tcp";
	openFlag = !1;
	closeEmitted = !1;
	socket;
	dataListeners = /* @__PURE__ */ new Set();
	errorListeners = /* @__PURE__ */ new Set();
	closeListeners = /* @__PURE__ */ new Set();
	constructor(e) {
		this.socket = e, e.onData((e) => {
			if (this.openFlag && e.length !== 0) for (let t of this.dataListeners) t(e);
		}), e.onError((e) => {
			if (!this.openFlag) return;
			let t = me(e);
			for (let e of this.errorListeners) e(t);
		}), e.onClose(() => this.emitClose());
	}
	onData(e) {
		return this.dataListeners.add(e), () => this.dataListeners.delete(e);
	}
	onError(e) {
		return this.errorListeners.add(e), () => this.errorListeners.delete(e);
	}
	onClose(e) {
		return this.closeListeners.add(e), () => this.closeListeners.delete(e);
	}
	async open() {
		if (this.openFlag) return d(l({
			code: "TCP_OPEN_FAILED",
			category: "transport",
			retryable: !1,
			userMessageKey: "errors.tcpOpenFailed",
			technicalMessage: "tcp connection is already open"
		}));
		try {
			return await this.socket.open(), this.openFlag = !0, this.closeEmitted = !1, u(void 0);
		} catch (e) {
			return d(he(e));
		}
	}
	async close() {
		this.openFlag = !1;
		try {
			await this.socket.close();
		} catch (e) {
			let t = me(e);
			return this.emitClose(), d(t);
		}
		return this.emitClose(), u(void 0);
	}
	async write(e) {
		if (!this.openFlag) return d(l({
			code: "TRANSPORT_NOT_OPEN",
			category: "transport",
			userMessageKey: "errors.transportNotOpen",
			technicalMessage: "tcp connection is not open"
		}));
		try {
			return await this.socket.write(e), u(void 0);
		} catch (e) {
			return d(me(e));
		}
	}
	isOpen() {
		return this.openFlag;
	}
	emitClose() {
		if (!this.closeEmitted) {
			this.closeEmitted = !0, this.openFlag = !1;
			for (let e of this.closeListeners) e();
		}
	}
}, _e = {
	now: () => Date.now(),
	schedule: (e, t) => {
		let n = setTimeout(e, t);
		return { cancel: () => clearTimeout(n) };
	}
}, ve = Object.freeze({
	modbusRtu: !1,
	modbusTcp: !0,
	serialPorts: "unsupported",
	filesystem: "unsupported",
	nodePlugins: !1,
	webPlugins: !1
}), ye = class {
	clock;
	capabilities;
	netFactory;
	constructor(e = {}) {
		this.netFactory = e.netFactory ?? new de(), this.clock = e.clock ?? _e, this.capabilities = e.capabilities ?? ve;
	}
	async openTcpTransport(e) {
		let t = ie(e);
		return t.ok ? u(new ge(this.netFactory.connect({
			host: e.host,
			port: e.port
		}))) : d(t.error);
	}
}, be;
function m(e, t, n) {
	function r(n, r) {
		if (n._zod || Object.defineProperty(n, "_zod", {
			value: {
				def: r,
				constr: o,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: !1
		}), n._zod.traits.has(e)) return;
		n._zod.traits.add(e), t(n, r);
		let i = o.prototype, a = Object.keys(i);
		for (let e = 0; e < a.length; e++) {
			let t = a[e];
			t in n || (n[t] = i[t].bind(n));
		}
	}
	let i = n?.Parent ?? Object;
	class a extends i {}
	Object.defineProperty(a, "name", { value: e });
	function o(e) {
		var t;
		let i = n?.Parent ? new a() : this;
		r(i, e), (t = i._zod).deferred ?? (t.deferred = []);
		for (let e of i._zod.deferred) e();
		return i;
	}
	return Object.defineProperty(o, "init", { value: r }), Object.defineProperty(o, Symbol.hasInstance, { value: (t) => n?.Parent && t instanceof n.Parent ? !0 : t?._zod?.traits?.has(e) }), Object.defineProperty(o, "name", { value: e }), o;
}
var h = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, xe = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(be = globalThis).__zod_globalConfig ?? (be.__zod_globalConfig = {});
var Se = globalThis.__zod_globalConfig;
function g(e) {
	return e && Object.assign(Se, e), Se;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function Ce(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function we(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
function Te(e) {
	return { get value() {
		{
			let t = e();
			return Object.defineProperty(this, "value", { value: t }), t;
		}
	} };
}
function Ee(e) {
	return e == null;
}
function De(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
function Oe(e, t) {
	let n = e / t, r = Math.round(n), i = 2 ** -52 * Math.max(Math.abs(n), 1);
	return Math.abs(n - r) < i ? 0 : n - r;
}
var ke = /* @__PURE__*/ Symbol("evaluating");
function _(e, t, n) {
	let r;
	Object.defineProperty(e, t, {
		get() {
			if (r !== ke) return r === void 0 && (r = ke, r = n()), r;
		},
		set(n) {
			Object.defineProperty(e, t, { value: n });
		},
		configurable: !0
	});
}
function v(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function y(...e) {
	let t = {};
	for (let n of e) {
		let e = Object.getOwnPropertyDescriptors(n);
		Object.assign(t, e);
	}
	return Object.defineProperties({}, t);
}
function Ae(e) {
	return JSON.stringify(e);
}
function je(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var Me = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function Ne(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var Pe = /* @__PURE__*/ Te(() => {
	if (Se.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function b(e) {
	if (Ne(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return Ne(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
function Fe(e) {
	return b(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var Ie = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function x(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function S(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function C(e) {
	let t = e;
	if (!t) return {};
	if (typeof t == "string") return { error: () => t };
	if (t?.message !== void 0) {
		if (t?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
		t.error = t.message;
	}
	return delete t.message, typeof t.error == "string" ? {
		...t,
		error: () => t.error
	} : t;
}
function Le(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
var Re = {
	safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function ze(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	return S(e, y(e._zod.def, {
		get shape() {
			let e = {};
			for (let r in t) {
				if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`);
				t[r] && (e[r] = n.shape[r]);
			}
			return v(this, "shape", e), e;
		},
		checks: []
	}));
}
function Be(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	return S(e, y(e._zod.def, {
		get shape() {
			let r = { ...e._zod.def.shape };
			for (let e in t) {
				if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`);
				t[e] && delete r[e];
			}
			return v(this, "shape", r), r;
		},
		checks: []
	}));
}
function Ve(e, t) {
	if (!b(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = e._zod.def.shape;
		for (let e in t) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return S(e, y(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return v(this, "shape", n), n;
	} }));
}
function He(e, t) {
	if (!b(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return S(e, y(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return v(this, "shape", n), n;
	} }));
}
function Ue(e, t) {
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return S(e, y(e._zod.def, {
		get shape() {
			let n = {
				...e._zod.def.shape,
				...t._zod.def.shape
			};
			return v(this, "shape", n), n;
		},
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function We(e, t, n) {
	let r = t._zod.def.checks;
	if (r && r.length > 0) throw Error(".partial() cannot be used on object schemas containing refinements");
	return S(t, y(t._zod.def, {
		get shape() {
			let r = t._zod.def.shape, i = { ...r };
			if (n) for (let t in n) {
				if (!(t in r)) throw Error(`Unrecognized key: "${t}"`);
				n[t] && (i[t] = e ? new e({
					type: "optional",
					innerType: r[t]
				}) : r[t]);
			}
			else for (let t in r) i[t] = e ? new e({
				type: "optional",
				innerType: r[t]
			}) : r[t];
			return v(this, "shape", i), i;
		},
		checks: []
	}));
}
function Ge(e, t, n) {
	return S(t, y(t._zod.def, { get shape() {
		let r = t._zod.def.shape, i = { ...r };
		if (n) for (let t in n) {
			if (!(t in i)) throw Error(`Unrecognized key: "${t}"`);
			n[t] && (i[t] = new e({
				type: "nonoptional",
				innerType: r[t]
			}));
		}
		else for (let t in r) i[t] = new e({
			type: "nonoptional",
			innerType: r[t]
		});
		return v(this, "shape", i), i;
	} }));
}
function w(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function Ke(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function T(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function qe(e) {
	return typeof e == "string" ? e : e?.message;
}
function E(e, t, n) {
	let r = e.message ? e.message : qe(e.inst?._zod.def?.error?.(e)) ?? qe(t?.error?.(e)) ?? qe(n.customError?.(e)) ?? qe(n.localeError?.(e)) ?? "Invalid input", { inst: i, continue: a, input: o, ...s } = e;
	return s.path ??= [], s.message = r, t?.reportInput && (s.input = o), s;
}
function Je(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function Ye(...e) {
	let [t, n, r] = e;
	return typeof t == "string" ? {
		message: t,
		code: "custom",
		input: n,
		inst: r
	} : { ...t };
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
var Xe = (e, t) => {
	e.name = "$ZodError", Object.defineProperty(e, "_zod", {
		value: e._zod,
		enumerable: !1
	}), Object.defineProperty(e, "issues", {
		value: t,
		enumerable: !1
	}), e.message = JSON.stringify(t, we, 2), Object.defineProperty(e, "toString", {
		value: () => e.message,
		enumerable: !1
	});
}, Ze = m("$ZodError", Xe), Qe = m("$ZodError", Xe, { Parent: Error });
function $e(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? (n[i.path[0]] = n[i.path[0]] || [], n[i.path[0]].push(t(i))) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function et(e, t = (e) => e.message) {
	let n = { _errors: [] }, r = (e, i = []) => {
		for (let a of e.issues) if (a.code === "invalid_union" && a.errors.length) a.errors.map((e) => r({ issues: e }, [...i, ...a.path]));
		else if (a.code === "invalid_key") r({ issues: a.issues }, [...i, ...a.path]);
		else if (a.code === "invalid_element") r({ issues: a.issues }, [...i, ...a.path]);
		else {
			let e = [...i, ...a.path];
			if (e.length === 0) n._errors.push(t(a));
			else {
				let r = n, i = 0;
				for (; i < e.length;) {
					let n = e[i];
					i === e.length - 1 ? (r[n] = r[n] || { _errors: [] }, r[n]._errors.push(t(a))) : r[n] = r[n] || { _errors: [] }, r = r[n], i++;
				}
			}
		}
	};
	return r(e), n;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
var tt = (e) => (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !1
	} : { async: !1 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise) throw new h();
	if (o.issues.length) {
		let t = new ((i?.Err) ?? e)(o.issues.map((e) => E(e, a, g())));
		throw Me(t, i?.callee), t;
	}
	return o.value;
}, nt = (e) => async (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !0
	} : { async: !0 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise && (o = await o), o.issues.length) {
		let t = new ((i?.Err) ?? e)(o.issues.map((e) => E(e, a, g())));
		throw Me(t, i?.callee), t;
	}
	return o.value;
}, rt = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new h();
	return a.issues.length ? {
		success: !1,
		error: new (e ?? Ze)(a.issues.map((e) => E(e, i, g())))
	} : {
		success: !0,
		data: a.value
	};
}, it = /* @__PURE__*/ rt(Qe), at = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? {
		success: !1,
		error: new e(a.issues.map((e) => E(e, i, g())))
	} : {
		success: !0,
		data: a.value
	};
}, ot = /* @__PURE__*/ at(Qe), st = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return tt(e)(t, n, i);
}, ct = (e) => (t, n, r) => tt(e)(t, n, r), lt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return nt(e)(t, n, i);
}, ut = (e) => async (t, n, r) => nt(e)(t, n, r), dt = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return rt(e)(t, n, i);
}, ft = (e) => (t, n, r) => rt(e)(t, n, r), pt = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return at(e)(t, n, i);
}, mt = (e) => async (t, n, r) => at(e)(t, n, r), ht = /^[cC][0-9a-z]{6,}$/, gt = /^[0-9a-z]+$/, _t = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, vt = /^[0-9a-vA-V]{20}$/, yt = /^[A-Za-z0-9]{27}$/, bt = /^[a-zA-Z0-9_-]{21}$/, xt = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, St = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, Ct = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, wt = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, Tt = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function Et() {
	return new RegExp(Tt, "u");
}
var Dt = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, Ot = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, kt = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, At = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, jt = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, Mt = /^[A-Za-z0-9_-]*$/, Nt = /^https?$/, Pt = /^\+[1-9]\d{6,14}$/, Ft = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", It = /*@__PURE__*/ RegExp(`^${Ft}$`);
function Lt(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function Rt(e) {
	return RegExp(`^${Lt(e)}$`);
}
function zt(e) {
	let t = Lt({ precision: e.precision }), n = ["Z"];
	e.local && n.push(""), e.offset && n.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let r = `${t}(?:${n.join("|")})`;
	return RegExp(`^${Ft}T(?:${r})$`);
}
var Bt = (e) => {
	let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
	return RegExp(`^${t}$`);
}, Vt = /^-?\d+$/, Ht = /^-?\d+(?:\.\d+)?$/, Ut = /^(?:true|false)$/i, Wt = /^[^A-Z]*$/, Gt = /^[^a-z]*$/, D = /*@__PURE__*/ m("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), Kt = {
	number: "number",
	bigint: "bigint",
	object: "date"
}, qt = /*@__PURE__*/ m("$ZodCheckLessThan", (e, t) => {
	D.init(e, t);
	let n = Kt[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.maximum : n.exclusiveMaximum) ?? Infinity;
		t.value < r && (t.inclusive ? n.maximum = t.value : n.exclusiveMaximum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value <= t.value : r.value < t.value) || r.issues.push({
			origin: n,
			code: "too_big",
			maximum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), Jt = /*@__PURE__*/ m("$ZodCheckGreaterThan", (e, t) => {
	D.init(e, t);
	let n = Kt[typeof t.value];
	e._zod.onattach.push((e) => {
		let n = e._zod.bag, r = (t.inclusive ? n.minimum : n.exclusiveMinimum) ?? -Infinity;
		t.value > r && (t.inclusive ? n.minimum = t.value : n.exclusiveMinimum = t.value);
	}), e._zod.check = (r) => {
		(t.inclusive ? r.value >= t.value : r.value > t.value) || r.issues.push({
			origin: n,
			code: "too_small",
			minimum: typeof t.value == "object" ? t.value.getTime() : t.value,
			input: r.value,
			inclusive: t.inclusive,
			inst: e,
			continue: !t.abort
		});
	};
}), Yt = /*@__PURE__*/ m("$ZodCheckMultipleOf", (e, t) => {
	D.init(e, t), e._zod.onattach.push((e) => {
		var n;
		(n = e._zod.bag).multipleOf ?? (n.multipleOf = t.value);
	}), e._zod.check = (n) => {
		if (typeof n.value != typeof t.value) throw Error("Cannot mix number and bigint in multiple_of check.");
		(typeof n.value == "bigint" ? n.value % t.value === BigInt(0) : Oe(n.value, t.value) === 0) || n.issues.push({
			origin: typeof n.value,
			code: "not_multiple_of",
			divisor: t.value,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Xt = /*@__PURE__*/ m("$ZodCheckNumberFormat", (e, t) => {
	D.init(e, t), t.format = t.format || "float64";
	let n = t.format?.includes("int"), r = n ? "int" : "number", [i, a] = Re[t.format];
	e._zod.onattach.push((e) => {
		let r = e._zod.bag;
		r.format = t.format, r.minimum = i, r.maximum = a, n && (r.pattern = Vt);
	}), e._zod.check = (o) => {
		let s = o.value;
		if (n) {
			if (!Number.isInteger(s)) {
				o.issues.push({
					expected: r,
					format: t.format,
					code: "invalid_type",
					continue: !1,
					input: s,
					inst: e
				});
				return;
			}
			if (!Number.isSafeInteger(s)) {
				s > 0 ? o.issues.push({
					input: s,
					code: "too_big",
					maximum: 2 ** 53 - 1,
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				}) : o.issues.push({
					input: s,
					code: "too_small",
					minimum: -(2 ** 53 - 1),
					note: "Integers must be within the safe integer range.",
					inst: e,
					origin: r,
					inclusive: !0,
					continue: !t.abort
				});
				return;
			}
		}
		s < i && o.issues.push({
			origin: "number",
			input: s,
			code: "too_small",
			minimum: i,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		}), s > a && o.issues.push({
			origin: "number",
			input: s,
			code: "too_big",
			maximum: a,
			inclusive: !0,
			inst: e,
			continue: !t.abort
		});
	};
}), Zt = /*@__PURE__*/ m("$ZodCheckMaxLength", (e, t) => {
	var n;
	D.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !Ee(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.maximum ?? Infinity;
		t.maximum < n && (e._zod.bag.maximum = t.maximum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length <= t.maximum) return;
		let i = Je(r);
		n.issues.push({
			origin: i,
			code: "too_big",
			maximum: t.maximum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), Qt = /*@__PURE__*/ m("$ZodCheckMinLength", (e, t) => {
	var n;
	D.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !Ee(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.minimum ?? -Infinity;
		t.minimum > n && (e._zod.bag.minimum = t.minimum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length >= t.minimum) return;
		let i = Je(r);
		n.issues.push({
			origin: i,
			code: "too_small",
			minimum: t.minimum,
			inclusive: !0,
			input: r,
			inst: e,
			continue: !t.abort
		});
	};
}), $t = /*@__PURE__*/ m("$ZodCheckLengthEquals", (e, t) => {
	var n;
	D.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !Ee(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.minimum = t.length, n.maximum = t.length, n.length = t.length;
	}), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if (i === t.length) return;
		let a = Je(r), o = i > t.length;
		n.issues.push({
			origin: a,
			...o ? {
				code: "too_big",
				maximum: t.length
			} : {
				code: "too_small",
				minimum: t.length
			},
			inclusive: !0,
			exact: !0,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), en = /*@__PURE__*/ m("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	D.init(e, t), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.format = t.format, t.pattern && (n.patterns ??= /* @__PURE__ */ new Set(), n.patterns.add(t.pattern));
	}), t.pattern ? (n = e._zod).check ?? (n.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: t.format,
			input: n.value,
			...t.pattern ? { pattern: t.pattern.toString() } : {},
			inst: e,
			continue: !t.abort
		});
	}) : (r = e._zod).check ?? (r.check = () => {});
}), tn = /*@__PURE__*/ m("$ZodCheckRegex", (e, t) => {
	en.init(e, t), e._zod.check = (n) => {
		t.pattern.lastIndex = 0, !t.pattern.test(n.value) && n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: n.value,
			pattern: t.pattern.toString(),
			inst: e,
			continue: !t.abort
		});
	};
}), nn = /*@__PURE__*/ m("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= Wt, en.init(e, t);
}), rn = /*@__PURE__*/ m("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= Gt, en.init(e, t);
}), an = /*@__PURE__*/ m("$ZodCheckIncludes", (e, t) => {
	D.init(e, t);
	let n = x(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
	t.pattern = r, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(r);
	}), e._zod.check = (n) => {
		n.value.includes(t.includes, t.position) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: t.includes,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), on = /*@__PURE__*/ m("$ZodCheckStartsWith", (e, t) => {
	D.init(e, t);
	let n = RegExp(`^${x(t.prefix)}.*`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.startsWith(t.prefix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: t.prefix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), sn = /*@__PURE__*/ m("$ZodCheckEndsWith", (e, t) => {
	D.init(e, t);
	let n = RegExp(`.*${x(t.suffix)}$`);
	t.pattern ??= n, e._zod.onattach.push((e) => {
		let t = e._zod.bag;
		t.patterns ??= /* @__PURE__ */ new Set(), t.patterns.add(n);
	}), e._zod.check = (n) => {
		n.value.endsWith(t.suffix) || n.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: t.suffix,
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), cn = /*@__PURE__*/ m("$ZodCheckOverwrite", (e, t) => {
	D.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), ln = class {
	constructor(e = []) {
		this.content = [], this.indent = 0, this && (this.args = e);
	}
	indented(e) {
		this.indent += 1, e(this), --this.indent;
	}
	write(e) {
		if (typeof e == "function") {
			e(this, { execution: "sync" }), e(this, { execution: "async" });
			return;
		}
		let t = e.split("\n").filter((e) => e), n = Math.min(...t.map((e) => e.length - e.trimStart().length)), r = t.map((e) => e.slice(n)).map((e) => " ".repeat(this.indent * 2) + e);
		for (let e of r) this.content.push(e);
	}
	compile() {
		let e = Function, t = this?.args, n = [...(this?.content ?? [""]).map((e) => `  ${e}`)];
		return new e(...t, n.join("\n"));
	}
}, un = {
	major: 4,
	minor: 4,
	patch: 3
}, O = /*@__PURE__*/ m("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = un;
	let r = [...e._zod.def.checks ?? []];
	e._zod.traits.has("$ZodCheck") && r.unshift(e);
	for (let t of r) for (let n of t._zod.onattach) n(e);
	if (r.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (e, t, n) => {
			let r = w(e), i;
			for (let a of t) {
				if (a._zod.def.when) {
					if (Ke(e) || !a._zod.def.when(e)) continue;
				} else if (r) continue;
				let t = e.issues.length, o = a._zod.check(e);
				if (o instanceof Promise && n?.async === !1) throw new h();
				if (i || o instanceof Promise) i = (i ?? Promise.resolve()).then(async () => {
					await o, e.issues.length !== t && (r ||= w(e, t));
				});
				else {
					if (e.issues.length === t) continue;
					r ||= w(e, t);
				}
			}
			return i ? i.then(() => e) : e;
		}, n = (n, i, a) => {
			if (w(n)) return n.aborted = !0, n;
			let o = t(i, r, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new h();
				return o.then((t) => e._zod.parse(t, a));
			}
			return e._zod.parse(o, a);
		};
		e._zod.run = (i, a) => {
			if (a.skipChecks) return e._zod.parse(i, a);
			if (a.direction === "backward") {
				let t = e._zod.parse({
					value: i.value,
					issues: []
				}, {
					...a,
					skipChecks: !0
				});
				return t instanceof Promise ? t.then((e) => n(e, i, a)) : n(t, i, a);
			}
			let o = e._zod.parse(i, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new h();
				return o.then((e) => t(e, r, a));
			}
			return t(o, r, a);
		};
	}
	_(e, "~standard", () => ({
		validate: (t) => {
			try {
				let n = it(e, t);
				return n.success ? { value: n.data } : { issues: n.error?.issues };
			} catch {
				return ot(e, t).then((e) => e.success ? { value: e.data } : { issues: e.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
}), dn = /*@__PURE__*/ m("$ZodString", (e, t) => {
	O.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? Bt(e._zod.bag), e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = String(n.value);
		} catch {}
		return typeof n.value == "string" || n.issues.push({
			expected: "string",
			code: "invalid_type",
			input: n.value,
			inst: e
		}), n;
	};
}), k = /*@__PURE__*/ m("$ZodStringFormat", (e, t) => {
	en.init(e, t), dn.init(e, t);
}), fn = /*@__PURE__*/ m("$ZodGUID", (e, t) => {
	t.pattern ??= St, k.init(e, t);
}), pn = /*@__PURE__*/ m("$ZodUUID", (e, t) => {
	if (t.version) {
		let e = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[t.version];
		if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
		t.pattern ??= Ct(e);
	} else t.pattern ??= Ct();
	k.init(e, t);
}), mn = /*@__PURE__*/ m("$ZodEmail", (e, t) => {
	t.pattern ??= wt, k.init(e, t);
}), hn = /*@__PURE__*/ m("$ZodURL", (e, t) => {
	k.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim();
			if (!t.normalize && t.protocol?.source === Nt.source && !/^https?:\/\//i.test(r)) {
				n.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid URL format",
					input: n.value,
					inst: e,
					continue: !t.abort
				});
				return;
			}
			let i = new URL(r);
			t.hostname && (t.hostname.lastIndex = 0, t.hostname.test(i.hostname) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid hostname",
				pattern: t.hostname.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), t.protocol && (t.protocol.lastIndex = 0, t.protocol.test(i.protocol.endsWith(":") ? i.protocol.slice(0, -1) : i.protocol) || n.issues.push({
				code: "invalid_format",
				format: "url",
				note: "Invalid protocol",
				pattern: t.protocol.source,
				input: n.value,
				inst: e,
				continue: !t.abort
			})), n.value = t.normalize ? i.href : r;
			return;
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "url",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), gn = /*@__PURE__*/ m("$ZodEmoji", (e, t) => {
	t.pattern ??= Et(), k.init(e, t);
}), _n = /*@__PURE__*/ m("$ZodNanoID", (e, t) => {
	t.pattern ??= bt, k.init(e, t);
}), vn = /*@__PURE__*/ m("$ZodCUID", (e, t) => {
	t.pattern ??= ht, k.init(e, t);
}), yn = /*@__PURE__*/ m("$ZodCUID2", (e, t) => {
	t.pattern ??= gt, k.init(e, t);
}), bn = /*@__PURE__*/ m("$ZodULID", (e, t) => {
	t.pattern ??= _t, k.init(e, t);
}), xn = /*@__PURE__*/ m("$ZodXID", (e, t) => {
	t.pattern ??= vt, k.init(e, t);
}), Sn = /*@__PURE__*/ m("$ZodKSUID", (e, t) => {
	t.pattern ??= yt, k.init(e, t);
}), Cn = /*@__PURE__*/ m("$ZodISODateTime", (e, t) => {
	t.pattern ??= zt(t), k.init(e, t);
}), wn = /*@__PURE__*/ m("$ZodISODate", (e, t) => {
	t.pattern ??= It, k.init(e, t);
}), Tn = /*@__PURE__*/ m("$ZodISOTime", (e, t) => {
	t.pattern ??= Rt(t), k.init(e, t);
}), En = /*@__PURE__*/ m("$ZodISODuration", (e, t) => {
	t.pattern ??= xt, k.init(e, t);
}), Dn = /*@__PURE__*/ m("$ZodIPv4", (e, t) => {
	t.pattern ??= Dt, k.init(e, t), e._zod.bag.format = "ipv4";
}), On = /*@__PURE__*/ m("$ZodIPv6", (e, t) => {
	t.pattern ??= Ot, k.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n) => {
		try {
			new URL(`http://[${n.value}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
}), kn = /*@__PURE__*/ m("$ZodCIDRv4", (e, t) => {
	t.pattern ??= kt, k.init(e, t);
}), An = /*@__PURE__*/ m("$ZodCIDRv6", (e, t) => {
	t.pattern ??= At, k.init(e, t), e._zod.check = (n) => {
		let r = n.value.split("/");
		try {
			if (r.length !== 2) throw Error();
			let [e, t] = r;
			if (!t) throw Error();
			let n = Number(t);
			if (`${n}` !== t || n < 0 || n > 128) throw Error();
			new URL(`http://[${e}]`);
		} catch {
			n.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: n.value,
				inst: e,
				continue: !t.abort
			});
		}
	};
});
function jn(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var Mn = /*@__PURE__*/ m("$ZodBase64", (e, t) => {
	t.pattern ??= jt, k.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n) => {
		jn(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function Nn(e) {
	if (!Mt.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return jn(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var Pn = /*@__PURE__*/ m("$ZodBase64URL", (e, t) => {
	t.pattern ??= Mt, k.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n) => {
		Nn(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Fn = /*@__PURE__*/ m("$ZodE164", (e, t) => {
	t.pattern ??= Pt, k.init(e, t);
});
function In(e, t = null) {
	try {
		let n = e.split(".");
		if (n.length !== 3) return !1;
		let [r] = n;
		if (!r) return !1;
		let i = JSON.parse(atob(r));
		return !("typ" in i && i?.typ !== "JWT" || !i.alg || t && (!("alg" in i) || i.alg !== t));
	} catch {
		return !1;
	}
}
var Ln = /*@__PURE__*/ m("$ZodJWT", (e, t) => {
	k.init(e, t), e._zod.check = (n) => {
		In(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Rn = /*@__PURE__*/ m("$ZodNumber", (e, t) => {
	O.init(e, t), e._zod.pattern = e._zod.bag.pattern ?? Ht, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = Number(n.value);
		} catch {}
		let i = n.value;
		if (typeof i == "number" && !Number.isNaN(i) && Number.isFinite(i)) return n;
		let a = typeof i == "number" ? Number.isNaN(i) ? "NaN" : Number.isFinite(i) ? void 0 : "Infinity" : void 0;
		return n.issues.push({
			expected: "number",
			code: "invalid_type",
			input: i,
			inst: e,
			...a ? { received: a } : {}
		}), n;
	};
}), zn = /*@__PURE__*/ m("$ZodNumberFormat", (e, t) => {
	Xt.init(e, t), Rn.init(e, t);
}), Bn = /*@__PURE__*/ m("$ZodBoolean", (e, t) => {
	O.init(e, t), e._zod.pattern = Ut, e._zod.parse = (n, r) => {
		if (t.coerce) try {
			n.value = !!n.value;
		} catch {}
		let i = n.value;
		return typeof i == "boolean" || n.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
	};
}), Vn = /*@__PURE__*/ m("$ZodUnknown", (e, t) => {
	O.init(e, t), e._zod.parse = (e) => e;
}), Hn = /*@__PURE__*/ m("$ZodNever", (e, t) => {
	O.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function Un(e, t, n) {
	e.issues.length && t.issues.push(...T(n, e.issues)), t.value[n] = e.value;
}
var Wn = /*@__PURE__*/ m("$ZodArray", (e, t) => {
	O.init(e, t), e._zod.parse = (n, r) => {
		let i = n.value;
		if (!Array.isArray(i)) return n.issues.push({
			expected: "array",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
		n.value = Array(i.length);
		let a = [];
		for (let e = 0; e < i.length; e++) {
			let o = i[e], s = t.element._zod.run({
				value: o,
				issues: []
			}, r);
			s instanceof Promise ? a.push(s.then((t) => Un(t, n, e))) : Un(s, n, e);
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
});
function Gn(e, t, n, r, i, a) {
	let o = n in r;
	if (e.issues.length) {
		if (i && a && !o) return;
		t.issues.push(...T(n, e.issues));
	}
	if (!o && !i) {
		e.issues.length || t.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [n]
		});
		return;
	}
	e.value === void 0 ? o && (t.value[n] = void 0) : t.value[n] = e.value;
}
function Kn(e) {
	let t = Object.keys(e.shape);
	for (let n of t) if (!e.shape?.[n]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${n}": expected a Zod schema`);
	let n = Le(e.shape);
	return {
		...e,
		keys: t,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(n)
	};
}
function qn(e, t, n, r, i, a) {
	let o = [], s = i.keySet, c = i.catchall._zod, l = c.def.type, u = c.optin === "optional", d = c.optout === "optional";
	for (let i in t) {
		if (i === "__proto__" || s.has(i)) continue;
		if (l === "never") {
			o.push(i);
			continue;
		}
		let a = c.run({
			value: t[i],
			issues: []
		}, r);
		a instanceof Promise ? e.push(a.then((e) => Gn(e, n, i, t, u, d))) : Gn(a, n, i, t, u, d);
	}
	return o.length && n.issues.push({
		code: "unrecognized_keys",
		keys: o,
		input: t,
		inst: a
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var Jn = /*@__PURE__*/ m("$ZodObject", (e, t) => {
	if (O.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
		let e = t.shape;
		Object.defineProperty(t, "shape", { get: () => {
			let n = { ...e };
			return Object.defineProperty(t, "shape", { value: n }), n;
		} });
	}
	let n = Te(() => Kn(t));
	_(e._zod, "propValues", () => {
		let e = t.shape, n = {};
		for (let t in e) {
			let r = e[t]._zod;
			if (r.values) {
				n[t] ?? (n[t] = /* @__PURE__ */ new Set());
				for (let e of r.values) n[t].add(e);
			}
		}
		return n;
	});
	let r = Ne, i = t.catchall, a;
	e._zod.parse = (t, o) => {
		a ??= n.value;
		let s = t.value;
		if (!r(s)) return t.issues.push({
			expected: "object",
			code: "invalid_type",
			input: s,
			inst: e
		}), t;
		t.value = {};
		let c = [], l = a.shape;
		for (let e of a.keys) {
			let n = l[e], r = n._zod.optin === "optional", i = n._zod.optout === "optional", a = n._zod.run({
				value: s[e],
				issues: []
			}, o);
			a instanceof Promise ? c.push(a.then((n) => Gn(n, t, e, s, r, i))) : Gn(a, t, e, s, r, i);
		}
		return i ? qn(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t;
	};
}), Yn = /*@__PURE__*/ m("$ZodObjectJIT", (e, t) => {
	Jn.init(e, t);
	let n = e._zod.parse, r = Te(() => Kn(t)), i = (e) => {
		let t = new ln([
			"shape",
			"payload",
			"ctx"
		]), n = r.value, i = (e) => {
			let t = Ae(e);
			return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`;
		};
		t.write("const input = payload.value;");
		let a = Object.create(null), o = 0;
		for (let e of n.keys) a[e] = `key_${o++}`;
		t.write("const newResult = {};");
		for (let r of n.keys) {
			let n = a[r], o = Ae(r), s = e[r], c = s?._zod?.optin === "optional", l = s?._zod?.optout === "optional";
			t.write(`const ${n} = ${i(r)};`), c && l ? t.write(`
        if (${n}.issues.length) {
          if (${o} in input) {
            payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${o}, ...iss.path] : [${o}]
            })));
          }
        }
        
        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }
        
      `) : c ? t.write(`
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }
        
        if (${n}.value === undefined) {
          if (${o} in input) {
            newResult[${o}] = undefined;
          }
        } else {
          newResult[${o}] = ${n}.value;
        }
        
      `) : t.write(`
        const ${n}_present = ${o} in input;
        if (${n}.issues.length) {
          payload.issues = payload.issues.concat(${n}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${o}, ...iss.path] : [${o}]
          })));
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${o}]
          });
        }

        if (${n}_present) {
          if (${n}.value === undefined) {
            newResult[${o}] = undefined;
          } else {
            newResult[${o}] = ${n}.value;
          }
        }

      `);
		}
		t.write("payload.value = newResult;"), t.write("return payload;");
		let s = t.compile();
		return (t, n) => s(e, t, n);
	}, a, o = Ne, s = !Se.jitless, c = s && Pe.value, l = t.catchall, u;
	e._zod.parse = (d, f) => {
		u ??= r.value;
		let p = d.value;
		return o(p) ? s && c && f?.async === !1 && f.jitless !== !0 ? (a ||= i(t.shape), d = a(d, f), l ? qn([], p, d, f, u, e) : d) : n(d, f) : (d.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), d);
	};
});
function Xn(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !w(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => E(e, r, g())))
	}), t);
}
var Zn = /*@__PURE__*/ m("$ZodUnion", (e, t) => {
	O.init(e, t), _(e._zod, "optin", () => t.options.some((e) => e._zod.optin === "optional") ? "optional" : void 0), _(e._zod, "optout", () => t.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), _(e._zod, "values", () => {
		if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)));
	}), _(e._zod, "pattern", () => {
		if (t.options.every((e) => e._zod.pattern)) {
			let e = t.options.map((e) => e._zod.pattern);
			return RegExp(`^(${e.map((e) => De(e.source)).join("|")})$`);
		}
	});
	let n = t.options.length === 1 ? t.options[0]._zod.run : null;
	e._zod.parse = (r, i) => {
		if (n) return n(r, i);
		let a = !1, o = [];
		for (let e of t.options) {
			let t = e._zod.run({
				value: r.value,
				issues: []
			}, i);
			if (t instanceof Promise) o.push(t), a = !0;
			else {
				if (t.issues.length === 0) return t;
				o.push(t);
			}
		}
		return a ? Promise.all(o).then((t) => Xn(t, r, e, i)) : Xn(o, r, e, i);
	};
}), Qn = /*@__PURE__*/ m("$ZodDiscriminatedUnion", (e, t) => {
	t.inclusive = !1, Zn.init(e, t);
	let n = e._zod.parse;
	_(e._zod, "propValues", () => {
		let e = {};
		for (let n of t.options) {
			let r = n._zod.propValues;
			if (!r || Object.keys(r).length === 0) throw Error(`Invalid discriminated union option at index "${t.options.indexOf(n)}"`);
			for (let [t, n] of Object.entries(r)) {
				e[t] || (e[t] = /* @__PURE__ */ new Set());
				for (let r of n) e[t].add(r);
			}
		}
		return e;
	});
	let r = Te(() => {
		let e = t.options, n = /* @__PURE__ */ new Map();
		for (let r of e) {
			let e = r._zod.propValues?.[t.discriminator];
			if (!e || e.size === 0) throw Error(`Invalid discriminated union option at index "${t.options.indexOf(r)}"`);
			for (let t of e) {
				if (n.has(t)) throw Error(`Duplicate discriminator value "${String(t)}"`);
				n.set(t, r);
			}
		}
		return n;
	});
	e._zod.parse = (i, a) => {
		let o = i.value;
		if (!Ne(o)) return i.issues.push({
			code: "invalid_type",
			expected: "object",
			input: o,
			inst: e
		}), i;
		let s = r.value.get(o?.[t.discriminator]);
		return s ? s._zod.run(i, a) : t.unionFallback || a.direction === "backward" ? n(i, a) : (i.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: t.discriminator,
			options: Array.from(r.value.keys()),
			input: o,
			path: [t.discriminator],
			inst: e
		}), i);
	};
}), $n = /*@__PURE__*/ m("$ZodIntersection", (e, t) => {
	O.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => tr(e, t, n)) : tr(e, i, a);
	};
});
function er(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (b(e) && b(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = er(e[n], t[n]);
			if (!r.valid) return {
				valid: !1,
				mergeErrorPath: [n, ...r.mergeErrorPath]
			};
			i[n] = r.data;
		}
		return {
			valid: !0,
			data: i
		};
	}
	if (Array.isArray(e) && Array.isArray(t)) {
		if (e.length !== t.length) return {
			valid: !1,
			mergeErrorPath: []
		};
		let n = [];
		for (let r = 0; r < e.length; r++) {
			let i = e[r], a = t[r], o = er(i, a);
			if (!o.valid) return {
				valid: !1,
				mergeErrorPath: [r, ...o.mergeErrorPath]
			};
			n.push(o.data);
		}
		return {
			valid: !0,
			data: n
		};
	}
	return {
		valid: !1,
		mergeErrorPath: []
	};
}
function tr(e, t, n) {
	let r = /* @__PURE__ */ new Map(), i;
	for (let n of t.issues) if (n.code === "unrecognized_keys") {
		i ??= n;
		for (let e of n.keys) r.has(e) || r.set(e, {}), r.get(e).l = !0;
	} else e.issues.push(n);
	for (let t of n.issues) if (t.code === "unrecognized_keys") for (let e of t.keys) r.has(e) || r.set(e, {}), r.get(e).r = !0;
	else e.issues.push(t);
	let a = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e);
	if (a.length && i && e.issues.push({
		...i,
		keys: a
	}), w(e)) return e;
	let o = er(t.value, n.value);
	if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`);
	return e.value = o.data, e;
}
var nr = /*@__PURE__*/ m("$ZodRecord", (e, t) => {
	O.init(e, t), e._zod.parse = (n, r) => {
		let i = n.value;
		if (!b(i)) return n.issues.push({
			expected: "record",
			code: "invalid_type",
			input: i,
			inst: e
		}), n;
		let a = [], o = t.keyType._zod.values;
		if (o) {
			n.value = {};
			let s = /* @__PURE__ */ new Set();
			for (let c of o) if (typeof c == "string" || typeof c == "number" || typeof c == "symbol") {
				s.add(typeof c == "number" ? c.toString() : c);
				let o = t.keyType._zod.run({
					value: c,
					issues: []
				}, r);
				if (o instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (o.issues.length) {
					n.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: o.issues.map((e) => E(e, r, g())),
						input: c,
						path: [c],
						inst: e
					});
					continue;
				}
				let l = o.value, u = t.valueType._zod.run({
					value: i[c],
					issues: []
				}, r);
				u instanceof Promise ? a.push(u.then((e) => {
					e.issues.length && n.issues.push(...T(c, e.issues)), n.value[l] = e.value;
				})) : (u.issues.length && n.issues.push(...T(c, u.issues)), n.value[l] = u.value);
			}
			let c;
			for (let e in i) s.has(e) || (c ??= [], c.push(e));
			c && c.length > 0 && n.issues.push({
				code: "unrecognized_keys",
				input: i,
				inst: e,
				keys: c
			});
		} else {
			n.value = {};
			for (let o of Reflect.ownKeys(i)) {
				if (o === "__proto__" || !Object.prototype.propertyIsEnumerable.call(i, o)) continue;
				let s = t.keyType._zod.run({
					value: o,
					issues: []
				}, r);
				if (s instanceof Promise) throw Error("Async schemas not supported in object keys currently");
				if (typeof o == "string" && Ht.test(o) && s.issues.length) {
					let e = t.keyType._zod.run({
						value: Number(o),
						issues: []
					}, r);
					if (e instanceof Promise) throw Error("Async schemas not supported in object keys currently");
					e.issues.length === 0 && (s = e);
				}
				if (s.issues.length) {
					t.mode === "loose" ? n.value[o] = i[o] : n.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: s.issues.map((e) => E(e, r, g())),
						input: o,
						path: [o],
						inst: e
					});
					continue;
				}
				let c = t.valueType._zod.run({
					value: i[o],
					issues: []
				}, r);
				c instanceof Promise ? a.push(c.then((e) => {
					e.issues.length && n.issues.push(...T(o, e.issues)), n.value[s.value] = e.value;
				})) : (c.issues.length && n.issues.push(...T(o, c.issues)), n.value[s.value] = c.value);
			}
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
}), rr = /*@__PURE__*/ m("$ZodEnum", (e, t) => {
	O.init(e, t);
	let n = Ce(t.entries), r = new Set(n);
	e._zod.values = r, e._zod.pattern = RegExp(`^(${n.filter((e) => Ie.has(typeof e)).map((e) => typeof e == "string" ? x(e) : e.toString()).join("|")})$`), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), ir = /*@__PURE__*/ m("$ZodLiteral", (e, t) => {
	if (O.init(e, t), t.values.length === 0) throw Error("Cannot create literal schema with no valid values");
	let n = new Set(t.values);
	e._zod.values = n, e._zod.pattern = RegExp(`^(${t.values.map((e) => typeof e == "string" ? x(e) : e ? x(e.toString()) : String(e)).join("|")})$`), e._zod.parse = (r, i) => {
		let a = r.value;
		return n.has(a) || r.issues.push({
			code: "invalid_value",
			values: t.values,
			input: a,
			inst: e
		}), r;
	};
}), ar = /*@__PURE__*/ m("$ZodTransform", (e, t) => {
	O.init(e, t), e._zod.optin = "optional", e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new xe(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n.fallback = !0, n));
		if (i instanceof Promise) throw new h();
		return n.value = i, n.fallback = !0, n;
	};
});
function or(e, t) {
	return t === void 0 && (e.issues.length || e.fallback) ? {
		issues: [],
		value: void 0
	} : e;
}
var sr = /*@__PURE__*/ m("$ZodOptional", (e, t) => {
	O.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", _(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, void 0]) : void 0), _(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${De(e.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (t.innerType._zod.optin === "optional") {
			let r = e.value, i = t.innerType._zod.run(e, n);
			return i instanceof Promise ? i.then((e) => or(e, r)) : or(i, r);
		}
		return e.value === void 0 ? e : t.innerType._zod.run(e, n);
	};
}), cr = /*@__PURE__*/ m("$ZodExactOptional", (e, t) => {
	sr.init(e, t), _(e._zod, "values", () => t.innerType._zod.values), _(e._zod, "pattern", () => t.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), lr = /*@__PURE__*/ m("$ZodNullable", (e, t) => {
	O.init(e, t), _(e._zod, "optin", () => t.innerType._zod.optin), _(e._zod, "optout", () => t.innerType._zod.optout), _(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${De(e.source)}|null)$`) : void 0;
	}), _(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), ur = /*@__PURE__*/ m("$ZodDefault", (e, t) => {
	O.init(e, t), e._zod.optin = "optional", _(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => dr(e, t)) : dr(r, t);
	};
});
function dr(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var fr = /*@__PURE__*/ m("$ZodPrefault", (e, t) => {
	O.init(e, t), e._zod.optin = "optional", _(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), pr = /*@__PURE__*/ m("$ZodNonOptional", (e, t) => {
	O.init(e, t), _(e._zod, "values", () => {
		let e = t.innerType._zod.values;
		return e ? new Set([...e].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => mr(t, e)) : mr(i, e);
	};
});
function mr(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
var hr = /*@__PURE__*/ m("$ZodCatch", (e, t) => {
	O.init(e, t), e._zod.optin = "optional", _(e._zod, "optout", () => t.innerType._zod.optout), _(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((r) => (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => E(e, n, g())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e)) : (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => E(e, n, g())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e);
	};
}), gr = /*@__PURE__*/ m("$ZodPipe", (e, t) => {
	O.init(e, t), _(e._zod, "values", () => t.in._zod.values), _(e._zod, "optin", () => t.in._zod.optin), _(e._zod, "optout", () => t.out._zod.optout), _(e._zod, "propValues", () => t.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => _r(e, t.in, n)) : _r(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => _r(e, t.out, n)) : _r(r, t.out, n);
	};
});
function _r(e, t, n) {
	return e.issues.length ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues,
		fallback: e.fallback
	}, n);
}
var vr = /*@__PURE__*/ m("$ZodReadonly", (e, t) => {
	O.init(e, t), _(e._zod, "propValues", () => t.innerType._zod.propValues), _(e._zod, "values", () => t.innerType._zod.values), _(e._zod, "optin", () => t.innerType?._zod?.optin), _(e._zod, "optout", () => t.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(yr) : yr(r);
	};
});
function yr(e) {
	return e.value = Object.freeze(e.value), e;
}
var br = /*@__PURE__*/ m("$ZodCustom", (e, t) => {
	D.init(e, t), O.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => xr(t, n, r, e));
		xr(i, n, r, e);
	};
});
function xr(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Ye(e));
	}
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var Sr, Cr = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map();
	}
	add(e, ...t) {
		let n = t[0];
		return this._map.set(e, n), n && typeof n == "object" && "id" in n && this._idmap.set(n.id, e), this;
	}
	clear() {
		return this._map = /* @__PURE__ */ new WeakMap(), this._idmap = /* @__PURE__ */ new Map(), this;
	}
	remove(e) {
		let t = this._map.get(e);
		return t && typeof t == "object" && "id" in t && this._idmap.delete(t.id), this._map.delete(e), this;
	}
	get(e) {
		let t = e._zod.parent;
		if (t) {
			let n = { ...this.get(t) ?? {} };
			delete n.id;
			let r = {
				...n,
				...this._map.get(e)
			};
			return Object.keys(r).length ? r : void 0;
		}
		return this._map.get(e);
	}
	has(e) {
		return this._map.has(e);
	}
};
function wr() {
	return new Cr();
}
(Sr = globalThis).__zod_globalRegistry ?? (Sr.__zod_globalRegistry = wr());
var A = globalThis.__zod_globalRegistry;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function Tr(e, t) {
	return new e({
		type: "string",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Er(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Dr(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Or(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function kr(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ar(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function jr(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Mr(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Nr(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Pr(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Fr(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ir(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Lr(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Rr(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function zr(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Br(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Vr(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Hr(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ur(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Wr(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Gr(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Kr(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function qr(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Jr(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Yr(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Xr(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Zr(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Qr(e, t) {
	return new e({
		type: "number",
		checks: [],
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function $r(e, t) {
	return new e({
		type: "number",
		check: "number_format",
		abort: !1,
		format: "safeint",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ei(e, t) {
	return new e({
		type: "boolean",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ti(e) {
	return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function ni(e, t) {
	return new e({
		type: "never",
		...C(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ri(e, t) {
	return new qt({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function ii(e, t) {
	return new qt({
		check: "less_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function ai(e, t) {
	return new Jt({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !1
	});
}
// @__NO_SIDE_EFFECTS__
function oi(e, t) {
	return new Jt({
		check: "greater_than",
		...C(t),
		value: e,
		inclusive: !0
	});
}
// @__NO_SIDE_EFFECTS__
function si(e, t) {
	return new Yt({
		check: "multiple_of",
		...C(t),
		value: e
	});
}
// @__NO_SIDE_EFFECTS__
function ci(e, t) {
	return new Zt({
		check: "max_length",
		...C(t),
		maximum: e
	});
}
// @__NO_SIDE_EFFECTS__
function li(e, t) {
	return new Qt({
		check: "min_length",
		...C(t),
		minimum: e
	});
}
// @__NO_SIDE_EFFECTS__
function ui(e, t) {
	return new $t({
		check: "length_equals",
		...C(t),
		length: e
	});
}
// @__NO_SIDE_EFFECTS__
function di(e, t) {
	return new tn({
		check: "string_format",
		format: "regex",
		...C(t),
		pattern: e
	});
}
// @__NO_SIDE_EFFECTS__
function fi(e) {
	return new nn({
		check: "string_format",
		format: "lowercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function pi(e) {
	return new rn({
		check: "string_format",
		format: "uppercase",
		...C(e)
	});
}
// @__NO_SIDE_EFFECTS__
function mi(e, t) {
	return new an({
		check: "string_format",
		format: "includes",
		...C(t),
		includes: e
	});
}
// @__NO_SIDE_EFFECTS__
function hi(e, t) {
	return new on({
		check: "string_format",
		format: "starts_with",
		...C(t),
		prefix: e
	});
}
// @__NO_SIDE_EFFECTS__
function gi(e, t) {
	return new sn({
		check: "string_format",
		format: "ends_with",
		...C(t),
		suffix: e
	});
}
// @__NO_SIDE_EFFECTS__
function j(e) {
	return new cn({
		check: "overwrite",
		tx: e
	});
}
// @__NO_SIDE_EFFECTS__
function _i(e) {
	return /* @__PURE__ */ j((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function vi() {
	return /* @__PURE__ */ j((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function yi() {
	return /* @__PURE__ */ j((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function bi() {
	return /* @__PURE__ */ j((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function xi() {
	return /* @__PURE__ */ j((e) => je(e));
}
// @__NO_SIDE_EFFECTS__
function Si(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Ci(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...C(n)
	});
}
// @__NO_SIDE_EFFECTS__
function wi(e, t) {
	let n = /* @__PURE__ */ Ti((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(Ye(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", r.input ??= t.value, r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(Ye(r));
		}
	}, e(t.value, t)), t);
	return n;
}
// @__NO_SIDE_EFFECTS__
function Ti(e, t) {
	let n = new D({
		check: "custom",
		...C(t)
	});
	return n._zod.check = e, n;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function Ei(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? A,
		target: t,
		unrepresentable: e?.unrepresentable ?? "throw",
		override: e?.override ?? (() => {}),
		io: e?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: e?.cycles ?? "ref",
		reused: e?.reused ?? "inline",
		external: e?.external ?? void 0
	};
}
function M(e, t, n = {
	path: [],
	schemaPath: []
}) {
	var r;
	let i = e._zod.def, a = t.seen.get(e);
	if (a) return a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema;
	let o = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: n.path
	};
	t.seen.set(e, o);
	let s = e._zod.toJSONSchema?.();
	if (s) o.schema = s;
	else {
		let r = {
			...n,
			schemaPath: [...n.schemaPath, e],
			path: n.path
		};
		if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r);
		else {
			let n = o.schema, a = t.processors[i.type];
			if (!a) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`);
			a(e, t, n, r);
		}
		let a = e._zod.parent;
		a && (o.ref ||= a, M(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && Object.assign(o.schema, c), t.io === "input" && N(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function Di(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = /* @__PURE__ */ new Map();
	for (let t of e.seen.entries()) {
		let n = e.metadataRegistry.get(t[0])?.id;
		if (n) {
			let e = r.get(n);
			if (e && e !== t[0]) throw Error(`Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			r.set(n, t[0]);
		}
	}
	let i = (t) => {
		let r = e.target === "draft-2020-12" ? "$defs" : "definitions";
		if (e.external) {
			let n = e.external.registry.get(t[0])?.id, i = e.external.uri ?? ((e) => e);
			if (n) return { ref: i(n) };
			let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`;
			return t[1].defId = a, {
				defId: a,
				ref: `${i("__shared")}#/${r}/${a}`
			};
		}
		if (t[1] === n) return { ref: "#" };
		let i = `#/${r}/`, a = t[1].schema.id ?? `__schema${e.counter++}`;
		return {
			defId: a,
			ref: i + a
		};
	}, a = (e) => {
		if (e[1].schema.$ref) return;
		let t = e[1], { ref: n, defId: r } = i(e);
		t.def = { ...t.schema }, r && (t.defId = r);
		let a = t.schema;
		for (let e in a) delete a[e];
		a.$ref = n;
	};
	if (e.cycles === "throw") for (let t of e.seen.entries()) {
		let e = t[1];
		if (e.cycle) throw Error(`Cycle detected: #/${e.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (let n of e.seen.entries()) {
		let r = n[1];
		if (t === n[0]) {
			a(n);
			continue;
		}
		if (e.external) {
			let r = e.external.registry.get(n[0])?.id;
			if (t !== n[0] && r) {
				a(n);
				continue;
			}
		}
		if (e.metadataRegistry.get(n[0])?.id) {
			a(n);
			continue;
		}
		if (r.cycle) {
			a(n);
			continue;
		}
		if (r.count > 1 && e.reused === "ref") {
			a(n);
			continue;
		}
	}
}
function Oi(e, t) {
	let n = e.seen.get(t);
	if (!n) throw Error("Unprocessed schema. This is a bug in Zod.");
	let r = (t) => {
		let n = e.seen.get(t);
		if (n.ref === null) return;
		let i = n.def ?? n.schema, a = { ...i }, o = n.ref;
		if (n.ref = null, o) {
			r(o);
			let n = e.seen.get(o), s = n.schema;
			if (s.$ref && (e.target === "draft-07" || e.target === "draft-04" || e.target === "openapi-3.0") ? (i.allOf = i.allOf ?? [], i.allOf.push(s)) : Object.assign(i, s), Object.assign(i, a), t._zod.parent === o) for (let e in i) e !== "$ref" && e !== "allOf" && (e in a || delete i[e]);
			if (s.$ref && n.def) for (let e in i) e !== "$ref" && e !== "allOf" && e in n.def && JSON.stringify(i[e]) === JSON.stringify(n.def[e]) && delete i[e];
		}
		let s = t._zod.parent;
		if (s && s !== o) {
			r(s);
			let t = e.seen.get(s);
			if (t?.schema.$ref && (i.$ref = t.schema.$ref, t.def)) for (let e in i) e !== "$ref" && e !== "allOf" && e in t.def && JSON.stringify(i[e]) === JSON.stringify(t.def[e]) && delete i[e];
		}
		e.override({
			zodSchema: t,
			jsonSchema: i,
			path: n.path ?? []
		});
	};
	for (let t of [...e.seen.entries()].reverse()) r(t[0]);
	let i = {};
	if (e.target === "draft-2020-12" ? i.$schema = "https://json-schema.org/draft/2020-12/schema" : e.target === "draft-07" ? i.$schema = "http://json-schema.org/draft-07/schema#" : e.target === "draft-04" ? i.$schema = "http://json-schema.org/draft-04/schema#" : e.target, e.external?.uri) {
		let n = e.external.registry.get(t)?.id;
		if (!n) throw Error("Schema is missing an `id` property");
		i.$id = e.external.uri(n);
	}
	Object.assign(i, n.def ?? n.schema);
	let a = e.metadataRegistry.get(t)?.id;
	a !== void 0 && i.id === a && delete i.id;
	let o = e.external?.defs ?? {};
	for (let t of e.seen.entries()) {
		let e = t[1];
		e.def && e.defId && (e.def.id === e.defId && delete e.def.id, o[e.defId] = e.def);
	}
	e.external || Object.keys(o).length > 0 && (e.target === "draft-2020-12" ? i.$defs = o : i.definitions = o);
	try {
		let n = JSON.parse(JSON.stringify(i));
		return Object.defineProperty(n, "~standard", {
			value: {
				...t["~standard"],
				jsonSchema: {
					input: Ai(t, "input", e.processors),
					output: Ai(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function N(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return N(r.element, n);
	if (r.type === "set") return N(r.valueType, n);
	if (r.type === "lazy") return N(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault") return N(r.innerType, n);
	if (r.type === "intersection") return N(r.left, n) || N(r.right, n);
	if (r.type === "record" || r.type === "map") return N(r.keyType, n) || N(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : N(r.in, n) || N(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (N(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (N(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (N(e, n)) return !0;
		return !!(r.rest && N(r.rest, n));
	}
	return !1;
}
var ki = (e, t = {}) => (n) => {
	let r = Ei({
		...n,
		processors: t
	});
	return M(e, r), Di(r, e), Oi(r, e);
}, Ai = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = Ei({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return M(e, o), Di(o, e), Oi(o, e);
}, ji = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, Mi = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag;
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = ji[s] ?? s, i.format === "" && delete i.format, s === "time" && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c];
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, Ni = (e, t, n, r) => {
	let i = n, { minimum: a, maximum: o, format: s, multipleOf: c, exclusiveMaximum: l, exclusiveMinimum: u } = e._zod.bag;
	i.type = typeof s == "string" && s.includes("int") ? "integer" : "number";
	let d = typeof u == "number" && u >= (a ?? -Infinity), f = typeof l == "number" && l <= (o ?? Infinity), p = t.target === "draft-04" || t.target === "openapi-3.0";
	d ? p ? (i.minimum = u, i.exclusiveMinimum = !0) : i.exclusiveMinimum = u : typeof a == "number" && (i.minimum = a), f ? p ? (i.maximum = l, i.exclusiveMaximum = !0) : i.exclusiveMaximum = l : typeof o == "number" && (i.maximum = o), typeof c == "number" && (i.multipleOf = c);
}, Pi = (e, t, n, r) => {
	n.type = "boolean";
}, Fi = (e, t, n, r) => {
	n.not = {};
}, Ii = (e, t, n, r) => {
	let i = e._zod.def, a = Ce(i.entries);
	a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a;
}, Li = (e, t, n, r) => {
	let i = e._zod.def, a = [];
	for (let e of i.values) if (e === void 0) {
		if (t.unrepresentable === "throw") throw Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof e == "bigint") {
		if (t.unrepresentable === "throw") throw Error("BigInt literals cannot be represented in JSON Schema");
		a.push(Number(e));
	} else a.push(e);
	if (a.length !== 0) {
		if (a.length === 1) {
			let e = a[0];
			n.type = e === null ? "null" : typeof e, t.target === "draft-04" || t.target === "openapi-3.0" ? n.enum = [e] : n.const = e;
		} else a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), a.every((e) => typeof e == "boolean") && (n.type = "boolean"), a.every((e) => e === null) && (n.type = "null"), n.enum = a;
	}
}, Ri = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Custom types cannot be represented in JSON Schema");
}, zi = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Transforms cannot be represented in JSON Schema");
}, Bi = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = e._zod.bag;
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = M(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
}, Vi = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object", i.properties = {};
	let o = a.shape;
	for (let e in o) i.properties[e] = M(o[e], t, {
		...r,
		path: [
			...r.path,
			"properties",
			e
		]
	});
	let s = new Set(Object.keys(o)), c = new Set([...s].filter((e) => {
		let n = a.shape[e]._zod;
		return t.io === "input" ? n.optin === void 0 : n.optout === void 0;
	}));
	c.size > 0 && (i.required = Array.from(c)), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = M(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Hi = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => M(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, Ui = (e, t, n, r) => {
	let i = e._zod.def, a = M(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = M(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1;
	n.allOf = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
}, Wi = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object";
	let o = a.keyType, s = o._zod.bag?.patterns;
	if (a.mode === "loose" && s && s.size > 0) {
		let e = M(a.valueType, t, {
			...r,
			path: [
				...r.path,
				"patternProperties",
				"*"
			]
		});
		i.patternProperties = {};
		for (let t of s) i.patternProperties[t.source] = e;
	} else (t.target === "draft-07" || t.target === "draft-2020-12") && (i.propertyNames = M(a.keyType, t, {
		...r,
		path: [...r.path, "propertyNames"]
	})), i.additionalProperties = M(a.valueType, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	});
	let c = o._zod.values;
	if (c) {
		let e = [...c].filter((e) => typeof e == "string" || typeof e == "number");
		e.length > 0 && (i.required = e);
	}
}, Gi = (e, t, n, r) => {
	let i = e._zod.def, a = M(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, Ki = (e, t, n, r) => {
	let i = e._zod.def;
	M(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, qi = (e, t, n, r) => {
	let i = e._zod.def;
	M(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.default = JSON.parse(JSON.stringify(i.defaultValue));
}, Ji = (e, t, n, r) => {
	let i = e._zod.def;
	M(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue)));
}, Yi = (e, t, n, r) => {
	let i = e._zod.def;
	M(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		throw Error("Dynamic catch values are not supported in JSON Schema");
	}
	n.default = o;
}, Xi = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	M(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, Zi = (e, t, n, r) => {
	let i = e._zod.def;
	M(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, Qi = (e, t, n, r) => {
	let i = e._zod.def;
	M(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, $i = /*@__PURE__*/ m("ZodISODateTime", (e, t) => {
	Cn.init(e, t), R.init(e, t);
});
function ea(e) {
	return /* @__PURE__ */ Jr($i, e);
}
var ta = /*@__PURE__*/ m("ZodISODate", (e, t) => {
	wn.init(e, t), R.init(e, t);
});
function na(e) {
	return /* @__PURE__ */ Yr(ta, e);
}
var ra = /*@__PURE__*/ m("ZodISOTime", (e, t) => {
	Tn.init(e, t), R.init(e, t);
});
function ia(e) {
	return /* @__PURE__ */ Xr(ra, e);
}
var aa = /*@__PURE__*/ m("ZodISODuration", (e, t) => {
	En.init(e, t), R.init(e, t);
});
function oa(e) {
	return /* @__PURE__ */ Zr(aa, e);
}
var P = /*@__PURE__*/ m("ZodError", (e, t) => {
	Ze.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
		format: { value: (t) => et(e, t) },
		flatten: { value: (t) => $e(e, t) },
		addIssue: { value: (t) => {
			e.issues.push(t), e.message = JSON.stringify(e.issues, we, 2);
		} },
		addIssues: { value: (t) => {
			e.issues.push(...t), e.message = JSON.stringify(e.issues, we, 2);
		} },
		isEmpty: { get() {
			return e.issues.length === 0;
		} }
	});
}, { Parent: Error }), sa = /* @__PURE__ */ tt(P), ca = /* @__PURE__ */ nt(P), la = /* @__PURE__ */ rt(P), ua = /* @__PURE__ */ at(P), da = /* @__PURE__ */ st(P), fa = /* @__PURE__ */ ct(P), pa = /* @__PURE__ */ lt(P), ma = /* @__PURE__ */ ut(P), ha = /* @__PURE__ */ dt(P), ga = /* @__PURE__ */ ft(P), _a = /* @__PURE__ */ pt(P), va = /* @__PURE__ */ mt(P), ya = /* @__PURE__ */ new WeakMap();
function F(e, t, n) {
	let r = Object.getPrototypeOf(e), i = ya.get(r);
	if (i || (i = /* @__PURE__ */ new Set(), ya.set(r, i)), !i.has(t)) {
		i.add(t);
		for (let e in n) {
			let t = n[e];
			Object.defineProperty(r, e, {
				configurable: !0,
				enumerable: !1,
				get() {
					let n = t.bind(this);
					return Object.defineProperty(this, e, {
						configurable: !0,
						writable: !0,
						enumerable: !0,
						value: n
					}), n;
				},
				set(t) {
					Object.defineProperty(this, e, {
						configurable: !0,
						writable: !0,
						enumerable: !0,
						value: t
					});
				}
			});
		}
	}
}
var I = /*@__PURE__*/ m("ZodType", (e, t) => (O.init(e, t), Object.assign(e["~standard"], { jsonSchema: {
	input: Ai(e, "input"),
	output: Ai(e, "output")
} }), e.toJSONSchema = ki(e, {}), e.def = t, e.type = t.type, Object.defineProperty(e, "_def", { value: t }), e.parse = (t, n) => sa(e, t, n, { callee: e.parse }), e.safeParse = (t, n) => la(e, t, n), e.parseAsync = async (t, n) => ca(e, t, n, { callee: e.parseAsync }), e.safeParseAsync = async (t, n) => ua(e, t, n), e.spa = e.safeParseAsync, e.encode = (t, n) => da(e, t, n), e.decode = (t, n) => fa(e, t, n), e.encodeAsync = async (t, n) => pa(e, t, n), e.decodeAsync = async (t, n) => ma(e, t, n), e.safeEncode = (t, n) => ha(e, t, n), e.safeDecode = (t, n) => ga(e, t, n), e.safeEncodeAsync = async (t, n) => _a(e, t, n), e.safeDecodeAsync = async (t, n) => va(e, t, n), F(e, "ZodType", {
	check(...e) {
		let t = this.def;
		return this.clone(y(t, { checks: [...t.checks ?? [], ...e.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)] }), { parent: !0 });
	},
	with(...e) {
		return this.check(...e);
	},
	clone(e, t) {
		return S(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(jo(e, t));
	},
	superRefine(e, t) {
		return this.check(Mo(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ j(e));
	},
	optional() {
		return po(this);
	},
	exactOptional() {
		return ho(this);
	},
	nullable() {
		return _o(this);
	},
	nullish() {
		return po(_o(this));
	},
	nonoptional(e) {
		return Co(this, e);
	},
	array() {
		return Za(this);
	},
	or(e) {
		return eo([this, e]);
	},
	and(e) {
		return io(this, e);
	},
	transform(e) {
		return Do(this, uo(e));
	},
	default(e) {
		return yo(this, e);
	},
	prefault(e) {
		return xo(this, e);
	},
	catch(e) {
		return To(this, e);
	},
	pipe(e) {
		return Do(this, e);
	},
	readonly() {
		return ko(this);
	},
	describe(e) {
		let t = this.clone();
		return A.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return A.get(this);
		let t = this.clone();
		return A.add(t, e[0]), t;
	},
	isOptional() {
		return this.safeParse(void 0).success;
	},
	isNullable() {
		return this.safeParse(null).success;
	},
	apply(e) {
		return e(this);
	}
}), Object.defineProperty(e, "description", {
	get() {
		return A.get(e)?.description;
	},
	configurable: !0
}), e)), ba = /*@__PURE__*/ m("_ZodString", (e, t) => {
	dn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Mi(e, t, n, r);
	let n = e._zod.bag;
	e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, F(e, "_ZodString", {
		regex(...e) {
			return this.check(/* @__PURE__ */ di(...e));
		},
		includes(...e) {
			return this.check(/* @__PURE__ */ mi(...e));
		},
		startsWith(...e) {
			return this.check(/* @__PURE__ */ hi(...e));
		},
		endsWith(...e) {
			return this.check(/* @__PURE__ */ gi(...e));
		},
		min(...e) {
			return this.check(/* @__PURE__ */ li(...e));
		},
		max(...e) {
			return this.check(/* @__PURE__ */ ci(...e));
		},
		length(...e) {
			return this.check(/* @__PURE__ */ ui(...e));
		},
		nonempty(...e) {
			return this.check(/* @__PURE__ */ li(1, ...e));
		},
		lowercase(e) {
			return this.check(/* @__PURE__ */ fi(e));
		},
		uppercase(e) {
			return this.check(/* @__PURE__ */ pi(e));
		},
		trim() {
			return this.check(/* @__PURE__ */ vi());
		},
		normalize(...e) {
			return this.check(/* @__PURE__ */ _i(...e));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ yi());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ bi());
		},
		slugify() {
			return this.check(/* @__PURE__ */ xi());
		}
	});
}), xa = /*@__PURE__*/ m("ZodString", (e, t) => {
	dn.init(e, t), ba.init(e, t), e.email = (t) => e.check(/* @__PURE__ */ Er(Sa, t)), e.url = (t) => e.check(/* @__PURE__ */ Mr(Ta, t)), e.jwt = (t) => e.check(/* @__PURE__ */ qr(Ba, t)), e.emoji = (t) => e.check(/* @__PURE__ */ Nr(Ea, t)), e.guid = (t) => e.check(/* @__PURE__ */ Dr(Ca, t)), e.uuid = (t) => e.check(/* @__PURE__ */ Or(wa, t)), e.uuidv4 = (t) => e.check(/* @__PURE__ */ kr(wa, t)), e.uuidv6 = (t) => e.check(/* @__PURE__ */ Ar(wa, t)), e.uuidv7 = (t) => e.check(/* @__PURE__ */ jr(wa, t)), e.nanoid = (t) => e.check(/* @__PURE__ */ Pr(Da, t)), e.guid = (t) => e.check(/* @__PURE__ */ Dr(Ca, t)), e.cuid = (t) => e.check(/* @__PURE__ */ Fr(Oa, t)), e.cuid2 = (t) => e.check(/* @__PURE__ */ Ir(ka, t)), e.ulid = (t) => e.check(/* @__PURE__ */ Lr(Aa, t)), e.base64 = (t) => e.check(/* @__PURE__ */ Wr(La, t)), e.base64url = (t) => e.check(/* @__PURE__ */ Gr(Ra, t)), e.xid = (t) => e.check(/* @__PURE__ */ Rr(ja, t)), e.ksuid = (t) => e.check(/* @__PURE__ */ zr(Ma, t)), e.ipv4 = (t) => e.check(/* @__PURE__ */ Br(Na, t)), e.ipv6 = (t) => e.check(/* @__PURE__ */ Vr(Pa, t)), e.cidrv4 = (t) => e.check(/* @__PURE__ */ Hr(Fa, t)), e.cidrv6 = (t) => e.check(/* @__PURE__ */ Ur(Ia, t)), e.e164 = (t) => e.check(/* @__PURE__ */ Kr(za, t)), e.datetime = (t) => e.check(ea(t)), e.date = (t) => e.check(na(t)), e.time = (t) => e.check(ia(t)), e.duration = (t) => e.check(oa(t));
});
function L(e) {
	return /* @__PURE__ */ Tr(xa, e);
}
var R = /*@__PURE__*/ m("ZodStringFormat", (e, t) => {
	k.init(e, t), ba.init(e, t);
}), Sa = /*@__PURE__*/ m("ZodEmail", (e, t) => {
	mn.init(e, t), R.init(e, t);
}), Ca = /*@__PURE__*/ m("ZodGUID", (e, t) => {
	fn.init(e, t), R.init(e, t);
}), wa = /*@__PURE__*/ m("ZodUUID", (e, t) => {
	pn.init(e, t), R.init(e, t);
}), Ta = /*@__PURE__*/ m("ZodURL", (e, t) => {
	hn.init(e, t), R.init(e, t);
}), Ea = /*@__PURE__*/ m("ZodEmoji", (e, t) => {
	gn.init(e, t), R.init(e, t);
}), Da = /*@__PURE__*/ m("ZodNanoID", (e, t) => {
	_n.init(e, t), R.init(e, t);
}), Oa = /*@__PURE__*/ m("ZodCUID", (e, t) => {
	vn.init(e, t), R.init(e, t);
}), ka = /*@__PURE__*/ m("ZodCUID2", (e, t) => {
	yn.init(e, t), R.init(e, t);
}), Aa = /*@__PURE__*/ m("ZodULID", (e, t) => {
	bn.init(e, t), R.init(e, t);
}), ja = /*@__PURE__*/ m("ZodXID", (e, t) => {
	xn.init(e, t), R.init(e, t);
}), Ma = /*@__PURE__*/ m("ZodKSUID", (e, t) => {
	Sn.init(e, t), R.init(e, t);
}), Na = /*@__PURE__*/ m("ZodIPv4", (e, t) => {
	Dn.init(e, t), R.init(e, t);
}), Pa = /*@__PURE__*/ m("ZodIPv6", (e, t) => {
	On.init(e, t), R.init(e, t);
}), Fa = /*@__PURE__*/ m("ZodCIDRv4", (e, t) => {
	kn.init(e, t), R.init(e, t);
}), Ia = /*@__PURE__*/ m("ZodCIDRv6", (e, t) => {
	An.init(e, t), R.init(e, t);
}), La = /*@__PURE__*/ m("ZodBase64", (e, t) => {
	Mn.init(e, t), R.init(e, t);
}), Ra = /*@__PURE__*/ m("ZodBase64URL", (e, t) => {
	Pn.init(e, t), R.init(e, t);
}), za = /*@__PURE__*/ m("ZodE164", (e, t) => {
	Fn.init(e, t), R.init(e, t);
}), Ba = /*@__PURE__*/ m("ZodJWT", (e, t) => {
	Ln.init(e, t), R.init(e, t);
}), Va = /*@__PURE__*/ m("ZodNumber", (e, t) => {
	Rn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ni(e, t, n, r), F(e, "ZodNumber", {
		gt(e, t) {
			return this.check(/* @__PURE__ */ ai(e, t));
		},
		gte(e, t) {
			return this.check(/* @__PURE__ */ oi(e, t));
		},
		min(e, t) {
			return this.check(/* @__PURE__ */ oi(e, t));
		},
		lt(e, t) {
			return this.check(/* @__PURE__ */ ri(e, t));
		},
		lte(e, t) {
			return this.check(/* @__PURE__ */ ii(e, t));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ ii(e, t));
		},
		int(e) {
			return this.check(Ua(e));
		},
		safe(e) {
			return this.check(Ua(e));
		},
		positive(e) {
			return this.check(/* @__PURE__ */ ai(0, e));
		},
		nonnegative(e) {
			return this.check(/* @__PURE__ */ oi(0, e));
		},
		negative(e) {
			return this.check(/* @__PURE__ */ ri(0, e));
		},
		nonpositive(e) {
			return this.check(/* @__PURE__ */ ii(0, e));
		},
		multipleOf(e, t) {
			return this.check(/* @__PURE__ */ si(e, t));
		},
		step(e, t) {
			return this.check(/* @__PURE__ */ si(e, t));
		},
		finite() {
			return this;
		}
	});
	let n = e._zod.bag;
	e.minValue = Math.max(n.minimum ?? -Infinity, n.exclusiveMinimum ?? -Infinity) ?? null, e.maxValue = Math.min(n.maximum ?? Infinity, n.exclusiveMaximum ?? Infinity) ?? null, e.isInt = (n.format ?? "").includes("int") || Number.isSafeInteger(n.multipleOf ?? .5), e.isFinite = !0, e.format = n.format ?? null;
});
function z(e) {
	return /* @__PURE__ */ Qr(Va, e);
}
var Ha = /*@__PURE__*/ m("ZodNumberFormat", (e, t) => {
	zn.init(e, t), Va.init(e, t);
});
function Ua(e) {
	return /* @__PURE__ */ $r(Ha, e);
}
var Wa = /*@__PURE__*/ m("ZodBoolean", (e, t) => {
	Bn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Pi(e, t, n, r);
});
function Ga(e) {
	return /* @__PURE__ */ ei(Wa, e);
}
var Ka = /*@__PURE__*/ m("ZodUnknown", (e, t) => {
	Vn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function qa() {
	return /* @__PURE__ */ ti(Ka);
}
var Ja = /*@__PURE__*/ m("ZodNever", (e, t) => {
	Hn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Fi(e, t, n, r);
});
function Ya(e) {
	return /* @__PURE__ */ ni(Ja, e);
}
var Xa = /*@__PURE__*/ m("ZodArray", (e, t) => {
	Wn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Bi(e, t, n, r), e.element = t.element, F(e, "ZodArray", {
		min(e, t) {
			return this.check(/* @__PURE__ */ li(e, t));
		},
		nonempty(e) {
			return this.check(/* @__PURE__ */ li(1, e));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ ci(e, t));
		},
		length(e, t) {
			return this.check(/* @__PURE__ */ ui(e, t));
		},
		unwrap() {
			return this.element;
		}
	});
});
function Za(e, t) {
	return /* @__PURE__ */ Si(Xa, e, t);
}
var Qa = /*@__PURE__*/ m("ZodObject", (e, t) => {
	Yn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Vi(e, t, n, r), _(e, "shape", () => t.shape), F(e, "ZodObject", {
		keyof() {
			return V(Object.keys(this._zod.def.shape));
		},
		catchall(e) {
			return this.clone({
				...this._zod.def,
				catchall: e
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: qa()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: qa()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: Ya()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(e) {
			return Ve(this, e);
		},
		safeExtend(e) {
			return He(this, e);
		},
		merge(e) {
			return Ue(this, e);
		},
		pick(e) {
			return ze(this, e);
		},
		omit(e) {
			return Be(this, e);
		},
		partial(...e) {
			return We(fo, this, e[0]);
		},
		required(...e) {
			return Ge(So, this, e[0]);
		}
	});
});
function B(e, t) {
	return new Qa({
		type: "object",
		shape: e ?? {},
		...C(t)
	});
}
var $a = /*@__PURE__*/ m("ZodUnion", (e, t) => {
	Zn.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Hi(e, t, n, r), e.options = t.options;
});
function eo(e, t) {
	return new $a({
		type: "union",
		options: e,
		...C(t)
	});
}
var to = /*@__PURE__*/ m("ZodDiscriminatedUnion", (e, t) => {
	$a.init(e, t), Qn.init(e, t);
});
function no(e, t, n) {
	return new to({
		type: "union",
		options: t,
		discriminator: e,
		...C(n)
	});
}
var ro = /*@__PURE__*/ m("ZodIntersection", (e, t) => {
	$n.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ui(e, t, n, r);
});
function io(e, t) {
	return new ro({
		type: "intersection",
		left: e,
		right: t
	});
}
var ao = /*@__PURE__*/ m("ZodRecord", (e, t) => {
	nr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Wi(e, t, n, r), e.keyType = t.keyType, e.valueType = t.valueType;
});
function oo(e, t, n) {
	return !t || !t._zod ? new ao({
		type: "record",
		keyType: L(),
		valueType: e,
		...C(t)
	}) : new ao({
		type: "record",
		keyType: e,
		valueType: t,
		...C(n)
	});
}
var so = /*@__PURE__*/ m("ZodEnum", (e, t) => {
	rr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ii(e, t, n, r), e.enum = t.entries, e.options = Object.values(t.entries);
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new so({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new so({
			...t,
			checks: [],
			...C(r),
			entries: i
		});
	};
});
function V(e, t) {
	return new so({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...C(t)
	});
}
var co = /*@__PURE__*/ m("ZodLiteral", (e, t) => {
	ir.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Li(e, t, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function H(e, t) {
	return new co({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...C(t)
	});
}
var lo = /*@__PURE__*/ m("ZodTransform", (e, t) => {
	ar.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => zi(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new xe(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(Ye(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", t.input ??= n.value, t.inst ??= e, n.issues.push(Ye(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n.fallback = !0, n)) : (n.value = i, n.fallback = !0, n);
	};
});
function uo(e) {
	return new lo({
		type: "transform",
		transform: e
	});
}
var fo = /*@__PURE__*/ m("ZodOptional", (e, t) => {
	sr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Qi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function po(e) {
	return new fo({
		type: "optional",
		innerType: e
	});
}
var mo = /*@__PURE__*/ m("ZodExactOptional", (e, t) => {
	cr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Qi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function ho(e) {
	return new mo({
		type: "optional",
		innerType: e
	});
}
var go = /*@__PURE__*/ m("ZodNullable", (e, t) => {
	lr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Gi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function _o(e) {
	return new go({
		type: "nullable",
		innerType: e
	});
}
var vo = /*@__PURE__*/ m("ZodDefault", (e, t) => {
	ur.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => qi(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function yo(e, t) {
	return new vo({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : Fe(t);
		}
	});
}
var bo = /*@__PURE__*/ m("ZodPrefault", (e, t) => {
	fr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ji(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function xo(e, t) {
	return new bo({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : Fe(t);
		}
	});
}
var So = /*@__PURE__*/ m("ZodNonOptional", (e, t) => {
	pr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ki(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Co(e, t) {
	return new So({
		type: "nonoptional",
		innerType: e,
		...C(t)
	});
}
var wo = /*@__PURE__*/ m("ZodCatch", (e, t) => {
	hr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Yi(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function To(e, t) {
	return new wo({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : () => t
	});
}
var Eo = /*@__PURE__*/ m("ZodPipe", (e, t) => {
	gr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Xi(e, t, n, r), e.in = t.in, e.out = t.out;
});
function Do(e, t) {
	return new Eo({
		type: "pipe",
		in: e,
		out: t
	});
}
var Oo = /*@__PURE__*/ m("ZodReadonly", (e, t) => {
	vr.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Zi(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function ko(e) {
	return new Oo({
		type: "readonly",
		innerType: e
	});
}
var Ao = /*@__PURE__*/ m("ZodCustom", (e, t) => {
	br.init(e, t), I.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ri(e, t, n, r);
});
function jo(e, t = {}) {
	return /* @__PURE__ */ Ci(Ao, e, t);
}
function Mo(e, t) {
	return /* @__PURE__ */ wi(e, t);
}
//#endregion
//#region ../../packages/platform-api/src/session-payloads.ts
function No(e) {
	return Array.from(e).map((e) => e.toString(16).padStart(2, "0")).join("");
}
var Po = B({
	id: L(),
	name: L(),
	protocol: H("rtu"),
	baudRate: z(),
	dataBits: eo([H(7), H(8)]),
	stopBits: eo([H(1), H(2)]),
	parity: V([
		"none",
		"even",
		"odd"
	]),
	flowControl: V([
		"off",
		"rts-cts",
		"xon-xoff"
	]),
	requestTimeoutMs: z(),
	retryCount: z(),
	interRequestDelayMs: z(),
	addressAdjust: V(["off", "on"]),
	recentPortHint: L().nullable()
}), Fo = B({
	id: L(),
	name: L(),
	protocol: H("tcp"),
	host: L(),
	port: z(),
	unitId: z(),
	connectTimeoutMs: z(),
	requestTimeoutMs: z(),
	retryCount: z(),
	autoReconnect: Ga(),
	interRequestDelayMs: z()
});
function Io(e) {
	return {
		...e,
		id: e.id
	};
}
var Lo = B({ profile: Fo }), Ro = V([
	"hex",
	"unsigned",
	"unsigned-0.1",
	"unsigned-0.01",
	"unsigned-0.001",
	"unsigned-0.0001",
	"signed",
	"signed-0.1",
	"signed-0.01",
	"signed-0.001",
	"signed-0.0001",
	"binary"
]), zo = B({ value: z() }), Bo = B({
	rowId: L(),
	order: z(),
	name: L(),
	comment: L(),
	addressDraft: L(),
	addressValue: zo.nullable(),
	dataType: Ro,
	pollingEnabled: Ga(),
	traceEnabled: Ga(),
	cellText: L(),
	lastKnownRawValue: zo.nullable(),
	createdAt: z(),
	updatedAt: z()
});
function Vo(e) {
	let t = e.addressValue === null ? null : ee.create(e.addressValue.value), n = e.lastKnownRawValue === null ? null : f.create(e.lastKnownRawValue.value);
	return {
		...e,
		rowId: e.rowId,
		addressValue: t === null ? null : t.ok ? t.value : null,
		lastKnownRawValue: n === null ? null : n.ok ? n.value : null
	};
}
var Ho = B({
	key: L(),
	address: z().nullable()
}), Uo = B({
	batchId: L(),
	totalRows: z(),
	eligibleRows: z(),
	successCount: z(),
	failureCount: z(),
	skippedCount: z(),
	cancelledCount: z(),
	startedAt: z(),
	completedAt: z(),
	durationMs: z()
});
function Wo(e) {
	return { ...e };
}
B({ kind: H("write-succeeded-no-verify") });
function Go(e) {
	return { ...e };
}
var Ko = B({
	timestamp: z(),
	direction: V(["request", "response"]),
	bytesHex: L(),
	protocol: V(["rtu", "tcp"]),
	slaveAddress: z().nullable(),
	functionCode: z().nullable(),
	userAddress: z().nullable(),
	sentAddress: z().nullable(),
	quantity: z().nullable(),
	attempt: z(),
	status: V([
		"success",
		"failure",
		"timeout",
		"cancelled",
		"discarded"
	]),
	errorCode: L().nullable(),
	exceptionCode: z().nullable(),
	source: V([
		"manual-read",
		"manual-write",
		"batch-read",
		"polling",
		"trace",
		"plugin",
		"connection-control"
	]),
	durationMs: z().nullable()
});
function qo(e) {
	return {
		...e,
		bytesHex: No(e.bytes)
	};
}
var Jo = B({
	key: L(),
	sequence: z(),
	rawValue: z(),
	timestamp: z()
}), Yo = B({
	timestamp: z(),
	level: V([
		"info",
		"warning",
		"error"
	]),
	messageKey: L(),
	params: oo(L(), eo([L(), z()])).optional(),
	detail: L().nullable()
});
function Xo(e) {
	return { ...e };
}
var Zo = "mamep:invoke", Qo = "mamep:event", $o = [
	"get-capabilities",
	"get-app-version",
	"copy-text-to-clipboard",
	"read-text-from-clipboard",
	"select-serial-port",
	"get-color-theme",
	"debug:get-state",
	"serial-enumerate",
	"session-connect",
	"session-disconnect",
	"session-get-state",
	"session-set-slave-address",
	"session-read-row",
	"session-write-row",
	"session-batch-read",
	"session-update-polling-targets",
	"session-polling-start",
	"session-polling-stop",
	"session-trace-start",
	"session-trace-stop",
	"session-tcp-connect"
], es = B({
	portId: L(),
	label: L()
}), ts = V(["light", "dark"]), U = H(1), W = L().min(1), ns = V($o), rs = V([
	"validation",
	"capability",
	"permission",
	"connection",
	"transport",
	"timeout",
	"protocol",
	"modbus-exception",
	"cancellation",
	"persistence",
	"plugin",
	"internal"
]), is = V([
	"info",
	"warning",
	"error",
	"fatal"
]), as = V([
	"disconnected",
	"selecting-device",
	"connecting",
	"connected",
	"disconnecting",
	"reconnect-waiting",
	"reconnecting",
	"interrupted",
	"failed"
]), os = B({
	code: L(),
	category: rs,
	severity: is,
	retryable: Ga(),
	userMessageKey: L(),
	technicalMessage: L()
});
function ss(e) {
	return {
		code: e.code,
		category: e.category,
		severity: e.severity,
		retryable: e.retryable,
		userMessageKey: e.userMessageKey,
		technicalMessage: e.technicalMessage
	};
}
var cs = no("ok", [B({
	ok: H(!0),
	value: z()
}), B({
	ok: H(!1),
	error: os
})]);
function ls(e) {
	return e.ok ? {
		ok: !0,
		value: e.value
	} : {
		ok: !1,
		error: ss(e.error)
	};
}
var us = B({
	portId: L(),
	profile: Po,
	slaveAddress: z()
});
B({ connectionState: as }), B({ summary: Uo });
var G = {
	protocolVersion: U,
	type: H("request"),
	messageId: W
}, ds = no("kind", [
	B({
		...G,
		kind: H("get-capabilities"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("get-app-version"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("copy-text-to-clipboard"),
		payload: B({ text: L() })
	}),
	B({
		...G,
		kind: H("read-text-from-clipboard"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("select-serial-port"),
		payload: B({ portId: L() })
	}),
	B({
		...G,
		kind: H("get-color-theme"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("debug:get-state"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("serial-enumerate"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("session-connect"),
		payload: us
	}),
	B({
		...G,
		kind: H("session-disconnect"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("session-get-state"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("session-set-slave-address"),
		payload: B({ slave: z() })
	}),
	B({
		...G,
		kind: H("session-read-row"),
		payload: B({ row: Bo })
	}),
	B({
		...G,
		kind: H("session-write-row"),
		payload: B({ row: Bo })
	}),
	B({
		...G,
		kind: H("session-batch-read"),
		payload: B({ rows: Za(Ho) })
	}),
	B({
		...G,
		kind: H("session-update-polling-targets"),
		payload: B({ rows: Za(B({
			key: L(),
			address: z()
		})) })
	}),
	B({
		...G,
		kind: H("session-polling-start"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("session-polling-stop"),
		payload: B({})
	}),
	B({
		...G,
		kind: H("session-trace-start"),
		payload: B({
			key: L(),
			address: z(),
			speedMs: z()
		})
	}),
	B({
		...G,
		kind: H("session-trace-stop"),
		payload: B({ key: L() })
	}),
	B({
		...G,
		kind: H("session-tcp-connect"),
		payload: Lo
	})
]);
eo([
	ds,
	B({
		protocolVersion: U,
		type: H("response"),
		messageId: W,
		kind: ns,
		ok: H(!0),
		payload: qa()
	}),
	B({
		protocolVersion: U,
		type: H("error"),
		messageId: W,
		kind: L(),
		payload: os
	}),
	no("kind", [
		B({
			protocolVersion: U,
			type: H("event"),
			messageId: W,
			kind: H("connection-state"),
			payload: B({ state: as })
		}),
		B({
			protocolVersion: U,
			type: H("event"),
			messageId: W,
			kind: H("serial-ports-available"),
			payload: B({ ports: Za(es) })
		}),
		B({
			protocolVersion: U,
			type: H("event"),
			messageId: W,
			kind: H("color-theme-changed"),
			payload: B({ theme: ts })
		}),
		B({
			protocolVersion: U,
			type: H("event"),
			messageId: W,
			kind: H("comm-log"),
			payload: B({ event: Ko })
		}),
		B({
			protocolVersion: U,
			type: H("event"),
			messageId: W,
			kind: H("poll-result"),
			payload: B({
				key: L(),
				address: z(),
				result: cs
			})
		}),
		B({
			protocolVersion: U,
			type: H("event"),
			messageId: W,
			kind: H("trace-sample"),
			payload: B({ sample: Jo })
		}),
		B({
			protocolVersion: U,
			type: H("event"),
			messageId: W,
			kind: H("app-message"),
			payload: B({ message: Yo })
		})
	])
]);
var fs = Object.freeze({
	modbusRtu: !0,
	modbusTcp: !0,
	serialPorts: "enumerated",
	filesystem: "limited",
	nodePlugins: !1,
	webPlugins: !0
});
Object.freeze({
	modbusRtu: !0,
	modbusTcp: !0,
	serialPorts: "enumerated",
	filesystem: "unsupported",
	nodePlugins: !1,
	webPlugins: !0
});
//#endregion
//#region ../electron/src/main/ipc.ts
async function K(e, t) {
	try {
		let n = await t();
		return n.ok ? J(e, n.value) : q(e.messageId, n.error.code, n.error.technicalMessage);
	} catch (t) {
		return q(e.messageId, "SESSION_INTERNAL_ERROR", t instanceof Error ? t.message : String(t));
	}
}
async function ps(e, t) {
	try {
		return t(), J(e, null);
	} catch (t) {
		return q(e.messageId, "SESSION_INTERNAL_ERROR", t instanceof Error ? t.message : String(t));
	}
}
function ms(e) {
	if (typeof e != "object" || !e) return "";
	let t = e.messageId;
	return typeof t == "string" && t.length > 0 ? t : "";
}
function q(e, t, n) {
	return {
		protocolVersion: 1,
		type: "error",
		messageId: e,
		kind: "host-error",
		payload: ss(l({
			code: t,
			category: "internal",
			userMessageKey: "errors.hostMessageRejected",
			technicalMessage: n
		}))
	};
}
function J(e, t) {
	return {
		protocolVersion: 1,
		type: "response",
		messageId: e.messageId,
		kind: e.kind,
		ok: !0,
		payload: t
	};
}
async function hs(e, t, n) {
	switch (e.kind) {
		case "get-capabilities": return J(e, fs);
		case "get-app-version": return J(e, t.appVersion());
		case "copy-text-to-clipboard": return t.clipboardWriteText(e.payload.text), J(e, null);
		case "read-text-from-clipboard": return J(e, t.clipboardReadText());
		case "select-serial-port": return t.resolveSerialPortSelection(e.payload.portId, n) ? J(e, null) : q(e.messageId, "SERIAL_PICKER_NOT_ACTIVE", "no pending serial port selection for this sender");
		case "get-color-theme": return q(e.messageId, "COLOR_THEME_UNSUPPORTED", "color theme RPC is not supported on the Electron host");
		case "serial-enumerate":
		case "session-connect":
		case "session-set-slave-address": return q(e.messageId, "SESSION_NOT_AVAILABLE", "RTU session RPC runs in the renderer (Web Serial); not handled by the Electron main host");
		case "session-tcp-connect": {
			let { profile: n } = e.payload;
			return K(e, () => t.session.connectTcp(Io(n)));
		}
		case "session-disconnect": return K(e, () => t.session.disconnect());
		case "session-get-state": return K(e, () => Promise.resolve({
			ok: !0,
			value: { connectionState: t.session.getConnectionState() }
		}));
		case "session-read-row": {
			let { row: n } = e.payload;
			return K(e, () => t.session.readRow(Vo(n)));
		}
		case "session-write-row": {
			let { row: n } = e.payload;
			return K(e, async () => {
				let e = await t.session.writeRow(Vo(n));
				return e.ok ? u(Go(e.value)) : e;
			});
		}
		case "session-batch-read": {
			let { rows: n } = e.payload;
			return K(e, async () => {
				let e = await t.session.readAllRows(n.map((e) => ({
					key: e.key,
					address: e.address
				}))).promise;
				return e.ok ? u({ summary: Wo(e.value) }) : e;
			});
		}
		case "session-update-polling-targets": return ps(e, () => t.session.updatePollingTargets(e.payload.rows));
		case "session-polling-start": return ps(e, () => t.session.startPolling());
		case "session-polling-stop": return ps(e, () => t.session.stopPolling());
		case "session-trace-start": return ps(e, () => t.session.traceStart(e.payload.key, e.payload.address, e.payload.speedMs));
		case "session-trace-stop": return ps(e, () => t.session.traceStop(e.payload.key));
		case "debug:get-state": return t.isPackaged() ? q(e.messageId, "DEBUG_PROBE_DISABLED", "debug probe is disabled in packaged builds") : J(e, {
			platform: "electron",
			appVersion: t.appVersion(),
			packaged: t.isPackaged(),
			windowCount: t.windowCount(),
			connectionState: t.connectionState(),
			uptimeMs: t.uptimeMs()
		});
		default: return e;
	}
}
async function gs(e, t) {
	if (!t.isSenderMainWindow) return q(ms(e), "HOST_MESSAGE_SENDER_REJECTED", "message sender is not the main window");
	let n = ds.safeParse(e);
	return n.success ? hs(n.data, t.deps, t.sender) : q(ms(e), "HOST_MESSAGE_INVALID", `invalid host request: ${n.error.message}`);
}
//#endregion
//#region ../../packages/communication/src/cancellation.ts
function _s() {
	let e = !1, t = null;
	return {
		get cancelled() {
			return e;
		},
		get reason() {
			return t;
		},
		cancel(n = "cancelled") {
			e || (e = !0, t = n);
		}
	};
}
//#endregion
//#region ../../packages/communication/src/batch-read-coordinator.ts
var vs = class {
	seq = 0;
	session;
	clock;
	constructor(e, t) {
		this.session = e, this.clock = t;
	}
	readAll(e, t) {
		let n = `batch-${++this.seq}`, r = _s(), i = e.filter((e) => e.address !== null), a = e.length - i.length, o = this.clock.now(), s = 0, c = 0, l = 0, d = 0;
		return {
			promise: new Promise((f) => {
				let p = () => {
					if (d < i.length) return;
					let t = this.clock.now();
					f(u({
						batchId: n,
						totalRows: e.length,
						eligibleRows: i.length,
						successCount: s,
						failureCount: c,
						skippedCount: a,
						cancelledCount: l,
						startedAt: o,
						completedAt: t,
						durationMs: t - o
					}));
				};
				if (i.length === 0) {
					p();
					return;
				}
				for (let e of i) this.session.readRegister(e.address ?? 0, {
					source: "batch-read",
					priority: "batch-read",
					group: n,
					cancelToken: r
				}).then((n) => {
					t?.(e.key, n), n.ok ? s += 1 : n.error.code === "CANCELLED" ? l += 1 : c += 1, d += 1, p();
				});
			}),
			cancel: () => r.cancel("batch-cancelled")
		};
	}
}, ys = {
	disconnected: /* @__PURE__ */ new Set(["selecting-device", "connecting"]),
	"selecting-device": /* @__PURE__ */ new Set(["connecting", "disconnected"]),
	connecting: /* @__PURE__ */ new Set([
		"connected",
		"failed",
		"disconnected"
	]),
	connected: /* @__PURE__ */ new Set(["disconnecting", "interrupted"]),
	disconnecting: /* @__PURE__ */ new Set(["disconnected"]),
	"reconnect-waiting": /* @__PURE__ */ new Set(["reconnecting"]),
	reconnecting: /* @__PURE__ */ new Set(["connected", "failed"]),
	interrupted: /* @__PURE__ */ new Set(["reconnect-waiting", "disconnected"]),
	failed: /* @__PURE__ */ new Set(["connecting", "disconnected"])
}, bs = class {
	state = "disconnected";
	listeners = /* @__PURE__ */ new Set();
	getState() {
		return this.state;
	}
	forceState(e) {
		this.setState(e);
	}
	transition(e) {
		let t = ys[this.state];
		return t === void 0 || !t.has(e) ? d(l({
			code: "ILLEGAL_STATE_TRANSITION",
			category: "connection",
			severity: "error",
			retryable: !1,
			userMessageKey: "errors.illegalStateTransition",
			technicalMessage: `illegal connection state transition ${this.state} -> ${e}`
		})) : (this.setState(e), u(void 0));
	}
	subscribe(e) {
		return this.listeners.add(e), () => {
			this.listeners.delete(e);
		};
	}
	setState(e) {
		if (this.state !== e) {
			this.state = e;
			for (let t of this.listeners) t(e);
		}
	}
}, xs = class {
	targets = [];
	inFlight = /* @__PURE__ */ new Set();
	skippedTicks = /* @__PURE__ */ new Map();
	timer = null;
	runningFlag = !1;
	listeners = /* @__PURE__ */ new Set();
	session;
	clock;
	options;
	constructor(e, t, n) {
		this.session = e, this.clock = t, this.options = n;
	}
	get isRunning() {
		return this.runningFlag;
	}
	getSkippedTicks(e) {
		return this.skippedTicks.get(e) ?? 0;
	}
	onResult(e) {
		return this.listeners.add(e), () => this.listeners.delete(e);
	}
	setTargets(e) {
		this.targets = [...e];
	}
	start() {
		this.runningFlag || (this.runningFlag = !0, this.scheduleNext());
	}
	stop() {
		this.runningFlag = !1, this.timer?.cancel(), this.timer = null;
	}
	scheduleNext() {
		this.timer = this.clock.schedule(() => this.tick(), this.options.getIntervalMs());
	}
	tick() {
		if (this.runningFlag) {
			for (let e of this.targets) {
				if (this.inFlight.has(e.key)) {
					this.skippedTicks.set(e.key, (this.skippedTicks.get(e.key) ?? 0) + 1);
					continue;
				}
				this.inFlight.add(e.key);
				let t = e.address;
				this.session.readRegister(e.address, {
					source: "polling",
					priority: "polling"
				}).then((n) => {
					this.inFlight.delete(e.key);
					for (let r of this.listeners) r(e.key, t, n);
				});
			}
			this.scheduleNext();
		}
	}
}, Ss = [
	"connection-control",
	"manual-write",
	"manual-read",
	"write-verify",
	"batch-read",
	"polling",
	"plugin-background"
], Cs = class {
	queue = [];
	running = !1;
	lastTaskCompletedAt = 0;
	nextId = 1;
	pendingSleepResolve = null;
	clock;
	options;
	constructor(e, t) {
		this.clock = e, this.options = t;
	}
	get pendingCount() {
		return this.queue.length;
	}
	enqueue(e, t) {
		return new Promise((n) => {
			let r = {
				id: this.nextId++,
				priority: t.priority,
				group: t.group ?? null,
				cancelToken: t.cancelToken ?? null,
				createdAt: this.clock.now(),
				run: e,
				resolve: (e) => n(e)
			};
			this.queue.push(r), this.drain();
		});
	}
	cancelGroup(e) {
		for (let t of this.queue) t.group === e && !t.cancelToken?.cancelled && t.cancelToken?.cancel();
		this.drain();
	}
	cancelAll() {
		for (let e of this.queue) e.cancelToken?.cancelled || e.cancelToken?.cancel();
		this.pendingSleepResolve?.();
	}
	async drain() {
		if (!this.running) {
			this.running = !0;
			try {
				for (;;) {
					let e = this.pickNext();
					if (e === null) break;
					let t = this.lastTaskCompletedAt === 0 ? 0 : this.options.getInterRequestDelayMs();
					if (t > 0 && !e.cancelToken?.cancelled && await this.sleep(t), e.cancelToken?.cancelled) {
						e.resolve(d(l({
							code: "CANCELLED",
							category: "cancellation",
							severity: "info",
							retryable: !1,
							userMessageKey: "errors.cancelled",
							technicalMessage: e.cancelToken.reason ?? "task cancelled"
						})));
						continue;
					}
					try {
						let t = await e.run();
						this.lastTaskCompletedAt = this.clock.now(), e.resolve(t);
					} catch (t) {
						e.resolve(d(l({
							code: "INTERNAL_ERROR",
							category: "internal",
							severity: "error",
							retryable: !1,
							userMessageKey: "errors.internal",
							technicalMessage: t instanceof Error ? t.message : String(t),
							cause: t
						})));
					}
				}
			} finally {
				this.running = !1;
			}
		}
	}
	pickNext() {
		let e = [];
		for (let t of this.queue) t.cancelToken?.cancelled ? t.resolve(d(l({
			code: "CANCELLED",
			category: "cancellation",
			severity: "info",
			retryable: !1,
			userMessageKey: "errors.cancelled",
			technicalMessage: t.cancelToken.reason ?? "task cancelled"
		}))) : e.push(t);
		if (this.queue = e, e.length === 0) return null;
		let t = this.clock.now(), n = null;
		for (let r of e) t - r.createdAt >= this.options.fairnessThresholdMs && (n === null || r.createdAt < n.createdAt) && (n = r);
		if (n !== null) return this.queue = e.filter((e) => e !== n), n;
		let r = null;
		for (let t of e) {
			if (r === null) {
				r = t;
				continue;
			}
			let e = Ss.indexOf(r.priority), n = Ss.indexOf(t.priority);
			(n < e || n === e && t.createdAt < r.createdAt) && (r = t);
		}
		return r !== null && (this.queue = e.filter((e) => e !== r)), r;
	}
	sleep(e) {
		return new Promise((t) => {
			let n = () => {
				this.pendingSleepResolve = null, t();
			};
			this.pendingSleepResolve = n, this.clock.schedule(n, e);
		});
	}
};
//#endregion
//#region ../../packages/protocol-modbus/src/crc16.ts
function ws(e, t = 0, n = e.length) {
	let r = 65535;
	for (let i = t; i < n; i++) {
		r ^= e[i] ?? 0;
		for (let e = 0; e < 8; e++) r = r & 1 ? r >> 1 ^ 40961 : r >> 1;
	}
	return r & 65535;
}
function Ts(e) {
	let t = ws(e), n = new Uint8Array(e.length + 2);
	return n.set(e, 0), n[e.length] = t & 255, n[e.length + 1] = t >> 8 & 255, n;
}
function Es(e) {
	return Ts(Uint8Array.from([
		e.slaveAddress & 255,
		3,
		e.startAddress >> 8 & 255,
		e.startAddress & 255,
		e.quantity >> 8 & 255,
		e.quantity & 255
	]));
}
function Ds(e) {
	return Ts(Uint8Array.from([
		e.slaveAddress & 255,
		16,
		e.address >> 8 & 255,
		e.address & 255,
		0,
		1,
		2,
		e.rawValue >> 8 & 255,
		e.rawValue & 255
	]));
}
function Y(e, t) {
	return l({
		code: e,
		category: "protocol",
		severity: "error",
		retryable: !1,
		userMessageKey: `errors.${e.toLowerCase().replaceAll("_", "")}`,
		technicalMessage: t
	});
}
function Os(e, t) {
	if (e.length < 4) return d(Y("RTU_INVALID_LENGTH", `frame too short: ${e.length} bytes`));
	let n = e.length - 2, r = ws(e, 0, n), i = (e[n] ?? 0) | (e[n + 1] ?? 0) << 8;
	if (i !== r) return d(Y("RTU_CRC_MISMATCH", `crc mismatch: expected ${r.toString(16)}, got ${i.toString(16)}`));
	let a = e[0] ?? -1;
	if (a !== t.slaveAddress) return d(Y("RTU_SLAVE_MISMATCH", `slave mismatch: expected ${t.slaveAddress}, got ${a}`));
	let o = e[1] ?? -1, s = t.kind === "read-holding" ? 3 : 16;
	if ((o & 127) === s && o & 128) return e.length === 5 ? u({
		kind: "exception",
		exceptionCode: e[2] ?? 0
	}) : d(Y("RTU_INVALID_LENGTH", `exception frame must be 5 bytes, got ${e.length}`));
	if (o !== s) return d(Y("RTU_FUNCTION_MISMATCH", `function mismatch: expected ${s.toString(16)}, got ${o.toString(16)}`));
	if (t.kind === "read-holding") {
		if (e.length !== 5 + t.quantity * 2) return d(Y("RTU_INVALID_LENGTH", `read frame must be ${5 + t.quantity * 2} bytes, got ${e.length}`));
		let n = e[2] ?? -1;
		if (n !== t.quantity * 2) return d(Y("RTU_BYTE_COUNT_MISMATCH", `byte count expected ${t.quantity * 2}, got ${n}`));
		let r = [];
		for (let n = 0; n < t.quantity; n++) {
			let t = e[3 + n * 2], i = e[4 + n * 2];
			if (t === void 0 || i === void 0) return d(Y("RTU_DATA_LENGTH_MISMATCH", "read response data truncated"));
			r.push(t << 8 | i);
		}
		return u({
			kind: "read-holding",
			values: r
		});
	}
	if (e.length !== 8) return d(Y("RTU_INVALID_LENGTH", `write frame must be 8 bytes, got ${e.length}`));
	let c = (e[2] ?? 0) << 8 | (e[3] ?? 0);
	if (c !== t.address) return d(Y("RTU_ADDRESS_MISMATCH", `address expected ${t.address}, got ${c}`));
	let l = (e[4] ?? 0) << 8 | (e[5] ?? 0);
	return l === t.quantity ? u({ kind: "write-single" }) : d(Y("RTU_QUANTITY_MISMATCH", `quantity expected ${t.quantity}, got ${l}`));
}
function X(e, t) {
	return l({
		code: e,
		category: "protocol",
		severity: "error",
		retryable: !1,
		userMessageKey: `errors.${e.toLowerCase().replaceAll("_", "")}`,
		technicalMessage: t
	});
}
function ks(e, t, n) {
	let r = 1 + n.length, i = new Uint8Array(6 + r);
	return i[0] = e >> 8 & 255, i[1] = e & 255, i[2] = 0, i[3] = 0, i[4] = r >> 8 & 255, i[5] = r & 255, i[6] = t & 255, i.set(n, 7), i;
}
function As(e) {
	let t = Uint8Array.from([
		3,
		e.startAddress >> 8 & 255,
		e.startAddress & 255,
		e.quantity >> 8 & 255,
		e.quantity & 255
	]);
	return ks(e.transactionId, e.unitId, t);
}
function js(e) {
	let t = Uint8Array.from([
		16,
		e.address >> 8 & 255,
		e.address & 255,
		0,
		1,
		2,
		e.rawValue >> 8 & 255,
		e.rawValue & 255
	]);
	return ks(e.transactionId, e.unitId, t);
}
function Ms(e, t) {
	if (e.length < 8) return d(X("TCP_INVALID_LENGTH", `frame too short: ${e.length} bytes`));
	let n = (e[2] ?? 0) << 8 | (e[3] ?? 0);
	if (n !== 0) return d(X("TCP_PROTOCOL_MISMATCH", `protocol identifier expected 0, got ${n}`));
	let r = (e[4] ?? 0) << 8 | (e[5] ?? 0);
	if (e.length !== 6 + r) return d(X("TCP_INVALID_LENGTH", `frame length ${e.length} does not match MBAP length ${r}`));
	let i = (e[0] ?? 0) << 8 | (e[1] ?? 0);
	if (i !== t.transactionId) return d(X("TCP_TRANSACTION_MISMATCH", `transaction id expected ${t.transactionId}, got ${i}`));
	let a = e[6] ?? -1;
	if (a !== t.unitId) return d(X("TCP_UNIT_ID_MISMATCH", `unit id expected ${t.unitId}, got ${a}`));
	let o = e[7] ?? -1, s = t.kind === "read-holding" ? 3 : 16;
	if ((o & 127) === s && o & 128) return e.length === 9 ? u({
		kind: "exception",
		exceptionCode: e[8] ?? 0
	}) : d(X("TCP_INVALID_LENGTH", `exception frame must be 9 bytes, got ${e.length}`));
	if (o !== s) return d(X("TCP_FUNCTION_MISMATCH", `function mismatch: expected ${s.toString(16)}, got ${o.toString(16)}`));
	if (t.kind === "read-holding") {
		if (e.length !== 9 + t.quantity * 2) return d(X("TCP_INVALID_LENGTH", `read frame must be ${9 + t.quantity * 2} bytes, got ${e.length}`));
		let n = e[8] ?? -1;
		if (n !== t.quantity * 2) return d(X("TCP_BYTE_COUNT_MISMATCH", `byte count expected ${t.quantity * 2}, got ${n}`));
		let r = [];
		for (let n = 0; n < t.quantity; n++) {
			let t = e[9 + n * 2], i = e[10 + n * 2];
			if (t === void 0 || i === void 0) return d(X("TCP_DATA_LENGTH_MISMATCH", "read response data truncated"));
			r.push(t << 8 | i);
		}
		return u({
			kind: "read-holding",
			values: r
		});
	}
	if (e.length !== 12) return d(X("TCP_INVALID_LENGTH", `write frame must be 12 bytes, got ${e.length}`));
	let c = (e[8] ?? 0) << 8 | (e[9] ?? 0);
	if (c !== t.address) return d(X("TCP_ADDRESS_MISMATCH", `address expected ${t.address}, got ${c}`));
	let l = (e[10] ?? 0) << 8 | (e[11] ?? 0);
	return l === t.quantity ? u({ kind: "write-single" }) : d(X("TCP_QUANTITY_MISMATCH", `quantity expected ${t.quantity}, got ${l}`));
}
//#endregion
//#region ../../packages/communication/src/tcp-frame-parser.ts
var Ns = 7, Ps = 254, Fs = class {
	buffer = [];
	expect;
	constructor(e) {
		this.expect = e;
	}
	push(e) {
		for (let t of e) this.buffer.push(t);
		return this.tryParse();
	}
	tryParse() {
		for (;;) {
			if (this.buffer.length < Ns) return { done: !1 };
			let e = (this.buffer[4] ?? 0) << 8 | (this.buffer[5] ?? 0);
			if (e < 1 || e > Ps) {
				this.buffer.shift();
				continue;
			}
			let t = 6 + e;
			if (this.buffer.length < t) return { done: !1 };
			let n = Uint8Array.from(this.buffer.slice(0, t));
			this.buffer = this.buffer.slice(t);
			let r = Ms(n, this.expect);
			if (r.ok) return {
				done: !0,
				outcome: r,
				frame: n
			};
		}
	}
};
//#endregion
//#region ../../packages/communication/src/session.ts
function Is(e) {
	return l({
		code: "CANCELLED",
		category: "cancellation",
		severity: "info",
		retryable: !1,
		userMessageKey: "errors.cancelled",
		technicalMessage: e
	});
}
function Ls() {
	return l({
		code: "CONNECTION_NOT_CONNECTED",
		category: "connection",
		severity: "warning",
		retryable: !1,
		userMessageKey: "errors.notConnected",
		technicalMessage: "session is not connected"
	});
}
function Rs(e) {
	return l({
		code: "REQUEST_TIMEOUT",
		category: "timeout",
		severity: "error",
		retryable: !0,
		userMessageKey: "errors.requestTimeout",
		technicalMessage: `no response within ${e}ms`
	});
}
function zs(e) {
	return l({
		code: `MODBUS_EXCEPTION_${e.toString(16).toUpperCase().padStart(2, "0")}`,
		category: "modbus-exception",
		severity: "warning",
		retryable: !1,
		userMessageKey: "errors.modbusException",
		technicalMessage: `modbus exception code ${e}`
	});
}
var Bs = class {
	buffer = [];
	expect;
	constructor(e) {
		this.expect = e;
	}
	push(e) {
		for (let t of e) this.buffer.push(t);
		return this.tryParse();
	}
	tryParse() {
		for (;;) {
			let e = this.buffer.indexOf(this.expect.slaveAddress);
			if (e === -1) return this.buffer = [], { done: !1 };
			if (e > 0 && (this.buffer = this.buffer.slice(e)), this.buffer.length < 2) return { done: !1 };
			let t = this.expect.kind === "read-holding" ? 3 : 16, n = this.buffer[1] ?? -1, r;
			if (n === t) r = this.expect.kind === "read-holding" ? 3 + this.expect.quantity * 2 + 2 : 8;
			else if (n === (t | 128)) r = 5;
			else {
				this.buffer.shift();
				continue;
			}
			if (this.buffer.length < r) return { done: !1 };
			let i = Uint8Array.from(this.buffer.slice(0, r)), a = Os(i, this.expect);
			if (a.ok) return this.buffer = this.buffer.slice(r), {
				done: !0,
				outcome: a,
				frame: i
			};
			if (a.error.code === "RTU_CRC_MISMATCH") {
				this.buffer.shift();
				continue;
			}
			return this.buffer = this.buffer.slice(r), {
				done: !0,
				outcome: a,
				frame: i
			};
		}
	}
}, Vs = class {
	stateMachine = new bs();
	options;
	scheduler;
	pendingExchange = null;
	protocol;
	unitId;
	slaveAddress;
	nextTransactionId = 0;
	constructor(e) {
		this.options = e, this.protocol = e.protocol ?? "rtu", this.unitId = e.unitId ?? 0, this.slaveAddress = e.slaveAddress ?? 1, this.scheduler = new Cs(e.clock, {
			fairnessThresholdMs: e.fairnessThresholdMs ?? 2e3,
			getInterRequestDelayMs: () => this.options.config.interRequestDelayMs
		}), this.stateMachine.subscribe((e) => this.options.onStateChange?.(e)), e.transport.onData((e) => {
			this.pendingExchange === null && this.emitLog({
				timestamp: this.options.clock.now(),
				direction: "response",
				bytes: e,
				protocol: this.protocol,
				slaveAddress: null,
				functionCode: null,
				userAddress: null,
				sentAddress: null,
				quantity: null,
				attempt: 0,
				status: "discarded",
				errorCode: "LATE_RESPONSE_DISCARDED",
				exceptionCode: null,
				source: "connection-control",
				durationMs: null
			});
		}), e.transport.onClose(() => this.handleTransportClosed()), e.transport.onError((e) => this.handleTransportError(e));
	}
	handleTransportClosed() {
		let e = this.stateMachine.getState();
		e === "connected" ? (this.pendingExchange?.cancel("transport-closed"), this.pendingExchange = null, this.enterInterrupted()) : e === "connecting" && this.enterFailed();
	}
	handleTransportError(e) {
		let t = this.stateMachine.getState();
		t === "connected" ? (this.pendingExchange?.cancel("transport-error"), this.pendingExchange = null, this.enterInterrupted()) : t === "connecting" && this.enterFailed(), this.emitLog({
			timestamp: this.options.clock.now(),
			direction: "response",
			bytes: /* @__PURE__ */ new Uint8Array(),
			protocol: this.protocol,
			slaveAddress: this.logUnitAddress(),
			functionCode: null,
			userAddress: null,
			sentAddress: null,
			quantity: null,
			attempt: 0,
			status: "failure",
			errorCode: e.code,
			exceptionCode: null,
			source: "connection-control",
			durationMs: null
		});
	}
	enterInterrupted() {
		this.stateMachine.transition("interrupted").ok || this.stateMachine.forceState("interrupted");
	}
	enterFailed() {
		this.stateMachine.transition("failed").ok || this.stateMachine.forceState("failed");
	}
	getState() {
		return this.stateMachine.getState();
	}
	setSlaveAddress(e) {
		this.slaveAddress = e;
	}
	getConfig() {
		return this.options.config;
	}
	async connect() {
		if (this.stateMachine.getState() === "connected") return u(void 0);
		this.stateMachine.transition("connecting").ok || this.stateMachine.forceState("connecting"), this.nextTransactionId = 0;
		let e = await this.options.transport.open();
		return e.ok ? (this.stateMachine.transition("connected").ok || this.stateMachine.forceState("connected"), u(void 0)) : (this.stateMachine.transition("failed").ok || this.stateMachine.forceState("failed"), e);
	}
	async disconnect() {
		if (this.stateMachine.getState() === "disconnected") return u(void 0);
		this.stateMachine.transition("disconnecting").ok || this.stateMachine.forceState("disconnecting"), this.scheduler.cancelAll(), this.pendingExchange !== null && (this.pendingExchange.cancel("disconnected"), this.pendingExchange = null);
		let e = await this.options.transport.close();
		return this.stateMachine.forceState("disconnected"), e;
	}
	readRegister(e, t) {
		return this.stateMachine.getState() === "connected" ? this.scheduler.enqueue(() => this.executeRead(e, t), {
			priority: t.priority ?? "manual-read",
			group: t.group,
			cancelToken: t.cancelToken
		}).then((e) => e) : Promise.resolve(d(Ls()));
	}
	writeRegister(e, t, n) {
		return this.stateMachine.getState() === "connected" ? this.scheduler.enqueue(() => this.executeWrite(e, t, n), { priority: "manual-write" }) : Promise.resolve(d(Ls()));
	}
	async executeRead(e, t) {
		let n = await this.executeExchange(() => this.buildReadAttempt(e), {
			source: t.source,
			userAddress: t.userAddress ?? null,
			sentAddress: e,
			functionCode: 3,
			quantity: 1
		});
		return n.ok ? n.value.kind === "exception" ? d(zs(n.value.exceptionCode)) : n.value.kind === "read-holding" ? u(n.value.values[0] ?? 0) : d(l({
			code: "UNEXPECTED_RESPONSE_KIND",
			category: "protocol",
			severity: "error",
			retryable: !1,
			userMessageKey: "errors.unexpectedResponse",
			technicalMessage: `unexpected response kind for read: ${String(n.value)}`
		})) : n;
	}
	async executeWrite(e, t, n) {
		let r = await this.executeExchange(() => this.buildWriteAttempt(e, t), {
			source: n.source,
			userAddress: n.userAddress ?? null,
			sentAddress: e,
			functionCode: 16,
			quantity: 1
		});
		return r.ok ? r.value.kind === "exception" ? d(zs(r.value.exceptionCode)) : r.value.kind === "write-single" ? u({ kind: "write-succeeded-no-verify" }) : d(l({
			code: "UNEXPECTED_RESPONSE_KIND",
			category: "protocol",
			severity: "error",
			retryable: !1,
			userMessageKey: "errors.unexpectedResponse",
			technicalMessage: `unexpected response kind for write: ${String(r.value)}`
		})) : r;
	}
	async executeExchange(e, t) {
		let n = this.options.config.retryCount + 1, r = null;
		for (let i = 1; i <= n; i++) {
			if (this.stateMachine.getState() !== "connected") return d(Ls());
			let { frame: n, expect: a } = e(), o = this.options.clock.now();
			this.emitLog({
				timestamp: o,
				direction: "request",
				bytes: n,
				protocol: this.protocol,
				slaveAddress: "slaveAddress" in a ? a.slaveAddress : this.logUnitAddress(),
				functionCode: t.functionCode,
				userAddress: t.userAddress,
				sentAddress: t.sentAddress,
				quantity: t.quantity,
				attempt: i,
				status: "success",
				errorCode: null,
				exceptionCode: null,
				source: t.source,
				durationMs: null
			});
			let s = this.startExchange(a), c = await this.options.transport.write(n);
			if (!c.ok) {
				s.cancel("write-failed"), r = d(c.error), this.emitExchangeLog(/* @__PURE__ */ new Uint8Array(), i, o, t, "failure", c.error.code, null);
				continue;
			}
			s.startTimeout();
			let l = await s.promise;
			if (l.ok) {
				let e = l.value.result;
				return e.kind === "exception" ? (this.emitExchangeLog(l.value.frame, i, o, t, "failure", `MODBUS_EXCEPTION_${e.exceptionCode.toString(16).toUpperCase().padStart(2, "0")}`, e.exceptionCode), u(e)) : (this.emitExchangeLog(l.value.frame, i, o, t, "success", null, null), u(e));
			}
			if (this.emitExchangeLog(/* @__PURE__ */ new Uint8Array(), i, o, t, l.error.category === "timeout" ? "timeout" : "failure", l.error.code, null), r = d(l.error), !this.shouldRetry(l.error)) return l;
		}
		return r ?? d(Ls());
	}
	shouldRetry(e) {
		return e.retryable ? e.category === "timeout" || e.category === "transport" : !1;
	}
	buildReadAttempt(e) {
		if (this.protocol === "tcp") {
			let t = this.allocateTransactionId();
			return {
				frame: As({
					transactionId: t,
					unitId: this.unitId,
					startAddress: e,
					quantity: 1
				}),
				expect: {
					kind: "read-holding",
					transactionId: t,
					unitId: this.unitId,
					startAddress: e,
					quantity: 1
				}
			};
		}
		return {
			frame: Es({
				slaveAddress: this.slaveAddress,
				startAddress: e,
				quantity: 1
			}),
			expect: {
				kind: "read-holding",
				slaveAddress: this.slaveAddress,
				startAddress: e,
				quantity: 1
			}
		};
	}
	buildWriteAttempt(e, t) {
		if (this.protocol === "tcp") {
			let n = this.allocateTransactionId();
			return {
				frame: js({
					transactionId: n,
					unitId: this.unitId,
					address: e,
					rawValue: t
				}),
				expect: {
					kind: "write-single",
					transactionId: n,
					unitId: this.unitId,
					address: e,
					quantity: 1
				}
			};
		}
		return {
			frame: Ds({
				slaveAddress: this.slaveAddress,
				address: e,
				rawValue: t
			}),
			expect: {
				kind: "write-single",
				slaveAddress: this.slaveAddress,
				address: e,
				quantity: 1
			}
		};
	}
	allocateTransactionId() {
		let e = this.nextTransactionId;
		return this.nextTransactionId = this.nextTransactionId + 1 & 65535, e;
	}
	logUnitAddress() {
		return this.protocol === "tcp" ? this.unitId : this.slaveAddress;
	}
	startExchange(e) {
		let t = "slaveAddress" in e ? new Bs(e) : new Fs(e), n = _s(), r = !1, i = null, a = null, o = () => {}, s = (e) => {
			r || (r = !0, i?.cancel(), a?.(), this.pendingExchange?.cancelToken === n && (this.pendingExchange = null), o(e));
		}, c = new Promise((e) => {
			o = e;
		});
		a = this.options.transport.onData((e) => {
			let n = t.push(e);
			n.done && (n.outcome.ok ? s(u({
				result: n.outcome.value,
				frame: n.frame
			})) : s(n.outcome));
		});
		let l = {
			cancelToken: n,
			cancel: (e) => s(d(Is(e))),
			startTimeout: () => {
				i = this.options.clock.schedule(() => s(d(Rs(this.options.config.requestTimeoutMs))), this.options.config.requestTimeoutMs);
			},
			promise: c
		};
		return this.pendingExchange = l, l;
	}
	emitExchangeLog(e, t, n, r, i, a, o) {
		this.emitLog({
			timestamp: this.options.clock.now(),
			direction: "response",
			bytes: e,
			protocol: this.protocol,
			slaveAddress: this.logUnitAddress(),
			functionCode: r.functionCode,
			userAddress: r.userAddress,
			sentAddress: r.sentAddress,
			quantity: r.quantity,
			attempt: t,
			status: i,
			errorCode: a,
			exceptionCode: o,
			source: r.source,
			durationMs: this.options.clock.now() - n
		});
	}
	emitLog(e) {
		this.options.onLog?.(e);
	}
}, Hs = class {
	entries = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	session;
	clock;
	constructor(e, t) {
		this.session = e, this.clock = t;
	}
	onSample(e) {
		return this.listeners.add(e), () => this.listeners.delete(e);
	}
	start(e, t, n) {
		this.stop(e);
		let r = {
			key: e,
			address: t,
			speedMs: n,
			timer: null,
			inFlight: !1,
			sequence: 0
		};
		this.entries.set(e, r), this.schedule(r);
	}
	stop(e) {
		let t = this.entries.get(e);
		t !== void 0 && (t.timer?.cancel(), t.timer = null, this.entries.delete(e));
	}
	stopAll() {
		for (let e of [...this.entries.keys()]) this.stop(e);
	}
	schedule(e) {
		e.timer = this.clock.schedule(() => this.tick(e), e.speedMs);
	}
	tick(e) {
		if (this.entries.has(e.key)) {
			if (e.inFlight) {
				this.schedule(e);
				return;
			}
			e.inFlight = !0, this.session.readRegister(e.address, {
				source: "trace",
				priority: "polling"
			}).then((t) => {
				if (e.inFlight = !1, this.entries.has(e.key) && t.ok) {
					e.sequence += 1;
					let n = {
						key: e.key,
						sequence: e.sequence,
						rawValue: t.value,
						timestamp: this.clock.now()
					};
					for (let e of this.listeners) e(n);
				}
			}), this.schedule(e);
		}
	}
}, Us = {
	"unsigned-0.1": 1,
	"unsigned-0.01": 2,
	"unsigned-0.001": 3,
	"unsigned-0.0001": 4,
	"signed-0.1": 1,
	"signed-0.01": 2,
	"signed-0.001": 3,
	"signed-0.0001": 4
}, Ws = {
	DATA_EMPTY: "errors.dataEmpty",
	DATA_HEX_INVALID: "errors.dataInvalidNumber",
	DATA_HEX_TOO_LONG: "errors.dataOutOfRange",
	DATA_BINARY_INVALID: "errors.dataInvalidNumber",
	DATA_BINARY_TOO_LONG: "errors.dataOutOfRange",
	DATA_INVALID_NUMBER: "errors.dataInvalidNumber",
	DATA_TOO_MANY_DECIMALS: "errors.dataTooManyDecimals",
	DATA_OUT_OF_RANGE: "errors.dataOutOfRange",
	DATA_UNSUPPORTED_TYPE: "errors.internal"
};
function Z(e, t) {
	return l({
		code: e,
		category: "validation",
		userMessageKey: Ws[e] ?? "errors.internal",
		technicalMessage: t
	});
}
function Gs(e) {
	return Us[e] !== void 0;
}
function Ks(e) {
	return e === "signed" || e.startsWith("signed-");
}
function qs(e, t) {
	switch (t) {
		case "hex": return e.toString(16).toUpperCase().padStart(4, "0");
		case "binary": return e.toString(2).padStart(16, "0");
		case "unsigned": return String(e);
		case "signed": {
			let t = e >= 32768 ? e - 65536 : e;
			return String(t);
		}
		default:
			if (!Gs(t)) throw Error(`unsupported data type: ${String(t)}`);
			return Js(e, t);
	}
}
function Js(e, t) {
	let n = Us[t] ?? 0, r = 10 ** n, i = Ks(t) && e >= 32768 ? e - 65536 : e, a = i < 0 ? "-" : "", o = Math.abs(i);
	return `${a}${Math.trunc(o / r)}.${String(o % r).padStart(n, "0")}`;
}
function Ys(e, t) {
	let n = e.trim();
	if (n === "") return d(Z("DATA_EMPTY", "cell text is empty"));
	switch (t) {
		case "hex": return Xs(n);
		case "binary": return Zs(n);
		case "unsigned": return Qs(n, !1);
		case "signed": return Qs(n, !0);
		default: return Gs(t) ? $s(n, t) : d(Z("DATA_UNSUPPORTED_TYPE", `unsupported data type: ${String(t)}`));
	}
}
function Xs(e) {
	let t = e;
	return /^0[xX]/.test(t) && (t = t.slice(2)), /^[0-9a-fA-F]+$/.test(t) ? t.length > 4 ? d(Z("DATA_HEX_TOO_LONG", `hex input exceeds 4 digits: ${JSON.stringify(e)}`)) : u(Number.parseInt(t, 16)) : d(Z("DATA_HEX_INVALID", `invalid hex input: ${JSON.stringify(e)}`));
}
function Zs(e) {
	return /^[01]+$/.test(e) ? e.length > 16 ? d(Z("DATA_BINARY_TOO_LONG", `binary input exceeds 16 bits: ${JSON.stringify(e)}`)) : u(Number.parseInt(e, 2)) : d(Z("DATA_BINARY_INVALID", `binary input must only contain 0 and 1 without prefix or spaces: ${JSON.stringify(e)}`));
}
function Qs(e, t) {
	if (!/^[+-]?\d+$/.test(e)) return d(Z("DATA_INVALID_NUMBER", `invalid integer input: ${JSON.stringify(e)}`));
	let n = Number(e);
	return t ? n < -32768 || n > 32767 ? d(Z("DATA_OUT_OF_RANGE", `signed value out of range: ${e}`)) : u(n < 0 ? n + 65536 : n) : n < 0 || n > 65535 ? d(Z("DATA_OUT_OF_RANGE", `unsigned value out of range: ${e}`)) : u(n);
}
function $s(e, t) {
	let n = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(e);
	if (n === null) return d(Z("DATA_INVALID_NUMBER", `invalid decimal input: ${JSON.stringify(e)}`));
	let r = Us[t] ?? 0, i = 10 ** r, a = n[1] === "-" ? -1 : 1, o = n[2] ?? "0", s = n[3] ?? "";
	if (a === -1 && !Ks(t)) return d(Z("DATA_INVALID_NUMBER", `negative value not allowed for ${t}: ${e}`));
	if (s.length > r) return d(Z("DATA_TOO_MANY_DECIMALS", `${e} has ${s.length} decimals, ${t} allows ${r}`));
	if (o.length > 6) return d(Z("DATA_OUT_OF_RANGE", `value out of range: ${e}`));
	let c = a * (Number(o) * i + Number(s.padEnd(r, "0")));
	return Ks(t) ? c < -32768 || c > 32767 ? d(Z("DATA_OUT_OF_RANGE", `signed scaled value out of range: ${e}`)) : u(c < 0 ? c + 65536 : c) : c < 0 || c > 65535 ? d(Z("DATA_OUT_OF_RANGE", `unsigned scaled value out of range: ${e}`)) : u(c);
}
//#endregion
//#region ../../packages/register-table/src/address.ts
function ec(e, t) {
	return t === "on" ? e === 0 ? d(l({
		code: "ADDRESS_ADJUST_UNDERFLOW",
		category: "validation",
		userMessageKey: "errors.addressAdjustUnderflow",
		technicalMessage: "address 0 cannot be adjusted by -1"
	})) : u(e - 1) : u(e);
}
//#endregion
//#region ../../packages/register-table/src/row-operations.ts
function tc(e, t) {
	let n = f.create(t);
	return n.ok ? u({
		...e,
		cellText: qs(t, e.dataType),
		lastKnownRawValue: n.value,
		updatedAt: Date.now()
	}) : n;
}
//#endregion
//#region ../../packages/register-table/src/table-service.ts
function nc() {
	return l({
		code: "CONNECTION_NOT_CONNECTED",
		category: "connection",
		userMessageKey: "errors.notConnected",
		technicalMessage: "no active connection"
	});
}
function rc() {
	return l({
		code: "REGISTER_ADDRESS_EMPTY",
		category: "validation",
		userMessageKey: "errors.registerAddressEmpty",
		technicalMessage: "register address is empty"
	});
}
var ic = class {
	deps;
	constructor(e) {
		this.deps = e;
	}
	async readRow(e) {
		let t = this.deps.getSession();
		if (t === null) return d(nc());
		let n = e.addressValue?.value;
		if (n === void 0) return d(rc());
		let r = ec(n, this.deps.getAddressAdjustMode());
		return r.ok ? t.readRegister(r.value, {
			source: "manual-read",
			userAddress: n
		}) : r;
	}
	applyReadResult(e, t) {
		return tc(e, t);
	}
	async writeRow(e) {
		let t = this.deps.getSession();
		if (t === null) return d(nc());
		let n = e.addressValue?.value;
		if (n === void 0) return d(rc());
		let r = ec(n, this.deps.getAddressAdjustMode());
		if (!r.ok) return r;
		let i = Ys(e.cellText, e.dataType);
		return i.ok ? t.writeRegister(r.value, i.value, {
			source: "manual-write",
			userAddress: n
		}) : i;
	}
	static createRow() {
		return ce();
	}
}, ac = class {
	clock;
	events;
	tableService;
	getPollingIntervalMs;
	session = null;
	polling = null;
	trace = null;
	portLabel = null;
	pollingTargets = [];
	activeTraces = /* @__PURE__ */ new Map();
	constructor(e) {
		this.clock = e.clock, this.events = e.events, this.getPollingIntervalMs = e.getPollingIntervalMs, this.tableService = new ic({
			getSession: () => this.session,
			getAddressAdjustMode: e.getAddressAdjustMode
		});
	}
	async connect(e, t) {
		this.stopPolling(), this.trace?.stopAll(), await this.session?.disconnect(), this.portLabel = t;
		let n = await e.connect();
		if (!n.ok) return await e.disconnect(), n;
		this.session = e, this.polling = new xs(e, this.clock, { getIntervalMs: () => this.getPollingIntervalMs() }), this.polling.onResult((e, t, n) => this.events.onPollResult(e, t, n)), this.trace = new Hs(e, this.clock), this.trace.onSample((e) => this.events.onTraceSample(e)), this.pollingTargets.length > 0 && (this.polling.setTargets(this.pollingTargets), this.polling.start());
		for (let [e, t] of this.activeTraces) this.trace.start(e, t.address, t.speedMs);
		return u(void 0);
	}
	async disconnect() {
		this.stopPolling(), this.trace?.stopAll();
		let e = await this.session?.disconnect();
		return this.session = null, e ?? {
			ok: !0,
			value: void 0
		};
	}
	async dispose() {
		await this.disconnect(), this.polling = null, this.trace = null, this.portLabel = null;
	}
	getConnectionState() {
		return this.session?.getState() ?? "disconnected";
	}
	getPortLabel() {
		return this.portLabel;
	}
	setSlaveAddress(e) {
		this.session?.setSlaveAddress(e);
	}
	readRow(e) {
		return this.tableService.readRow(e);
	}
	writeRow(e) {
		return this.tableService.writeRow(e);
	}
	readAllRows(e) {
		return this.session === null ? {
			promise: Promise.resolve(d(l({
				code: "CONNECTION_NOT_CONNECTED",
				category: "connection",
				userMessageKey: "errors.notConnected",
				technicalMessage: "no active connection"
			}))),
			cancel: () => void 0
		} : new vs(this.session, this.clock).readAll(e, (e, t) => {
			this.events.onPollResult(e, 0, t);
		});
	}
	updatePollingTargets(e) {
		this.pollingTargets = e, this.polling?.setTargets(e), e.length > 0 && this.session !== null ? this.polling?.start() : this.polling?.stop();
	}
	startPolling() {
		this.pollingTargets.length > 0 && this.session !== null && this.polling?.start();
	}
	stopPolling() {
		this.polling?.stop();
	}
	traceStart(e, t, n) {
		this.activeTraces.set(e, {
			address: t,
			speedMs: n
		}), this.trace?.start(e, t, n);
	}
	traceStop(e) {
		this.activeTraces.delete(e), this.trace?.stop(e);
	}
	emitLog(e) {
		this.events.onLog(e);
	}
	emitStateChange(e) {
		e === "interrupted" && (this.stopPolling(), this.trace?.stopAll(), this.events.onMessage({
			timestamp: this.clock.now(),
			level: "error",
			messageKey: "messages.deviceDisconnected",
			detail: null
		})), this.events.onStateChange(e);
	}
}, oc = class {
	core;
	currentProfile = null;
	constructor(e) {
		this.core = new ac({
			clock: e.clock,
			events: e.events,
			getPollingIntervalMs: () => this.currentProfile?.interRequestDelayMs ?? 50,
			getAddressAdjustMode: () => "off"
		});
	}
	async connect(e) {
		this.currentProfile = e.profile;
		let t = new Vs({
			transport: e.transport,
			clock: this.core.clock,
			config: e.profile,
			protocol: "tcp",
			unitId: e.profile.unitId,
			onLog: (e) => this.core.emitLog(e),
			onStateChange: (e) => this.core.emitStateChange(e)
		});
		return this.core.connect(t, e.portLabel);
	}
	async disconnect() {
		return this.core.disconnect();
	}
	async dispose() {
		await this.core.dispose(), this.currentProfile = null;
	}
	getConnectionState() {
		return this.core.getConnectionState();
	}
	getProfile() {
		return this.currentProfile;
	}
	getPortLabel() {
		return this.core.getPortLabel();
	}
	readRow(e) {
		return this.core.readRow(e);
	}
	writeRow(e) {
		return this.core.writeRow(e);
	}
	readAllRows(e) {
		return this.core.readAllRows(e);
	}
	updatePollingTargets(e) {
		this.core.updatePollingTargets(e);
	}
	startPolling() {
		this.core.startPolling();
	}
	stopPolling() {
		this.core.stopPolling();
	}
	traceStart(e, t, n) {
		this.core.traceStart(e, t, n);
	}
	traceStop(e) {
		this.core.traceStop(e);
	}
}, sc = class {
	platform;
	tcp;
	constructor(e) {
		this.platform = e.platform, this.tcp = new oc({
			clock: e.platform.clock,
			events: e.events
		});
	}
	async connectTcp(e) {
		let t = await this.platform.openTcpTransport(e);
		return t.ok ? this.tcp.connect({
			profile: e,
			transport: t.value,
			portLabel: `${e.host}:${e.port}`
		}) : t;
	}
	disconnect() {
		return this.tcp.disconnect();
	}
	getConnectionState() {
		return this.tcp.getConnectionState();
	}
	readRow(e) {
		return this.tcp.readRow(e);
	}
	writeRow(e) {
		return this.tcp.writeRow(e);
	}
	readAllRows(e) {
		return this.tcp.readAllRows(e);
	}
	updatePollingTargets(e) {
		this.tcp.updatePollingTargets(e);
	}
	startPolling() {
		this.tcp.startPolling();
	}
	stopPolling() {
		this.tcp.stopPolling();
	}
	traceStart(e, t, n) {
		this.tcp.traceStart(e, t, n);
	}
	traceStop(e) {
		this.tcp.traceStop(e);
	}
	async dispose() {
		await this.tcp.dispose();
	}
};
//#endregion
//#region ../electron/src/main/serial-permissions.ts
function cc(e, t) {
	return !e && t !== void 0 && t.length > 0 ? [new URL(t).origin] : ["file://", "file:///"];
}
function lc(e) {
	if (e !== void 0) {
		if (e.startsWith("http://") || e.startsWith("https://")) try {
			return new URL(e).origin;
		} catch {
			return e;
		}
		return e;
	}
}
function uc(e) {
	return e.map((e) => ({
		portId: e.portId,
		label: e.portName ?? e.displayName ?? e.portId
	}));
}
function dc(e, t) {
	let n = t.allowedOrigins, r = (e) => {
		let t = lc(e);
		return t !== void 0 && n.includes(t);
	}, i = t.selectPort, a = null;
	return e.setPermissionCheckHandler((e, t, n, i) => t === "serial" && r(i.securityOrigin)), e.setDevicePermissionHandler((e) => e.deviceType === "serial" && r(e.origin)), e.on("select-serial-port", (e, n, r, o) => {
		if (e.preventDefault(), i !== void 0) {
			o(i(n));
			return;
		}
		a = {
			callback: o,
			sender: r
		}, t.onPortsAvailable?.(uc(n));
	}), { resolvePendingSelection(e, t) {
		if (a === null || a.sender !== t) return !1;
		let n = a.callback;
		return a = null, n(e), !0;
	} };
}
//#endregion
//#region ../electron/src/main/main.ts
var fc = a.dirname(o(import.meta.url)), pc = a.join(fc, "../apps/web/dist-electron/index.html"), Q = null, mc = 0, hc = null, gc = "disconnected", _c = null;
function vc(e) {
	Q !== null && !Q.isDestroyed() && Q.webContents.send(Qo, e);
}
function yc() {
	return _c === null && (_c = new sc({
		platform: new ye(),
		events: {
			onLog: (e) => vc({
				protocolVersion: 1,
				type: "event",
				messageId: $(),
				kind: "comm-log",
				payload: { event: qo(e) }
			}),
			onStateChange: (e) => vc({
				protocolVersion: 1,
				type: "event",
				messageId: $(),
				kind: "connection-state",
				payload: { state: e }
			}),
			onPollResult: (e, t, n) => vc({
				protocolVersion: 1,
				type: "event",
				messageId: $(),
				kind: "poll-result",
				payload: {
					key: e,
					address: t,
					result: ls(n)
				}
			}),
			onTraceSample: (e) => vc({
				protocolVersion: 1,
				type: "event",
				messageId: $(),
				kind: "trace-sample",
				payload: { sample: e }
			}),
			onMessage: (e) => vc({
				protocolVersion: 1,
				type: "event",
				messageId: $(),
				kind: "app-message",
				payload: { message: Xo(e) }
			})
		}
	})), _c;
}
function $() {
	return mc += 1, `evt-${Date.now()}-${mc}`;
}
var bc = {
	appVersion: () => t.getVersion(),
	isPackaged: () => t.isPackaged,
	windowCount: () => e.getAllWindows().length,
	connectionState: () => gc,
	uptimeMs: () => Math.round(process.uptime() * 1e3),
	clipboardWriteText: (e) => n.writeText(e),
	clipboardReadText: () => n.readText(),
	resolveSerialPortSelection: (e, t) => hc?.resolvePendingSelection(e, t) ?? !1,
	session: yc()
};
async function xc(e, t) {
	return gs(t, {
		isSenderMainWindow: e.sender === Q?.webContents,
		sender: e.sender,
		deps: bc
	});
}
function Sc() {
	let t = new e({
		width: 1280,
		height: 800,
		title: "mamep2026",
		webPreferences: {
			preload: a.join(fc, "preload.js"),
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !0
		}
	});
	Q = t, t.setMenu(null), t.on("closed", () => {
		Q = null;
	}), t.webContents.on("did-finish-load", () => {
		let e = {
			protocolVersion: 1,
			type: "event",
			messageId: $(),
			kind: "connection-state",
			payload: { state: "disconnected" }
		};
		t.webContents.send(Qo, e);
	}), process.env.VITE_DEV_SERVER_URL ? t.loadURL(process.env.VITE_DEV_SERVER_URL) : t.loadFile(pc);
}
t.whenReady().then(() => {
	hc = dc(i.defaultSession, {
		allowedOrigins: cc(t.isPackaged, process.env.VITE_DEV_SERVER_URL),
		onPortsAvailable: (e) => {
			let t = {
				protocolVersion: 1,
				type: "event",
				messageId: $(),
				kind: "serial-ports-available",
				payload: { ports: e }
			};
			Q?.webContents.send(Qo, t);
		}
	}), r.handle(Zo, xc), Sc(), t.on("activate", () => {
		e.getAllWindows().length === 0 && Sc();
	});
}), t.on("window-all-closed", () => {
	_c?.dispose(), process.platform !== "darwin" && t.quit();
});
//#endregion
export {};
