import { BrowserWindow as e, app as t, clipboard as n, ipcMain as r, session as i } from "electron";
import a from "node:path";
import { fileURLToPath as o } from "node:url";
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
var s;
function c(e, t, n) {
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
var l = class extends Error {
	constructor() {
		super("Encountered Promise during synchronous parse. Use .parseAsync() instead.");
	}
}, u = class extends Error {
	constructor(e) {
		super(`Encountered unidirectional transform during encode: ${e}`), this.name = "ZodEncodeError";
	}
};
(s = globalThis).__zod_globalConfig ?? (s.__zod_globalConfig = {});
var d = globalThis.__zod_globalConfig;
function f(e) {
	return e && Object.assign(d, e), d;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function p(e) {
	let t = Object.values(e).filter((e) => typeof e == "number");
	return Object.entries(e).filter(([e, n]) => t.indexOf(+e) === -1).map(([e, t]) => t);
}
function ee(e, t) {
	return typeof t == "bigint" ? t.toString() : t;
}
function m(e) {
	return { get value() {
		{
			let t = e();
			return Object.defineProperty(this, "value", { value: t }), t;
		}
	} };
}
function te(e) {
	return e == null;
}
function ne(e) {
	let t = +!!e.startsWith("^"), n = e.endsWith("$") ? e.length - 1 : e.length;
	return e.slice(t, n);
}
var re = /* @__PURE__*/ Symbol("evaluating");
function h(e, t, n) {
	let r;
	Object.defineProperty(e, t, {
		get() {
			if (r !== re) return r === void 0 && (r = re, r = n()), r;
		},
		set(n) {
			Object.defineProperty(e, t, { value: n });
		},
		configurable: !0
	});
}
function g(e, t, n) {
	Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	});
}
function _(...e) {
	let t = {};
	for (let n of e) {
		let e = Object.getOwnPropertyDescriptors(n);
		Object.assign(t, e);
	}
	return Object.defineProperties({}, t);
}
function ie(e) {
	return JSON.stringify(e);
}
function ae(e) {
	return e.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var oe = "captureStackTrace" in Error ? Error.captureStackTrace : (...e) => {};
function v(e) {
	return typeof e == "object" && !!e && !Array.isArray(e);
}
var se = /* @__PURE__*/ m(() => {
	if (d.jitless || typeof navigator < "u" && navigator?.userAgent?.includes("Cloudflare")) return !1;
	try {
		return Function(""), !0;
	} catch {
		return !1;
	}
});
function y(e) {
	if (v(e) === !1) return !1;
	let t = e.constructor;
	if (t === void 0 || typeof t != "function") return !0;
	let n = t.prototype;
	return v(n) !== !1 && Object.prototype.hasOwnProperty.call(n, "isPrototypeOf") !== !1;
}
function ce(e) {
	return y(e) ? { ...e } : Array.isArray(e) ? [...e] : e instanceof Map ? new Map(e) : e instanceof Set ? new Set(e) : e;
}
var le = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function b(e) {
	return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function x(e, t, n) {
	let r = new e._zod.constr(t ?? e._zod.def);
	return (!t || n?.parent) && (r._zod.parent = e), r;
}
function S(e) {
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
function ue(e) {
	return Object.keys(e).filter((t) => e[t]._zod.optin === "optional" && e[t]._zod.optout === "optional");
}
-Number.MAX_VALUE, Number.MAX_VALUE;
function de(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".pick() cannot be used on object schemas containing refinements");
	return x(e, _(e._zod.def, {
		get shape() {
			let e = {};
			for (let r in t) {
				if (!(r in n.shape)) throw Error(`Unrecognized key: "${r}"`);
				t[r] && (e[r] = n.shape[r]);
			}
			return g(this, "shape", e), e;
		},
		checks: []
	}));
}
function fe(e, t) {
	let n = e._zod.def, r = n.checks;
	if (r && r.length > 0) throw Error(".omit() cannot be used on object schemas containing refinements");
	return x(e, _(e._zod.def, {
		get shape() {
			let r = { ...e._zod.def.shape };
			for (let e in t) {
				if (!(e in n.shape)) throw Error(`Unrecognized key: "${e}"`);
				t[e] && delete r[e];
			}
			return g(this, "shape", r), r;
		},
		checks: []
	}));
}
function pe(e, t) {
	if (!y(t)) throw Error("Invalid input to extend: expected a plain object");
	let n = e._zod.def.checks;
	if (n && n.length > 0) {
		let n = e._zod.def.shape;
		for (let e in t) if (Object.getOwnPropertyDescriptor(n, e) !== void 0) throw Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return x(e, _(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return g(this, "shape", n), n;
	} }));
}
function me(e, t) {
	if (!y(t)) throw Error("Invalid input to safeExtend: expected a plain object");
	return x(e, _(e._zod.def, { get shape() {
		let n = {
			...e._zod.def.shape,
			...t
		};
		return g(this, "shape", n), n;
	} }));
}
function he(e, t) {
	if (e._zod.def.checks?.length) throw Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return x(e, _(e._zod.def, {
		get shape() {
			let n = {
				...e._zod.def.shape,
				...t._zod.def.shape
			};
			return g(this, "shape", n), n;
		},
		get catchall() {
			return t._zod.def.catchall;
		},
		checks: t._zod.def.checks ?? []
	}));
}
function ge(e, t, n) {
	let r = t._zod.def.checks;
	if (r && r.length > 0) throw Error(".partial() cannot be used on object schemas containing refinements");
	return x(t, _(t._zod.def, {
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
			return g(this, "shape", i), i;
		},
		checks: []
	}));
}
function _e(e, t, n) {
	return x(t, _(t._zod.def, { get shape() {
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
		return g(this, "shape", i), i;
	} }));
}
function C(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
	return !1;
}
function ve(e, t = 0) {
	if (e.aborted === !0) return !0;
	for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
	return !1;
}
function ye(e, t) {
	return t.map((t) => {
		var n;
		return (n = t).path ?? (n.path = []), t.path.unshift(e), t;
	});
}
function be(e) {
	return typeof e == "string" ? e : e?.message;
}
function w(e, t, n) {
	let r = e.message ? e.message : be(e.inst?._zod.def?.error?.(e)) ?? be(t?.error?.(e)) ?? be(n.customError?.(e)) ?? be(n.localeError?.(e)) ?? "Invalid input", { inst: i, continue: a, input: o, ...s } = e;
	return s.path ??= [], s.message = r, t?.reportInput && (s.input = o), s;
}
function xe(e) {
	return Array.isArray(e) ? "array" : typeof e == "string" ? "string" : "unknown";
}
function T(...e) {
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
var Se = (e, t) => {
	e.name = "$ZodError", Object.defineProperty(e, "_zod", {
		value: e._zod,
		enumerable: !1
	}), Object.defineProperty(e, "issues", {
		value: t,
		enumerable: !1
	}), e.message = JSON.stringify(t, ee, 2), Object.defineProperty(e, "toString", {
		value: () => e.message,
		enumerable: !1
	});
}, Ce = c("$ZodError", Se), we = c("$ZodError", Se, { Parent: Error });
function Te(e, t = (e) => e.message) {
	let n = {}, r = [];
	for (let i of e.issues) i.path.length > 0 ? (n[i.path[0]] = n[i.path[0]] || [], n[i.path[0]].push(t(i))) : r.push(t(i));
	return {
		formErrors: r,
		fieldErrors: n
	};
}
function Ee(e, t = (e) => e.message) {
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
var De = (e) => (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !1
	} : { async: !1 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise) throw new l();
	if (o.issues.length) {
		let t = new ((i?.Err) ?? e)(o.issues.map((e) => w(e, a, f())));
		throw oe(t, i?.callee), t;
	}
	return o.value;
}, Oe = (e) => async (t, n, r, i) => {
	let a = r ? {
		...r,
		async: !0
	} : { async: !0 }, o = t._zod.run({
		value: n,
		issues: []
	}, a);
	if (o instanceof Promise && (o = await o), o.issues.length) {
		let t = new ((i?.Err) ?? e)(o.issues.map((e) => w(e, a, f())));
		throw oe(t, i?.callee), t;
	}
	return o.value;
}, E = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		async: !1
	} : { async: !1 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	if (a instanceof Promise) throw new l();
	return a.issues.length ? {
		success: !1,
		error: new (e ?? Ce)(a.issues.map((e) => w(e, i, f())))
	} : {
		success: !0,
		data: a.value
	};
}, ke = /* @__PURE__*/ E(we), D = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		async: !0
	} : { async: !0 }, a = t._zod.run({
		value: n,
		issues: []
	}, i);
	return a instanceof Promise && (a = await a), a.issues.length ? {
		success: !1,
		error: new e(a.issues.map((e) => w(e, i, f())))
	} : {
		success: !0,
		data: a.value
	};
}, Ae = /* @__PURE__*/ D(we), je = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return De(e)(t, n, i);
}, Me = (e) => (t, n, r) => De(e)(t, n, r), Ne = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return Oe(e)(t, n, i);
}, Pe = (e) => async (t, n, r) => Oe(e)(t, n, r), Fe = (e) => (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return E(e)(t, n, i);
}, Ie = (e) => (t, n, r) => E(e)(t, n, r), Le = (e) => async (t, n, r) => {
	let i = r ? {
		...r,
		direction: "backward"
	} : { direction: "backward" };
	return D(e)(t, n, i);
}, Re = (e) => async (t, n, r) => D(e)(t, n, r), ze = /^[cC][0-9a-z]{6,}$/, Be = /^[0-9a-z]+$/, Ve = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/, He = /^[0-9a-vA-V]{20}$/, Ue = /^[A-Za-z0-9]{27}$/, We = /^[a-zA-Z0-9_-]{21}$/, Ge = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/, Ke = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, qe = (e) => e ? RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/, Je = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/, Ye = "^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$";
function Xe() {
	return new RegExp(Ye, "u");
}
var Ze = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/, Qe = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/, $e = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/, et = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/, tt = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/, nt = /^[A-Za-z0-9_-]*$/, rt = /^https?$/, it = /^\+[1-9]\d{6,14}$/, at = "(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))", ot = /*@__PURE__*/ RegExp(`^${at}$`);
function st(e) {
	let t = "(?:[01]\\d|2[0-3]):[0-5]\\d";
	return typeof e.precision == "number" ? e.precision === -1 ? `${t}` : e.precision === 0 ? `${t}:[0-5]\\d` : `${t}:[0-5]\\d\\.\\d{${e.precision}}` : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function ct(e) {
	return RegExp(`^${st(e)}$`);
}
function lt(e) {
	let t = st({ precision: e.precision }), n = ["Z"];
	e.local && n.push(""), e.offset && n.push("([+-](?:[01]\\d|2[0-3]):[0-5]\\d)");
	let r = `${t}(?:${n.join("|")})`;
	return RegExp(`^${at}T(?:${r})$`);
}
var ut = (e) => {
	let t = e ? `[\\s\\S]{${e?.minimum ?? 0},${e?.maximum ?? ""}}` : "[\\s\\S]*";
	return RegExp(`^${t}$`);
}, dt = /^(?:true|false)$/i, ft = /^[^A-Z]*$/, pt = /^[^a-z]*$/, O = /*@__PURE__*/ c("$ZodCheck", (e, t) => {
	var n;
	e._zod ??= {}, e._zod.def = t, (n = e._zod).onattach ?? (n.onattach = []);
}), mt = /*@__PURE__*/ c("$ZodCheckMaxLength", (e, t) => {
	var n;
	O.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !te(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.maximum ?? Infinity;
		t.maximum < n && (e._zod.bag.maximum = t.maximum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length <= t.maximum) return;
		let i = xe(r);
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
}), ht = /*@__PURE__*/ c("$ZodCheckMinLength", (e, t) => {
	var n;
	O.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !te(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag.minimum ?? -Infinity;
		t.minimum > n && (e._zod.bag.minimum = t.minimum);
	}), e._zod.check = (n) => {
		let r = n.value;
		if (r.length >= t.minimum) return;
		let i = xe(r);
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
}), gt = /*@__PURE__*/ c("$ZodCheckLengthEquals", (e, t) => {
	var n;
	O.init(e, t), (n = e._zod.def).when ?? (n.when = (e) => {
		let t = e.value;
		return !te(t) && t.length !== void 0;
	}), e._zod.onattach.push((e) => {
		let n = e._zod.bag;
		n.minimum = t.length, n.maximum = t.length, n.length = t.length;
	}), e._zod.check = (n) => {
		let r = n.value, i = r.length;
		if (i === t.length) return;
		let a = xe(r), o = i > t.length;
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
}), k = /*@__PURE__*/ c("$ZodCheckStringFormat", (e, t) => {
	var n, r;
	O.init(e, t), e._zod.onattach.push((e) => {
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
}), _t = /*@__PURE__*/ c("$ZodCheckRegex", (e, t) => {
	k.init(e, t), e._zod.check = (n) => {
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
}), vt = /*@__PURE__*/ c("$ZodCheckLowerCase", (e, t) => {
	t.pattern ??= ft, k.init(e, t);
}), yt = /*@__PURE__*/ c("$ZodCheckUpperCase", (e, t) => {
	t.pattern ??= pt, k.init(e, t);
}), bt = /*@__PURE__*/ c("$ZodCheckIncludes", (e, t) => {
	O.init(e, t);
	let n = b(t.includes), r = new RegExp(typeof t.position == "number" ? `^.{${t.position}}${n}` : n);
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
}), xt = /*@__PURE__*/ c("$ZodCheckStartsWith", (e, t) => {
	O.init(e, t);
	let n = RegExp(`^${b(t.prefix)}.*`);
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
}), St = /*@__PURE__*/ c("$ZodCheckEndsWith", (e, t) => {
	O.init(e, t);
	let n = RegExp(`.*${b(t.suffix)}$`);
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
}), Ct = /*@__PURE__*/ c("$ZodCheckOverwrite", (e, t) => {
	O.init(e, t), e._zod.check = (e) => {
		e.value = t.tx(e.value);
	};
}), wt = class {
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
}, Tt = {
	major: 4,
	minor: 4,
	patch: 3
}, A = /*@__PURE__*/ c("$ZodType", (e, t) => {
	var n;
	e ??= {}, e._zod.def = t, e._zod.bag = e._zod.bag || {}, e._zod.version = Tt;
	let r = [...e._zod.def.checks ?? []];
	e._zod.traits.has("$ZodCheck") && r.unshift(e);
	for (let t of r) for (let n of t._zod.onattach) n(e);
	if (r.length === 0) (n = e._zod).deferred ?? (n.deferred = []), e._zod.deferred?.push(() => {
		e._zod.run = e._zod.parse;
	});
	else {
		let t = (e, t, n) => {
			let r = C(e), i;
			for (let a of t) {
				if (a._zod.def.when) {
					if (ve(e) || !a._zod.def.when(e)) continue;
				} else if (r) continue;
				let t = e.issues.length, o = a._zod.check(e);
				if (o instanceof Promise && n?.async === !1) throw new l();
				if (i || o instanceof Promise) i = (i ?? Promise.resolve()).then(async () => {
					await o, e.issues.length !== t && (r ||= C(e, t));
				});
				else {
					if (e.issues.length === t) continue;
					r ||= C(e, t);
				}
			}
			return i ? i.then(() => e) : e;
		}, n = (n, i, a) => {
			if (C(n)) return n.aborted = !0, n;
			let o = t(i, r, a);
			if (o instanceof Promise) {
				if (a.async === !1) throw new l();
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
				if (a.async === !1) throw new l();
				return o.then((e) => t(e, r, a));
			}
			return t(o, r, a);
		};
	}
	h(e, "~standard", () => ({
		validate: (t) => {
			try {
				let n = ke(e, t);
				return n.success ? { value: n.data } : { issues: n.error?.issues };
			} catch {
				return Ae(e, t).then((e) => e.success ? { value: e.data } : { issues: e.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
}), Et = /*@__PURE__*/ c("$ZodString", (e, t) => {
	A.init(e, t), e._zod.pattern = [...e?._zod.bag?.patterns ?? []].pop() ?? ut(e._zod.bag), e._zod.parse = (n, r) => {
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
}), j = /*@__PURE__*/ c("$ZodStringFormat", (e, t) => {
	k.init(e, t), Et.init(e, t);
}), Dt = /*@__PURE__*/ c("$ZodGUID", (e, t) => {
	t.pattern ??= Ke, j.init(e, t);
}), Ot = /*@__PURE__*/ c("$ZodUUID", (e, t) => {
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
		t.pattern ??= qe(e);
	} else t.pattern ??= qe();
	j.init(e, t);
}), kt = /*@__PURE__*/ c("$ZodEmail", (e, t) => {
	t.pattern ??= Je, j.init(e, t);
}), At = /*@__PURE__*/ c("$ZodURL", (e, t) => {
	j.init(e, t), e._zod.check = (n) => {
		try {
			let r = n.value.trim();
			if (!t.normalize && t.protocol?.source === rt.source && !/^https?:\/\//i.test(r)) {
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
}), jt = /*@__PURE__*/ c("$ZodEmoji", (e, t) => {
	t.pattern ??= Xe(), j.init(e, t);
}), Mt = /*@__PURE__*/ c("$ZodNanoID", (e, t) => {
	t.pattern ??= We, j.init(e, t);
}), Nt = /*@__PURE__*/ c("$ZodCUID", (e, t) => {
	t.pattern ??= ze, j.init(e, t);
}), Pt = /*@__PURE__*/ c("$ZodCUID2", (e, t) => {
	t.pattern ??= Be, j.init(e, t);
}), Ft = /*@__PURE__*/ c("$ZodULID", (e, t) => {
	t.pattern ??= Ve, j.init(e, t);
}), It = /*@__PURE__*/ c("$ZodXID", (e, t) => {
	t.pattern ??= He, j.init(e, t);
}), Lt = /*@__PURE__*/ c("$ZodKSUID", (e, t) => {
	t.pattern ??= Ue, j.init(e, t);
}), Rt = /*@__PURE__*/ c("$ZodISODateTime", (e, t) => {
	t.pattern ??= lt(t), j.init(e, t);
}), zt = /*@__PURE__*/ c("$ZodISODate", (e, t) => {
	t.pattern ??= ot, j.init(e, t);
}), Bt = /*@__PURE__*/ c("$ZodISOTime", (e, t) => {
	t.pattern ??= ct(t), j.init(e, t);
}), Vt = /*@__PURE__*/ c("$ZodISODuration", (e, t) => {
	t.pattern ??= Ge, j.init(e, t);
}), Ht = /*@__PURE__*/ c("$ZodIPv4", (e, t) => {
	t.pattern ??= Ze, j.init(e, t), e._zod.bag.format = "ipv4";
}), Ut = /*@__PURE__*/ c("$ZodIPv6", (e, t) => {
	t.pattern ??= Qe, j.init(e, t), e._zod.bag.format = "ipv6", e._zod.check = (n) => {
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
}), Wt = /*@__PURE__*/ c("$ZodCIDRv4", (e, t) => {
	t.pattern ??= $e, j.init(e, t);
}), Gt = /*@__PURE__*/ c("$ZodCIDRv6", (e, t) => {
	t.pattern ??= et, j.init(e, t), e._zod.check = (n) => {
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
function Kt(e) {
	if (e === "") return !0;
	if (/\s/.test(e) || e.length % 4 != 0) return !1;
	try {
		return atob(e), !0;
	} catch {
		return !1;
	}
}
var qt = /*@__PURE__*/ c("$ZodBase64", (e, t) => {
	t.pattern ??= tt, j.init(e, t), e._zod.bag.contentEncoding = "base64", e._zod.check = (n) => {
		Kt(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
});
function Jt(e) {
	if (!nt.test(e)) return !1;
	let t = e.replace(/[-_]/g, (e) => e === "-" ? "+" : "/");
	return Kt(t.padEnd(Math.ceil(t.length / 4) * 4, "="));
}
var Yt = /*@__PURE__*/ c("$ZodBase64URL", (e, t) => {
	t.pattern ??= nt, j.init(e, t), e._zod.bag.contentEncoding = "base64url", e._zod.check = (n) => {
		Jt(n.value) || n.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), Xt = /*@__PURE__*/ c("$ZodE164", (e, t) => {
	t.pattern ??= it, j.init(e, t);
});
function Zt(e, t = null) {
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
var Qt = /*@__PURE__*/ c("$ZodJWT", (e, t) => {
	j.init(e, t), e._zod.check = (n) => {
		Zt(n.value, t.alg) || n.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: n.value,
			inst: e,
			continue: !t.abort
		});
	};
}), $t = /*@__PURE__*/ c("$ZodBoolean", (e, t) => {
	A.init(e, t), e._zod.pattern = dt, e._zod.parse = (n, r) => {
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
}), en = /*@__PURE__*/ c("$ZodUnknown", (e, t) => {
	A.init(e, t), e._zod.parse = (e) => e;
}), tn = /*@__PURE__*/ c("$ZodNever", (e, t) => {
	A.init(e, t), e._zod.parse = (t, n) => (t.issues.push({
		expected: "never",
		code: "invalid_type",
		input: t.value,
		inst: e
	}), t);
});
function nn(e, t, n) {
	e.issues.length && t.issues.push(...ye(n, e.issues)), t.value[n] = e.value;
}
var rn = /*@__PURE__*/ c("$ZodArray", (e, t) => {
	A.init(e, t), e._zod.parse = (n, r) => {
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
			s instanceof Promise ? a.push(s.then((t) => nn(t, n, e))) : nn(s, n, e);
		}
		return a.length ? Promise.all(a).then(() => n) : n;
	};
});
function M(e, t, n, r, i, a) {
	let o = n in r;
	if (e.issues.length) {
		if (i && a && !o) return;
		t.issues.push(...ye(n, e.issues));
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
function an(e) {
	let t = Object.keys(e.shape);
	for (let n of t) if (!e.shape?.[n]?._zod?.traits?.has("$ZodType")) throw Error(`Invalid element at key "${n}": expected a Zod schema`);
	let n = ue(e.shape);
	return {
		...e,
		keys: t,
		keySet: new Set(t),
		numKeys: t.length,
		optionalKeys: new Set(n)
	};
}
function on(e, t, n, r, i, a) {
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
		a instanceof Promise ? e.push(a.then((e) => M(e, n, i, t, u, d))) : M(a, n, i, t, u, d);
	}
	return o.length && n.issues.push({
		code: "unrecognized_keys",
		keys: o,
		input: t,
		inst: a
	}), e.length ? Promise.all(e).then(() => n) : n;
}
var sn = /*@__PURE__*/ c("$ZodObject", (e, t) => {
	if (A.init(e, t), !Object.getOwnPropertyDescriptor(t, "shape")?.get) {
		let e = t.shape;
		Object.defineProperty(t, "shape", { get: () => {
			let n = { ...e };
			return Object.defineProperty(t, "shape", { value: n }), n;
		} });
	}
	let n = m(() => an(t));
	h(e._zod, "propValues", () => {
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
	let r = v, i = t.catchall, a;
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
			a instanceof Promise ? c.push(a.then((n) => M(n, t, e, s, r, i))) : M(a, t, e, s, r, i);
		}
		return i ? on(c, s, t, o, n.value, e) : c.length ? Promise.all(c).then(() => t) : t;
	};
}), cn = /*@__PURE__*/ c("$ZodObjectJIT", (e, t) => {
	sn.init(e, t);
	let n = e._zod.parse, r = m(() => an(t)), i = (e) => {
		let t = new wt([
			"shape",
			"payload",
			"ctx"
		]), n = r.value, i = (e) => {
			let t = ie(e);
			return `shape[${t}]._zod.run({ value: input[${t}], issues: [] }, ctx)`;
		};
		t.write("const input = payload.value;");
		let a = Object.create(null), o = 0;
		for (let e of n.keys) a[e] = `key_${o++}`;
		t.write("const newResult = {};");
		for (let r of n.keys) {
			let n = a[r], o = ie(r), s = e[r], c = s?._zod?.optin === "optional", l = s?._zod?.optout === "optional";
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
	}, a, o = v, s = !d.jitless, c = s && se.value, l = t.catchall, u;
	e._zod.parse = (d, f) => {
		u ??= r.value;
		let p = d.value;
		return o(p) ? s && c && f?.async === !1 && f.jitless !== !0 ? (a ||= i(t.shape), d = a(d, f), l ? on([], p, d, f, u, e) : d) : n(d, f) : (d.issues.push({
			expected: "object",
			code: "invalid_type",
			input: p,
			inst: e
		}), d);
	};
});
function ln(e, t, n, r) {
	for (let n of e) if (n.issues.length === 0) return t.value = n.value, t;
	let i = e.filter((e) => !C(e));
	return i.length === 1 ? (t.value = i[0].value, i[0]) : (t.issues.push({
		code: "invalid_union",
		input: t.value,
		inst: n,
		errors: e.map((e) => e.issues.map((e) => w(e, r, f())))
	}), t);
}
var un = /*@__PURE__*/ c("$ZodUnion", (e, t) => {
	A.init(e, t), h(e._zod, "optin", () => t.options.some((e) => e._zod.optin === "optional") ? "optional" : void 0), h(e._zod, "optout", () => t.options.some((e) => e._zod.optout === "optional") ? "optional" : void 0), h(e._zod, "values", () => {
		if (t.options.every((e) => e._zod.values)) return new Set(t.options.flatMap((e) => Array.from(e._zod.values)));
	}), h(e._zod, "pattern", () => {
		if (t.options.every((e) => e._zod.pattern)) {
			let e = t.options.map((e) => e._zod.pattern);
			return RegExp(`^(${e.map((e) => ne(e.source)).join("|")})$`);
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
		return a ? Promise.all(o).then((t) => ln(t, r, e, i)) : ln(o, r, e, i);
	};
}), dn = /*@__PURE__*/ c("$ZodDiscriminatedUnion", (e, t) => {
	t.inclusive = !1, un.init(e, t);
	let n = e._zod.parse;
	h(e._zod, "propValues", () => {
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
	let r = m(() => {
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
		if (!v(o)) return i.issues.push({
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
}), fn = /*@__PURE__*/ c("$ZodIntersection", (e, t) => {
	A.init(e, t), e._zod.parse = (e, n) => {
		let r = e.value, i = t.left._zod.run({
			value: r,
			issues: []
		}, n), a = t.right._zod.run({
			value: r,
			issues: []
		}, n);
		return i instanceof Promise || a instanceof Promise ? Promise.all([i, a]).then(([t, n]) => mn(e, t, n)) : mn(e, i, a);
	};
});
function pn(e, t) {
	if (e === t || e instanceof Date && t instanceof Date && +e == +t) return {
		valid: !0,
		data: e
	};
	if (y(e) && y(t)) {
		let n = Object.keys(t), r = Object.keys(e).filter((e) => n.indexOf(e) !== -1), i = {
			...e,
			...t
		};
		for (let n of r) {
			let r = pn(e[n], t[n]);
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
			let i = e[r], a = t[r], o = pn(i, a);
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
function mn(e, t, n) {
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
	}), C(e)) return e;
	let o = pn(t.value, n.value);
	if (!o.valid) throw Error(`Unmergable intersection. Error path: ${JSON.stringify(o.mergeErrorPath)}`);
	return e.value = o.data, e;
}
var hn = /*@__PURE__*/ c("$ZodEnum", (e, t) => {
	A.init(e, t);
	let n = p(t.entries), r = new Set(n);
	e._zod.values = r, e._zod.pattern = RegExp(`^(${n.filter((e) => le.has(typeof e)).map((e) => typeof e == "string" ? b(e) : e.toString()).join("|")})$`), e._zod.parse = (t, i) => {
		let a = t.value;
		return r.has(a) || t.issues.push({
			code: "invalid_value",
			values: n,
			input: a,
			inst: e
		}), t;
	};
}), gn = /*@__PURE__*/ c("$ZodLiteral", (e, t) => {
	if (A.init(e, t), t.values.length === 0) throw Error("Cannot create literal schema with no valid values");
	let n = new Set(t.values);
	e._zod.values = n, e._zod.pattern = RegExp(`^(${t.values.map((e) => typeof e == "string" ? b(e) : e ? b(e.toString()) : String(e)).join("|")})$`), e._zod.parse = (r, i) => {
		let a = r.value;
		return n.has(a) || r.issues.push({
			code: "invalid_value",
			values: t.values,
			input: a,
			inst: e
		}), r;
	};
}), _n = /*@__PURE__*/ c("$ZodTransform", (e, t) => {
	A.init(e, t), e._zod.optin = "optional", e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new u(e.constructor.name);
		let i = t.transform(n.value, n);
		if (r.async) return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => (n.value = e, n.fallback = !0, n));
		if (i instanceof Promise) throw new l();
		return n.value = i, n.fallback = !0, n;
	};
});
function vn(e, t) {
	return t === void 0 && (e.issues.length || e.fallback) ? {
		issues: [],
		value: void 0
	} : e;
}
var yn = /*@__PURE__*/ c("$ZodOptional", (e, t) => {
	A.init(e, t), e._zod.optin = "optional", e._zod.optout = "optional", h(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, void 0]) : void 0), h(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${ne(e.source)})?$`) : void 0;
	}), e._zod.parse = (e, n) => {
		if (t.innerType._zod.optin === "optional") {
			let r = e.value, i = t.innerType._zod.run(e, n);
			return i instanceof Promise ? i.then((e) => vn(e, r)) : vn(i, r);
		}
		return e.value === void 0 ? e : t.innerType._zod.run(e, n);
	};
}), bn = /*@__PURE__*/ c("$ZodExactOptional", (e, t) => {
	yn.init(e, t), h(e._zod, "values", () => t.innerType._zod.values), h(e._zod, "pattern", () => t.innerType._zod.pattern), e._zod.parse = (e, n) => t.innerType._zod.run(e, n);
}), xn = /*@__PURE__*/ c("$ZodNullable", (e, t) => {
	A.init(e, t), h(e._zod, "optin", () => t.innerType._zod.optin), h(e._zod, "optout", () => t.innerType._zod.optout), h(e._zod, "pattern", () => {
		let e = t.innerType._zod.pattern;
		return e ? RegExp(`^(${ne(e.source)}|null)$`) : void 0;
	}), h(e._zod, "values", () => t.innerType._zod.values ? /* @__PURE__ */ new Set([...t.innerType._zod.values, null]) : void 0), e._zod.parse = (e, n) => e.value === null ? e : t.innerType._zod.run(e, n);
}), Sn = /*@__PURE__*/ c("$ZodDefault", (e, t) => {
	A.init(e, t), e._zod.optin = "optional", h(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		if (e.value === void 0) return e.value = t.defaultValue, e;
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => Cn(e, t)) : Cn(r, t);
	};
});
function Cn(e, t) {
	return e.value === void 0 && (e.value = t.defaultValue), e;
}
var wn = /*@__PURE__*/ c("$ZodPrefault", (e, t) => {
	A.init(e, t), e._zod.optin = "optional", h(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => (n.direction === "backward" || e.value === void 0 && (e.value = t.defaultValue), t.innerType._zod.run(e, n));
}), Tn = /*@__PURE__*/ c("$ZodNonOptional", (e, t) => {
	A.init(e, t), h(e._zod, "values", () => {
		let e = t.innerType._zod.values;
		return e ? new Set([...e].filter((e) => e !== void 0)) : void 0;
	}), e._zod.parse = (n, r) => {
		let i = t.innerType._zod.run(n, r);
		return i instanceof Promise ? i.then((t) => En(t, e)) : En(i, e);
	};
});
function En(e, t) {
	return !e.issues.length && e.value === void 0 && e.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: e.value,
		inst: t
	}), e;
}
var Dn = /*@__PURE__*/ c("$ZodCatch", (e, t) => {
	A.init(e, t), e._zod.optin = "optional", h(e._zod, "optout", () => t.innerType._zod.optout), h(e._zod, "values", () => t.innerType._zod.values), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then((r) => (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => w(e, n, f())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e)) : (e.value = r.value, r.issues.length && (e.value = t.catchValue({
			...e,
			error: { issues: r.issues.map((e) => w(e, n, f())) },
			input: e.value
		}), e.issues = [], e.fallback = !0), e);
	};
}), On = /*@__PURE__*/ c("$ZodPipe", (e, t) => {
	A.init(e, t), h(e._zod, "values", () => t.in._zod.values), h(e._zod, "optin", () => t.in._zod.optin), h(e._zod, "optout", () => t.out._zod.optout), h(e._zod, "propValues", () => t.in._zod.propValues), e._zod.parse = (e, n) => {
		if (n.direction === "backward") {
			let r = t.out._zod.run(e, n);
			return r instanceof Promise ? r.then((e) => N(e, t.in, n)) : N(r, t.in, n);
		}
		let r = t.in._zod.run(e, n);
		return r instanceof Promise ? r.then((e) => N(e, t.out, n)) : N(r, t.out, n);
	};
});
function N(e, t, n) {
	return e.issues.length ? (e.aborted = !0, e) : t._zod.run({
		value: e.value,
		issues: e.issues,
		fallback: e.fallback
	}, n);
}
var kn = /*@__PURE__*/ c("$ZodReadonly", (e, t) => {
	A.init(e, t), h(e._zod, "propValues", () => t.innerType._zod.propValues), h(e._zod, "values", () => t.innerType._zod.values), h(e._zod, "optin", () => t.innerType?._zod?.optin), h(e._zod, "optout", () => t.innerType?._zod?.optout), e._zod.parse = (e, n) => {
		if (n.direction === "backward") return t.innerType._zod.run(e, n);
		let r = t.innerType._zod.run(e, n);
		return r instanceof Promise ? r.then(An) : An(r);
	};
});
function An(e) {
	return e.value = Object.freeze(e.value), e;
}
var jn = /*@__PURE__*/ c("$ZodCustom", (e, t) => {
	O.init(e, t), A.init(e, t), e._zod.parse = (e, t) => e, e._zod.check = (n) => {
		let r = n.value, i = t.fn(r);
		if (i instanceof Promise) return i.then((t) => Mn(t, n, r, e));
		Mn(i, n, r, e);
	};
});
function Mn(e, t, n, r) {
	if (!e) {
		let e = {
			code: "custom",
			input: n,
			inst: r,
			path: [...r._zod.def.path ?? []],
			continue: !r._zod.def.abort
		};
		r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(T(e));
	}
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var Nn, Pn = class {
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
function Fn() {
	return new Pn();
}
(Nn = globalThis).__zod_globalRegistry ?? (Nn.__zod_globalRegistry = Fn());
var P = globalThis.__zod_globalRegistry;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function In(e, t) {
	return new e({
		type: "string",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Ln(e, t) {
	return new e({
		type: "string",
		format: "email",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Rn(e, t) {
	return new e({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function zn(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Bn(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v4",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Vn(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v6",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Hn(e, t) {
	return new e({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: !1,
		version: "v7",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Un(e, t) {
	return new e({
		type: "string",
		format: "url",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Wn(e, t) {
	return new e({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Gn(e, t) {
	return new e({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Kn(e, t) {
	return new e({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function qn(e, t) {
	return new e({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Jn(e, t) {
	return new e({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Yn(e, t) {
	return new e({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Xn(e, t) {
	return new e({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Zn(e, t) {
	return new e({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function Qn(e, t) {
	return new e({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function $n(e, t) {
	return new e({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function er(e, t) {
	return new e({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function tr(e, t) {
	return new e({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function nr(e, t) {
	return new e({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function rr(e, t) {
	return new e({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ir(e, t) {
	return new e({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: !1,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ar(e, t) {
	return new e({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: !1,
		local: !1,
		precision: null,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function or(e, t) {
	return new e({
		type: "string",
		format: "date",
		check: "string_format",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function sr(e, t) {
	return new e({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function cr(e, t) {
	return new e({
		type: "string",
		format: "duration",
		check: "string_format",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function lr(e, t) {
	return new e({
		type: "boolean",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function ur(e) {
	return new e({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function dr(e, t) {
	return new e({
		type: "never",
		...S(t)
	});
}
// @__NO_SIDE_EFFECTS__
function fr(e, t) {
	return new mt({
		check: "max_length",
		...S(t),
		maximum: e
	});
}
// @__NO_SIDE_EFFECTS__
function F(e, t) {
	return new ht({
		check: "min_length",
		...S(t),
		minimum: e
	});
}
// @__NO_SIDE_EFFECTS__
function pr(e, t) {
	return new gt({
		check: "length_equals",
		...S(t),
		length: e
	});
}
// @__NO_SIDE_EFFECTS__
function mr(e, t) {
	return new _t({
		check: "string_format",
		format: "regex",
		...S(t),
		pattern: e
	});
}
// @__NO_SIDE_EFFECTS__
function hr(e) {
	return new vt({
		check: "string_format",
		format: "lowercase",
		...S(e)
	});
}
// @__NO_SIDE_EFFECTS__
function gr(e) {
	return new yt({
		check: "string_format",
		format: "uppercase",
		...S(e)
	});
}
// @__NO_SIDE_EFFECTS__
function _r(e, t) {
	return new bt({
		check: "string_format",
		format: "includes",
		...S(t),
		includes: e
	});
}
// @__NO_SIDE_EFFECTS__
function vr(e, t) {
	return new xt({
		check: "string_format",
		format: "starts_with",
		...S(t),
		prefix: e
	});
}
// @__NO_SIDE_EFFECTS__
function yr(e, t) {
	return new St({
		check: "string_format",
		format: "ends_with",
		...S(t),
		suffix: e
	});
}
// @__NO_SIDE_EFFECTS__
function I(e) {
	return new Ct({
		check: "overwrite",
		tx: e
	});
}
// @__NO_SIDE_EFFECTS__
function br(e) {
	return /* @__PURE__ */ I((t) => t.normalize(e));
}
// @__NO_SIDE_EFFECTS__
function xr() {
	return /* @__PURE__ */ I((e) => e.trim());
}
// @__NO_SIDE_EFFECTS__
function Sr() {
	return /* @__PURE__ */ I((e) => e.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function Cr() {
	return /* @__PURE__ */ I((e) => e.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function wr() {
	return /* @__PURE__ */ I((e) => ae(e));
}
// @__NO_SIDE_EFFECTS__
function Tr(e, t, n) {
	return new e({
		type: "array",
		element: t,
		...S(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Er(e, t, n) {
	return new e({
		type: "custom",
		check: "custom",
		fn: t,
		...S(n)
	});
}
// @__NO_SIDE_EFFECTS__
function Dr(e, t) {
	let n = /* @__PURE__ */ Or((t) => (t.addIssue = (e) => {
		if (typeof e == "string") t.issues.push(T(e, t.value, n._zod.def));
		else {
			let r = e;
			r.fatal && (r.continue = !1), r.code ??= "custom", r.input ??= t.value, r.inst ??= n, r.continue ??= !n._zod.def.abort, t.issues.push(T(r));
		}
	}, e(t.value, t)), t);
	return n;
}
// @__NO_SIDE_EFFECTS__
function Or(e, t) {
	let n = new O({
		check: "custom",
		...S(t)
	});
	return n._zod.check = e, n;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function kr(e) {
	let t = e?.target ?? "draft-2020-12";
	return t === "draft-4" && (t = "draft-04"), t === "draft-7" && (t = "draft-07"), {
		processors: e.processors ?? {},
		metadataRegistry: e?.metadata ?? P,
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
function L(e, t, n = {
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
		a && (o.ref ||= a, L(a, t, r), t.seen.get(a).isParent = !0);
	}
	let c = t.metadataRegistry.get(e);
	return c && Object.assign(o.schema, c), t.io === "input" && R(e) && (delete o.schema.examples, delete o.schema.default), t.io === "input" && "_prefault" in o.schema && ((r = o.schema).default ?? (r.default = o.schema._prefault)), delete o.schema._prefault, t.seen.get(e).schema;
}
function Ar(e, t) {
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
function jr(e, t) {
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
					input: z(t, "input", e.processors),
					output: z(t, "output", e.processors)
				}
			},
			enumerable: !1,
			writable: !1
		}), n;
	} catch {
		throw Error("Error converting schema to JSON.");
	}
}
function R(e, t) {
	let n = t ?? { seen: /* @__PURE__ */ new Set() };
	if (n.seen.has(e)) return !1;
	n.seen.add(e);
	let r = e._zod.def;
	if (r.type === "transform") return !0;
	if (r.type === "array") return R(r.element, n);
	if (r.type === "set") return R(r.valueType, n);
	if (r.type === "lazy") return R(r.getter(), n);
	if (r.type === "promise" || r.type === "optional" || r.type === "nonoptional" || r.type === "nullable" || r.type === "readonly" || r.type === "default" || r.type === "prefault") return R(r.innerType, n);
	if (r.type === "intersection") return R(r.left, n) || R(r.right, n);
	if (r.type === "record" || r.type === "map") return R(r.keyType, n) || R(r.valueType, n);
	if (r.type === "pipe") return e._zod.traits.has("$ZodCodec") ? !0 : R(r.in, n) || R(r.out, n);
	if (r.type === "object") {
		for (let e in r.shape) if (R(r.shape[e], n)) return !0;
		return !1;
	}
	if (r.type === "union") {
		for (let e of r.options) if (R(e, n)) return !0;
		return !1;
	}
	if (r.type === "tuple") {
		for (let e of r.items) if (R(e, n)) return !0;
		return !!(r.rest && R(r.rest, n));
	}
	return !1;
}
var Mr = (e, t = {}) => (n) => {
	let r = kr({
		...n,
		processors: t
	});
	return L(e, r), Ar(r, e), jr(r, e);
}, z = (e, t, n = {}) => (r) => {
	let { libraryOptions: i, target: a } = r ?? {}, o = kr({
		...i ?? {},
		target: a,
		io: t,
		processors: n
	});
	return L(e, o), Ar(o, e), jr(o, e);
}, Nr = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
}, Pr = (e, t, n, r) => {
	let i = n;
	i.type = "string";
	let { minimum: a, maximum: o, format: s, patterns: c, contentEncoding: l } = e._zod.bag;
	if (typeof a == "number" && (i.minLength = a), typeof o == "number" && (i.maxLength = o), s && (i.format = Nr[s] ?? s, i.format === "" && delete i.format, s === "time" && delete i.format), l && (i.contentEncoding = l), c && c.size > 0) {
		let e = [...c];
		e.length === 1 ? i.pattern = e[0].source : e.length > 1 && (i.allOf = [...e.map((e) => ({
			...t.target === "draft-07" || t.target === "draft-04" || t.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: e.source
		}))]);
	}
}, Fr = (e, t, n, r) => {
	n.type = "boolean";
}, Ir = (e, t, n, r) => {
	n.not = {};
}, Lr = (e, t, n, r) => {
	let i = e._zod.def, a = p(i.entries);
	a.every((e) => typeof e == "number") && (n.type = "number"), a.every((e) => typeof e == "string") && (n.type = "string"), n.enum = a;
}, Rr = (e, t, n, r) => {
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
}, zr = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Custom types cannot be represented in JSON Schema");
}, Br = (e, t, n, r) => {
	if (t.unrepresentable === "throw") throw Error("Transforms cannot be represented in JSON Schema");
}, Vr = (e, t, n, r) => {
	let i = n, a = e._zod.def, { minimum: o, maximum: s } = e._zod.bag;
	typeof o == "number" && (i.minItems = o), typeof s == "number" && (i.maxItems = s), i.type = "array", i.items = L(a.element, t, {
		...r,
		path: [...r.path, "items"]
	});
}, Hr = (e, t, n, r) => {
	let i = n, a = e._zod.def;
	i.type = "object", i.properties = {};
	let o = a.shape;
	for (let e in o) i.properties[e] = L(o[e], t, {
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
	c.size > 0 && (i.required = Array.from(c)), a.catchall?._zod.def.type === "never" ? i.additionalProperties = !1 : a.catchall ? a.catchall && (i.additionalProperties = L(a.catchall, t, {
		...r,
		path: [...r.path, "additionalProperties"]
	})) : t.io === "output" && (i.additionalProperties = !1);
}, Ur = (e, t, n, r) => {
	let i = e._zod.def, a = i.inclusive === !1, o = i.options.map((e, n) => L(e, t, {
		...r,
		path: [
			...r.path,
			a ? "oneOf" : "anyOf",
			n
		]
	}));
	a ? n.oneOf = o : n.anyOf = o;
}, Wr = (e, t, n, r) => {
	let i = e._zod.def, a = L(i.left, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			0
		]
	}), o = L(i.right, t, {
		...r,
		path: [
			...r.path,
			"allOf",
			1
		]
	}), s = (e) => "allOf" in e && Object.keys(e).length === 1;
	n.allOf = [...s(a) ? a.allOf : [a], ...s(o) ? o.allOf : [o]];
}, Gr = (e, t, n, r) => {
	let i = e._zod.def, a = L(i.innerType, t, r), o = t.seen.get(e);
	t.target === "openapi-3.0" ? (o.ref = i.innerType, n.nullable = !0) : n.anyOf = [a, { type: "null" }];
}, Kr = (e, t, n, r) => {
	let i = e._zod.def;
	L(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, qr = (e, t, n, r) => {
	let i = e._zod.def;
	L(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.default = JSON.parse(JSON.stringify(i.defaultValue));
}, Jr = (e, t, n, r) => {
	let i = e._zod.def;
	L(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, t.io === "input" && (n._prefault = JSON.parse(JSON.stringify(i.defaultValue)));
}, Yr = (e, t, n, r) => {
	let i = e._zod.def;
	L(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
	let o;
	try {
		o = i.catchValue(void 0);
	} catch {
		throw Error("Dynamic catch values are not supported in JSON Schema");
	}
	n.default = o;
}, Xr = (e, t, n, r) => {
	let i = e._zod.def, a = i.in._zod.traits.has("$ZodTransform"), o = t.io === "input" ? a ? i.out : i.in : i.out;
	L(o, t, r);
	let s = t.seen.get(e);
	s.ref = o;
}, Zr = (e, t, n, r) => {
	let i = e._zod.def;
	L(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType, n.readOnly = !0;
}, Qr = (e, t, n, r) => {
	let i = e._zod.def;
	L(i.innerType, t, r);
	let a = t.seen.get(e);
	a.ref = i.innerType;
}, $r = /*@__PURE__*/ c("ZodISODateTime", (e, t) => {
	Rt.init(e, t), W.init(e, t);
});
function ei(e) {
	return /* @__PURE__ */ ar($r, e);
}
var ti = /*@__PURE__*/ c("ZodISODate", (e, t) => {
	zt.init(e, t), W.init(e, t);
});
function ni(e) {
	return /* @__PURE__ */ or(ti, e);
}
var ri = /*@__PURE__*/ c("ZodISOTime", (e, t) => {
	Bt.init(e, t), W.init(e, t);
});
function ii(e) {
	return /* @__PURE__ */ sr(ri, e);
}
var ai = /*@__PURE__*/ c("ZodISODuration", (e, t) => {
	Vt.init(e, t), W.init(e, t);
});
function oi(e) {
	return /* @__PURE__ */ cr(ai, e);
}
var B = /*@__PURE__*/ c("ZodError", (e, t) => {
	Ce.init(e, t), e.name = "ZodError", Object.defineProperties(e, {
		format: { value: (t) => Ee(e, t) },
		flatten: { value: (t) => Te(e, t) },
		addIssue: { value: (t) => {
			e.issues.push(t), e.message = JSON.stringify(e.issues, ee, 2);
		} },
		addIssues: { value: (t) => {
			e.issues.push(...t), e.message = JSON.stringify(e.issues, ee, 2);
		} },
		isEmpty: { get() {
			return e.issues.length === 0;
		} }
	});
}, { Parent: Error }), si = /* @__PURE__ */ De(B), ci = /* @__PURE__ */ Oe(B), li = /* @__PURE__ */ E(B), ui = /* @__PURE__ */ D(B), di = /* @__PURE__ */ je(B), fi = /* @__PURE__ */ Me(B), pi = /* @__PURE__ */ Ne(B), mi = /* @__PURE__ */ Pe(B), hi = /* @__PURE__ */ Fe(B), gi = /* @__PURE__ */ Ie(B), _i = /* @__PURE__ */ Le(B), vi = /* @__PURE__ */ Re(B), yi = /* @__PURE__ */ new WeakMap();
function V(e, t, n) {
	let r = Object.getPrototypeOf(e), i = yi.get(r);
	if (i || (i = /* @__PURE__ */ new Set(), yi.set(r, i)), !i.has(t)) {
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
var H = /*@__PURE__*/ c("ZodType", (e, t) => (A.init(e, t), Object.assign(e["~standard"], { jsonSchema: {
	input: z(e, "input"),
	output: z(e, "output")
} }), e.toJSONSchema = Mr(e, {}), e.def = t, e.type = t.type, Object.defineProperty(e, "_def", { value: t }), e.parse = (t, n) => si(e, t, n, { callee: e.parse }), e.safeParse = (t, n) => li(e, t, n), e.parseAsync = async (t, n) => ci(e, t, n, { callee: e.parseAsync }), e.safeParseAsync = async (t, n) => ui(e, t, n), e.spa = e.safeParseAsync, e.encode = (t, n) => di(e, t, n), e.decode = (t, n) => fi(e, t, n), e.encodeAsync = async (t, n) => pi(e, t, n), e.decodeAsync = async (t, n) => mi(e, t, n), e.safeEncode = (t, n) => hi(e, t, n), e.safeDecode = (t, n) => gi(e, t, n), e.safeEncodeAsync = async (t, n) => _i(e, t, n), e.safeDecodeAsync = async (t, n) => vi(e, t, n), V(e, "ZodType", {
	check(...e) {
		let t = this.def;
		return this.clone(_(t, { checks: [...t.checks ?? [], ...e.map((e) => typeof e == "function" ? { _zod: {
			check: e,
			def: { check: "custom" },
			onattach: []
		} } : e)] }), { parent: !0 });
	},
	with(...e) {
		return this.check(...e);
	},
	clone(e, t) {
		return x(this, e, t);
	},
	brand() {
		return this;
	},
	register(e, t) {
		return e.add(this, t), this;
	},
	refine(e, t) {
		return this.check(wa(e, t));
	},
	superRefine(e, t) {
		return this.check(Ta(e, t));
	},
	overwrite(e) {
		return this.check(/* @__PURE__ */ I(e));
	},
	optional() {
		return oa(this);
	},
	exactOptional() {
		return ca(this);
	},
	nullable() {
		return ua(this);
	},
	nullish() {
		return oa(ua(this));
	},
	nonoptional(e) {
		return ga(this, e);
	},
	array() {
		return qi(this);
	},
	or(e) {
		return Xi([this, e]);
	},
	and(e) {
		return ea(this, e);
	},
	transform(e) {
		return ba(this, ia(e));
	},
	default(e) {
		return fa(this, e);
	},
	prefault(e) {
		return ma(this, e);
	},
	catch(e) {
		return va(this, e);
	},
	pipe(e) {
		return ba(this, e);
	},
	readonly() {
		return Sa(this);
	},
	describe(e) {
		let t = this.clone();
		return P.add(t, { description: e }), t;
	},
	meta(...e) {
		if (e.length === 0) return P.get(this);
		let t = this.clone();
		return P.add(t, e[0]), t;
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
		return P.get(e)?.description;
	},
	configurable: !0
}), e)), bi = /*@__PURE__*/ c("_ZodString", (e, t) => {
	Et.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Pr(e, t, n, r);
	let n = e._zod.bag;
	e.format = n.format ?? null, e.minLength = n.minimum ?? null, e.maxLength = n.maximum ?? null, V(e, "_ZodString", {
		regex(...e) {
			return this.check(/* @__PURE__ */ mr(...e));
		},
		includes(...e) {
			return this.check(/* @__PURE__ */ _r(...e));
		},
		startsWith(...e) {
			return this.check(/* @__PURE__ */ vr(...e));
		},
		endsWith(...e) {
			return this.check(/* @__PURE__ */ yr(...e));
		},
		min(...e) {
			return this.check(/* @__PURE__ */ F(...e));
		},
		max(...e) {
			return this.check(/* @__PURE__ */ fr(...e));
		},
		length(...e) {
			return this.check(/* @__PURE__ */ pr(...e));
		},
		nonempty(...e) {
			return this.check(/* @__PURE__ */ F(1, ...e));
		},
		lowercase(e) {
			return this.check(/* @__PURE__ */ hr(e));
		},
		uppercase(e) {
			return this.check(/* @__PURE__ */ gr(e));
		},
		trim() {
			return this.check(/* @__PURE__ */ xr());
		},
		normalize(...e) {
			return this.check(/* @__PURE__ */ br(...e));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ Sr());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ Cr());
		},
		slugify() {
			return this.check(/* @__PURE__ */ wr());
		}
	});
}), xi = /*@__PURE__*/ c("ZodString", (e, t) => {
	Et.init(e, t), bi.init(e, t), e.email = (t) => e.check(/* @__PURE__ */ Ln(Si, t)), e.url = (t) => e.check(/* @__PURE__ */ Un(wi, t)), e.jwt = (t) => e.check(/* @__PURE__ */ ir(zi, t)), e.emoji = (t) => e.check(/* @__PURE__ */ Wn(Ti, t)), e.guid = (t) => e.check(/* @__PURE__ */ Rn(Ci, t)), e.uuid = (t) => e.check(/* @__PURE__ */ zn(G, t)), e.uuidv4 = (t) => e.check(/* @__PURE__ */ Bn(G, t)), e.uuidv6 = (t) => e.check(/* @__PURE__ */ Vn(G, t)), e.uuidv7 = (t) => e.check(/* @__PURE__ */ Hn(G, t)), e.nanoid = (t) => e.check(/* @__PURE__ */ Gn(Ei, t)), e.guid = (t) => e.check(/* @__PURE__ */ Rn(Ci, t)), e.cuid = (t) => e.check(/* @__PURE__ */ Kn(Di, t)), e.cuid2 = (t) => e.check(/* @__PURE__ */ qn(Oi, t)), e.ulid = (t) => e.check(/* @__PURE__ */ Jn(ki, t)), e.base64 = (t) => e.check(/* @__PURE__ */ tr(Ii, t)), e.base64url = (t) => e.check(/* @__PURE__ */ nr(Li, t)), e.xid = (t) => e.check(/* @__PURE__ */ Yn(Ai, t)), e.ksuid = (t) => e.check(/* @__PURE__ */ Xn(ji, t)), e.ipv4 = (t) => e.check(/* @__PURE__ */ Zn(Mi, t)), e.ipv6 = (t) => e.check(/* @__PURE__ */ Qn(Ni, t)), e.cidrv4 = (t) => e.check(/* @__PURE__ */ $n(Pi, t)), e.cidrv6 = (t) => e.check(/* @__PURE__ */ er(Fi, t)), e.e164 = (t) => e.check(/* @__PURE__ */ rr(Ri, t)), e.datetime = (t) => e.check(ei(t)), e.date = (t) => e.check(ni(t)), e.time = (t) => e.check(ii(t)), e.duration = (t) => e.check(oi(t));
});
function U(e) {
	return /* @__PURE__ */ In(xi, e);
}
var W = /*@__PURE__*/ c("ZodStringFormat", (e, t) => {
	j.init(e, t), bi.init(e, t);
}), Si = /*@__PURE__*/ c("ZodEmail", (e, t) => {
	kt.init(e, t), W.init(e, t);
}), Ci = /*@__PURE__*/ c("ZodGUID", (e, t) => {
	Dt.init(e, t), W.init(e, t);
}), G = /*@__PURE__*/ c("ZodUUID", (e, t) => {
	Ot.init(e, t), W.init(e, t);
}), wi = /*@__PURE__*/ c("ZodURL", (e, t) => {
	At.init(e, t), W.init(e, t);
}), Ti = /*@__PURE__*/ c("ZodEmoji", (e, t) => {
	jt.init(e, t), W.init(e, t);
}), Ei = /*@__PURE__*/ c("ZodNanoID", (e, t) => {
	Mt.init(e, t), W.init(e, t);
}), Di = /*@__PURE__*/ c("ZodCUID", (e, t) => {
	Nt.init(e, t), W.init(e, t);
}), Oi = /*@__PURE__*/ c("ZodCUID2", (e, t) => {
	Pt.init(e, t), W.init(e, t);
}), ki = /*@__PURE__*/ c("ZodULID", (e, t) => {
	Ft.init(e, t), W.init(e, t);
}), Ai = /*@__PURE__*/ c("ZodXID", (e, t) => {
	It.init(e, t), W.init(e, t);
}), ji = /*@__PURE__*/ c("ZodKSUID", (e, t) => {
	Lt.init(e, t), W.init(e, t);
}), Mi = /*@__PURE__*/ c("ZodIPv4", (e, t) => {
	Ht.init(e, t), W.init(e, t);
}), Ni = /*@__PURE__*/ c("ZodIPv6", (e, t) => {
	Ut.init(e, t), W.init(e, t);
}), Pi = /*@__PURE__*/ c("ZodCIDRv4", (e, t) => {
	Wt.init(e, t), W.init(e, t);
}), Fi = /*@__PURE__*/ c("ZodCIDRv6", (e, t) => {
	Gt.init(e, t), W.init(e, t);
}), Ii = /*@__PURE__*/ c("ZodBase64", (e, t) => {
	qt.init(e, t), W.init(e, t);
}), Li = /*@__PURE__*/ c("ZodBase64URL", (e, t) => {
	Yt.init(e, t), W.init(e, t);
}), Ri = /*@__PURE__*/ c("ZodE164", (e, t) => {
	Xt.init(e, t), W.init(e, t);
}), zi = /*@__PURE__*/ c("ZodJWT", (e, t) => {
	Qt.init(e, t), W.init(e, t);
}), Bi = /*@__PURE__*/ c("ZodBoolean", (e, t) => {
	$t.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Fr(e, t, n, r);
});
function Vi(e) {
	return /* @__PURE__ */ lr(Bi, e);
}
var Hi = /*@__PURE__*/ c("ZodUnknown", (e, t) => {
	en.init(e, t), H.init(e, t), e._zod.processJSONSchema = (e, t, n) => void 0;
});
function Ui() {
	return /* @__PURE__ */ ur(Hi);
}
var Wi = /*@__PURE__*/ c("ZodNever", (e, t) => {
	tn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ir(e, t, n, r);
});
function Gi(e) {
	return /* @__PURE__ */ dr(Wi, e);
}
var Ki = /*@__PURE__*/ c("ZodArray", (e, t) => {
	rn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Vr(e, t, n, r), e.element = t.element, V(e, "ZodArray", {
		min(e, t) {
			return this.check(/* @__PURE__ */ F(e, t));
		},
		nonempty(e) {
			return this.check(/* @__PURE__ */ F(1, e));
		},
		max(e, t) {
			return this.check(/* @__PURE__ */ fr(e, t));
		},
		length(e, t) {
			return this.check(/* @__PURE__ */ pr(e, t));
		},
		unwrap() {
			return this.element;
		}
	});
});
function qi(e, t) {
	return /* @__PURE__ */ Tr(Ki, e, t);
}
var Ji = /*@__PURE__*/ c("ZodObject", (e, t) => {
	cn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Hr(e, t, n, r), h(e, "shape", () => t.shape), V(e, "ZodObject", {
		keyof() {
			return q(Object.keys(this._zod.def.shape));
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
				catchall: Ui()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: Ui()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: Gi()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(e) {
			return pe(this, e);
		},
		safeExtend(e) {
			return me(this, e);
		},
		merge(e) {
			return he(this, e);
		},
		pick(e) {
			return de(this, e);
		},
		omit(e) {
			return fe(this, e);
		},
		partial(...e) {
			return ge(aa, this, e[0]);
		},
		required(...e) {
			return _e(ha, this, e[0]);
		}
	});
});
function K(e, t) {
	return new Ji({
		type: "object",
		shape: e ?? {},
		...S(t)
	});
}
var Yi = /*@__PURE__*/ c("ZodUnion", (e, t) => {
	un.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Ur(e, t, n, r), e.options = t.options;
});
function Xi(e, t) {
	return new Yi({
		type: "union",
		options: e,
		...S(t)
	});
}
var Zi = /*@__PURE__*/ c("ZodDiscriminatedUnion", (e, t) => {
	Yi.init(e, t), dn.init(e, t);
});
function Qi(e, t, n) {
	return new Zi({
		type: "union",
		options: t,
		discriminator: e,
		...S(n)
	});
}
var $i = /*@__PURE__*/ c("ZodIntersection", (e, t) => {
	fn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Wr(e, t, n, r);
});
function ea(e, t) {
	return new $i({
		type: "intersection",
		left: e,
		right: t
	});
}
var ta = /*@__PURE__*/ c("ZodEnum", (e, t) => {
	hn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Lr(e, t, n, r), e.enum = t.entries, e.options = Object.values(t.entries);
	let n = new Set(Object.keys(t.entries));
	e.extract = (e, r) => {
		let i = {};
		for (let r of e) if (n.has(r)) i[r] = t.entries[r];
		else throw Error(`Key ${r} not found in enum`);
		return new ta({
			...t,
			checks: [],
			...S(r),
			entries: i
		});
	}, e.exclude = (e, r) => {
		let i = { ...t.entries };
		for (let t of e) if (n.has(t)) delete i[t];
		else throw Error(`Key ${t} not found in enum`);
		return new ta({
			...t,
			checks: [],
			...S(r),
			entries: i
		});
	};
});
function q(e, t) {
	return new ta({
		type: "enum",
		entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
		...S(t)
	});
}
var na = /*@__PURE__*/ c("ZodLiteral", (e, t) => {
	gn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Rr(e, t, n, r), e.values = new Set(t.values), Object.defineProperty(e, "value", { get() {
		if (t.values.length > 1) throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return t.values[0];
	} });
});
function J(e, t) {
	return new na({
		type: "literal",
		values: Array.isArray(e) ? e : [e],
		...S(t)
	});
}
var ra = /*@__PURE__*/ c("ZodTransform", (e, t) => {
	_n.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Br(e, t, n, r), e._zod.parse = (n, r) => {
		if (r.direction === "backward") throw new u(e.constructor.name);
		n.addIssue = (r) => {
			if (typeof r == "string") n.issues.push(T(r, n.value, t));
			else {
				let t = r;
				t.fatal && (t.continue = !1), t.code ??= "custom", t.input ??= n.value, t.inst ??= e, n.issues.push(T(t));
			}
		};
		let i = t.transform(n.value, n);
		return i instanceof Promise ? i.then((e) => (n.value = e, n.fallback = !0, n)) : (n.value = i, n.fallback = !0, n);
	};
});
function ia(e) {
	return new ra({
		type: "transform",
		transform: e
	});
}
var aa = /*@__PURE__*/ c("ZodOptional", (e, t) => {
	yn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Qr(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function oa(e) {
	return new aa({
		type: "optional",
		innerType: e
	});
}
var sa = /*@__PURE__*/ c("ZodExactOptional", (e, t) => {
	bn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Qr(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function ca(e) {
	return new sa({
		type: "optional",
		innerType: e
	});
}
var la = /*@__PURE__*/ c("ZodNullable", (e, t) => {
	xn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Gr(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function ua(e) {
	return new la({
		type: "nullable",
		innerType: e
	});
}
var da = /*@__PURE__*/ c("ZodDefault", (e, t) => {
	Sn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => qr(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeDefault = e.unwrap;
});
function fa(e, t) {
	return new da({
		type: "default",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : ce(t);
		}
	});
}
var pa = /*@__PURE__*/ c("ZodPrefault", (e, t) => {
	wn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Jr(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function ma(e, t) {
	return new pa({
		type: "prefault",
		innerType: e,
		get defaultValue() {
			return typeof t == "function" ? t() : ce(t);
		}
	});
}
var ha = /*@__PURE__*/ c("ZodNonOptional", (e, t) => {
	Tn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Kr(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function ga(e, t) {
	return new ha({
		type: "nonoptional",
		innerType: e,
		...S(t)
	});
}
var _a = /*@__PURE__*/ c("ZodCatch", (e, t) => {
	Dn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Yr(e, t, n, r), e.unwrap = () => e._zod.def.innerType, e.removeCatch = e.unwrap;
});
function va(e, t) {
	return new _a({
		type: "catch",
		innerType: e,
		catchValue: typeof t == "function" ? t : () => t
	});
}
var ya = /*@__PURE__*/ c("ZodPipe", (e, t) => {
	On.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Xr(e, t, n, r), e.in = t.in, e.out = t.out;
});
function ba(e, t) {
	return new ya({
		type: "pipe",
		in: e,
		out: t
	});
}
var xa = /*@__PURE__*/ c("ZodReadonly", (e, t) => {
	kn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => Zr(e, t, n, r), e.unwrap = () => e._zod.def.innerType;
});
function Sa(e) {
	return new xa({
		type: "readonly",
		innerType: e
	});
}
var Ca = /*@__PURE__*/ c("ZodCustom", (e, t) => {
	jn.init(e, t), H.init(e, t), e._zod.processJSONSchema = (t, n, r) => zr(e, t, n, r);
});
function wa(e, t = {}) {
	return /* @__PURE__ */ Er(Ca, e, t);
}
function Ta(e, t) {
	return /* @__PURE__ */ Dr(e, t);
}
Object.freeze({
	modbusRtu: !0,
	modbusTcp: !1,
	serialPorts: "browser-picker",
	filesystem: "limited",
	nodePlugins: !1,
	webPlugins: !0
});
//#endregion
//#region ../../packages/domain/src/errors.ts
function Ea(e) {
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
var Da = "mamep:invoke", Oa = "mamep:event", ka = [
	"get-capabilities",
	"get-app-version",
	"copy-text-to-clipboard",
	"read-text-from-clipboard",
	"select-serial-port",
	"debug:get-state"
], Aa = K({
	portId: U(),
	label: U()
}), Y = J(1), X = U().min(1), ja = q(ka), Ma = q([
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
]), Na = q([
	"info",
	"warning",
	"error",
	"fatal"
]), Pa = q([
	"disconnected",
	"selecting-device",
	"connecting",
	"connected",
	"disconnecting",
	"reconnect-waiting",
	"reconnecting",
	"interrupted",
	"failed"
]), Fa = K({
	code: U(),
	category: Ma,
	severity: Na,
	retryable: Vi(),
	userMessageKey: U(),
	technicalMessage: U()
});
function Ia(e) {
	return {
		code: e.code,
		category: e.category,
		severity: e.severity,
		retryable: e.retryable,
		userMessageKey: e.userMessageKey,
		technicalMessage: e.technicalMessage
	};
}
var Z = {
	protocolVersion: Y,
	type: J("request"),
	messageId: X
}, La = Qi("kind", [
	K({
		...Z,
		kind: J("get-capabilities"),
		payload: K({})
	}),
	K({
		...Z,
		kind: J("get-app-version"),
		payload: K({})
	}),
	K({
		...Z,
		kind: J("copy-text-to-clipboard"),
		payload: K({ text: U() })
	}),
	K({
		...Z,
		kind: J("read-text-from-clipboard"),
		payload: K({})
	}),
	K({
		...Z,
		kind: J("select-serial-port"),
		payload: K({ portId: U() })
	}),
	K({
		...Z,
		kind: J("debug:get-state"),
		payload: K({})
	})
]);
Xi([
	La,
	K({
		protocolVersion: Y,
		type: J("response"),
		messageId: X,
		kind: ja,
		ok: J(!0),
		payload: Ui()
	}),
	K({
		protocolVersion: Y,
		type: J("error"),
		messageId: X,
		kind: U(),
		payload: Fa
	}),
	Qi("kind", [K({
		protocolVersion: Y,
		type: J("event"),
		messageId: X,
		kind: J("connection-state"),
		payload: K({ state: Pa })
	}), K({
		protocolVersion: Y,
		type: J("event"),
		messageId: X,
		kind: J("serial-ports-available"),
		payload: K({ ports: qi(Aa) })
	})])
]);
var Ra = Object.freeze({
	modbusRtu: !0,
	modbusTcp: !1,
	serialPorts: "enumerated",
	filesystem: "limited",
	nodePlugins: !1,
	webPlugins: !0
});
//#endregion
//#region ../electron/src/main/ipc.ts
function za(e) {
	if (typeof e != "object" || !e) return "";
	let t = e.messageId;
	return typeof t == "string" && t.length > 0 ? t : "";
}
function Ba(e, t, n) {
	return {
		protocolVersion: 1,
		type: "error",
		messageId: e,
		kind: "host-error",
		payload: Ia(Ea({
			code: t,
			category: "internal",
			userMessageKey: "errors.hostMessageRejected",
			technicalMessage: n
		}))
	};
}
function Q(e, t) {
	return {
		protocolVersion: 1,
		type: "response",
		messageId: e.messageId,
		kind: e.kind,
		ok: !0,
		payload: t
	};
}
function Va(e, t, n) {
	switch (e.kind) {
		case "get-capabilities": return Q(e, Ra);
		case "get-app-version": return Q(e, t.appVersion());
		case "copy-text-to-clipboard": return t.clipboardWriteText(e.payload.text), Q(e, null);
		case "read-text-from-clipboard": return Q(e, t.clipboardReadText());
		case "select-serial-port": return t.resolveSerialPortSelection(e.payload.portId, n) ? Q(e, null) : Ba(e.messageId, "SERIAL_PICKER_NOT_ACTIVE", "no pending serial port selection for this sender");
		case "debug:get-state": return t.isPackaged() ? Ba(e.messageId, "DEBUG_PROBE_DISABLED", "debug probe is disabled in packaged builds") : Q(e, {
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
function Ha(e, t) {
	if (!t.isSenderMainWindow) return Ba(za(e), "HOST_MESSAGE_SENDER_REJECTED", "message sender is not the main window");
	let n = La.safeParse(e);
	return n.success ? Va(n.data, t.deps, t.sender) : Ba(za(e), "HOST_MESSAGE_INVALID", `invalid host request: ${n.error.message}`);
}
//#endregion
//#region ../electron/src/main/serial-permissions.ts
function Ua(e, t) {
	return !e && t !== void 0 && t.length > 0 ? [new URL(t).origin] : ["file://", "file:///"];
}
function Wa(e) {
	if (e !== void 0) {
		if (e.startsWith("http://") || e.startsWith("https://")) try {
			return new URL(e).origin;
		} catch {
			return e;
		}
		return e;
	}
}
function Ga(e) {
	return e.map((e) => ({
		portId: e.portId,
		label: e.portName ?? e.displayName ?? e.portId
	}));
}
function Ka(e, t) {
	let n = t.allowedOrigins, r = (e) => {
		let t = Wa(e);
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
		}, t.onPortsAvailable?.(Ga(n));
	}), { resolvePendingSelection(e, t) {
		if (a === null || a.sender !== t) return !1;
		let n = a.callback;
		return a = null, n(e), !0;
	} };
}
//#endregion
//#region ../electron/src/main/main.ts
var qa = a.dirname(o(import.meta.url)), Ja = a.join(qa, "../apps/web/dist-electron/index.html"), $ = null, Ya = 0, Xa = null, Za = "disconnected";
function Qa() {
	return Ya += 1, `evt-${Date.now()}-${Ya}`;
}
var $a = {
	appVersion: () => t.getVersion(),
	isPackaged: () => t.isPackaged,
	windowCount: () => e.getAllWindows().length,
	connectionState: () => Za,
	uptimeMs: () => Math.round(process.uptime() * 1e3),
	clipboardWriteText: (e) => n.writeText(e),
	clipboardReadText: () => n.readText(),
	resolveSerialPortSelection: (e, t) => Xa?.resolvePendingSelection(e, t) ?? !1
};
function eo(e, t) {
	return Ha(t, {
		isSenderMainWindow: e.sender === $?.webContents,
		sender: e.sender,
		deps: $a
	});
}
function to() {
	let t = new e({
		width: 1280,
		height: 800,
		title: "mamep2026",
		webPreferences: {
			preload: a.join(qa, "preload.js"),
			contextIsolation: !0,
			nodeIntegration: !1,
			sandbox: !0
		}
	});
	$ = t, t.setMenu(null), t.on("closed", () => {
		$ = null;
	}), t.webContents.on("did-finish-load", () => {
		let e = {
			protocolVersion: 1,
			type: "event",
			messageId: Qa(),
			kind: "connection-state",
			payload: { state: "disconnected" }
		};
		t.webContents.send(Oa, e);
	}), process.env.VITE_DEV_SERVER_URL ? t.loadURL(process.env.VITE_DEV_SERVER_URL) : t.loadFile(Ja);
}
t.whenReady().then(() => {
	Xa = Ka(i.defaultSession, {
		allowedOrigins: Ua(t.isPackaged, process.env.VITE_DEV_SERVER_URL),
		onPortsAvailable: (e) => {
			let t = {
				protocolVersion: 1,
				type: "event",
				messageId: Qa(),
				kind: "serial-ports-available",
				payload: { ports: e }
			};
			$?.webContents.send(Oa, t);
		}
	}), r.handle(Da, eo), to(), t.on("activate", () => {
		e.getAllWindows().length === 0 && to();
	});
}), t.on("window-all-closed", () => {
	process.platform !== "darwin" && t.quit();
});
//#endregion
export {};
