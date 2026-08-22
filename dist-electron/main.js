import { BrowserWindow, app, clipboard, ipcMain, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Socket } from "node:net";
Object.freeze({
	modbusRtu: true,
	modbusTcp: false,
	serialPorts: "browser-picker",
	filesystem: "limited",
	nodePlugins: false,
	webPlugins: true
});
//#endregion
//#region ../../packages/domain/src/config.ts
/**
* 集中默认配置（docs/AGENTS.md §42）。
* 禁止在组件、Host 或 Adapter 中散落硬编码默认值。
*/
var defaultConfig = {
	rtu: {
		baudRate: 9600,
		dataBits: 8,
		stopBits: 1,
		parity: "none",
		flowControl: "off",
		requestTimeoutMs: 1e3,
		retryCount: 1,
		/** Rx Delay：请求间隔，兼作 WP 轮询间隔（ADR-013） */
		interRequestDelayMs: 50,
		/** Address Adjust：默认 OFF（ON 时发送地址 = 用户地址 − 1） */
		addressAdjust: "off"
	},
	tcp: {
		/** MBAP 单元标识默认 0（2026-08-23 确认：与 RTU Slave Address 默认 1 不同） */
		unitId: 0,
		connectTimeoutMs: 5e3,
		requestTimeoutMs: 1e3,
		retryCount: 1,
		/** 自动重连：P1 能力（UI 灰显禁用，2026-08-23 确认） */
		autoReconnect: false,
		/** 请求间隔，兼作 WP 轮询间隔（内部字段，不入表单） */
		interRequestDelayMs: 50
	},
	registerTable: {
		/** Register 地址列进制：默认 DEC（按表独立，ADR-014） */
		addressRadix: "dec",
		/** Slave Address 默认值：1（按表独立设置，2026-08-19） */
		slaveAddress: 1,
		/** 新建寄存器表默认填充的行数（2026-08-15） */
		defaultRowCount: 50
	},
	polling: { 
	/** 每行最多一个等待中的轮询任务（内部值，不提供用户配置） */
maxPendingPollingTasks: 1 },
	logging: {
		maxCommunicationLogEntries: 1e4,
		maxApplicationMessages: 2e3
	},
	autosave: { debounceMs: 500 },
	trace: {
		/** Buffer Size = Continue 时的环形缓冲区硬上限 */
		maxContinueEntries: 1e4,
		/** Speed 滑块映射的采样间隔范围（Quick..Slow） */
		speedMinMs: 100,
		speedMaxMs: 2e3
	}
};
//#endregion
//#region ../../packages/domain/src/errors.ts
function createMamepError(input) {
	const error = {
		code: input.code,
		category: input.category,
		severity: input.severity ?? "error",
		retryable: input.retryable ?? false,
		userMessageKey: input.userMessageKey,
		technicalMessage: input.technicalMessage
	};
	if (input.cause !== void 0) error.cause = input.cause;
	if (input.context !== void 0) error.context = input.context;
	return error;
}
//#endregion
//#region ../../packages/domain/src/result.ts
function ok(value) {
	return {
		ok: true,
		value
	};
}
function fail(error) {
	return {
		ok: false,
		error
	};
}
//#endregion
//#region ../../packages/domain/src/raw-value.ts
/**
* 16 位寄存器原始值：0 至 65535 的整数。
* 只能通过受控工厂 create 创建（docs/AGENTS.md §9.2、§16.1）。
*/
var RawRegisterValue = class RawRegisterValue {
	value;
	constructor(value) {
		this.value = value;
	}
	static create(input) {
		const error = validateRawRegisterValue(input);
		if (error !== null) return fail(error);
		return ok(new RawRegisterValue(input));
	}
};
function validateRawRegisterValue(input) {
	if (typeof input !== "number") return createMamepError({
		code: "RAW_VALUE_INVALID_TYPE",
		category: "validation",
		userMessageKey: "errors.rawValueInvalidType",
		technicalMessage: `raw register value must be a number, got ${String(input)}`
	});
	if (!Number.isInteger(input)) return createMamepError({
		code: "RAW_VALUE_NOT_INTEGER",
		category: "validation",
		userMessageKey: "errors.rawValueNotInteger",
		technicalMessage: `raw register value must be an integer, got ${input}`
	});
	if (input < 0 || input > 65535) return createMamepError({
		code: "RAW_VALUE_OUT_OF_RANGE",
		category: "validation",
		userMessageKey: "errors.rawValueOutOfRange",
		technicalMessage: `raw register value must be within 0..65535, got ${input}`
	});
	return null;
}
//#endregion
//#region ../../packages/domain/src/register-address.ts
/**
* 寄存器地址：内部表示为 0 至 65535 的整数（docs/AGENTS.md §16.6）。
* UI 显示为 4 位大写十六进制（由 data-conversion 包负责格式化）。
*/
var RegisterAddress = class RegisterAddress {
	value;
	constructor(value) {
		this.value = value;
	}
	static create(input) {
		if (typeof input !== "number" || !Number.isInteger(input)) return fail(createMamepError({
			code: "REGISTER_ADDRESS_INVALID",
			category: "validation",
			userMessageKey: "errors.registerAddressInvalid",
			technicalMessage: `register address must be an integer, got ${String(input)}`
		}));
		if (input < 0 || input > 65535) return fail(createMamepError({
			code: "REGISTER_ADDRESS_OUT_OF_RANGE",
			category: "validation",
			userMessageKey: "errors.registerAddressOutOfRange",
			technicalMessage: `register address must be within 0..65535, got ${input}`
		}));
		return ok(new RegisterAddress(input));
	}
};
//#endregion
//#region ../../packages/domain/src/tcp-profile.ts
/**
* Modbus TCP 连接配置（docs/TECH_DESIGN.md §18.4、ADR-020 后续 Node TCP Adapter）。
* - host 视为不透明字符串原样传递，不解析/不归一化 IP（§34.3.4 路径/主机名不解析原则）；
* - unitId 为 MBAP 单元标识：0~255，默认 0（2026-08-23 确认）；0=广播（MVP 不实现广播写入）；
* - autoReconnect 为 P1 能力（UI 灰显禁用，2026-08-23 确认），默认 false；
* - interRequestDelayMs 为内部字段（请求间隔，兼作 WP 轮询间隔），不入表单。
*/
function invalid(code, userMessageKey, technicalMessage) {
	return createMamepError({
		code,
		category: "validation",
		userMessageKey,
		technicalMessage
	});
}
function isOptionalPositiveInt(v) {
	return typeof v === "number" && Number.isInteger(v) && v > 0;
}
function isOptionalNonNegativeInt(v) {
	return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
/** 校验并构造 TCP 连接配置；缺失的扩展字段使用默认值（沿用值对象校验风格）。 */
function createTcpConnectionProfile(input) {
	if (typeof input !== "object" || input === null) return fail(invalid("TCP_HOST_INVALID", "errors.tcpHostInvalid", "tcp connection profile must be an object"));
	const candidate = input;
	if (typeof candidate.host !== "string" || candidate.host.trim().length === 0) return fail(invalid("TCP_HOST_INVALID", "errors.tcpHostInvalid", `host must be a non-empty string, got ${String(candidate.host)}`));
	if (typeof candidate.port !== "number" || !Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) return fail(invalid("TCP_PORT_OUT_OF_RANGE", "errors.tcpPortOutOfRange", `port must be an integer within 1..65535, got ${String(candidate.port)}`));
	if (typeof candidate.unitId !== "number" || !Number.isInteger(candidate.unitId) || candidate.unitId < 0 || candidate.unitId > 255) return fail(invalid("TCP_UNIT_ID_OUT_OF_RANGE", "errors.tcpUnitIdOutOfRange", `unitId must be an integer within 0..255, got ${String(candidate.unitId)}`));
	const defaults = defaultConfig.tcp;
	return ok({
		id: typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : "",
		name: typeof candidate.name === "string" && candidate.name.length > 0 ? candidate.name : "TCP",
		protocol: "tcp",
		host: candidate.host,
		port: candidate.port,
		unitId: candidate.unitId,
		connectTimeoutMs: isOptionalPositiveInt(candidate.connectTimeoutMs) ? candidate.connectTimeoutMs : defaults.connectTimeoutMs,
		requestTimeoutMs: isOptionalPositiveInt(candidate.requestTimeoutMs) ? candidate.requestTimeoutMs : defaults.requestTimeoutMs,
		retryCount: isOptionalNonNegativeInt(candidate.retryCount) ? candidate.retryCount : defaults.retryCount,
		autoReconnect: typeof candidate.autoReconnect === "boolean" ? candidate.autoReconnect : defaults.autoReconnect,
		interRequestDelayMs: isOptionalNonNegativeInt(candidate.interRequestDelayMs) ? candidate.interRequestDelayMs : defaults.interRequestDelayMs
	});
}
//#endregion
//#region ../../packages/domain/src/workspace-model.ts
var idCounter = 0;
function nextId(prefix) {
	idCounter += 1;
	return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function newRowId() {
	return nextId("row");
}
/** 创建新的空寄存器行。 */
function createEmptyRow() {
	const now = Date.now();
	return {
		rowId: newRowId(),
		order: 0,
		name: "",
		comment: "",
		addressDraft: "",
		addressValue: null,
		dataType: "hex",
		pollingEnabled: false,
		traceEnabled: false,
		cellText: "",
		lastKnownRawValue: null,
		createdAt: now,
		updatedAt: now
	};
}
//#endregion
//#region ../../packages/platform-node/src/real-socket.ts
/**
* Node `net` 的真实封装（Node TCP Adapter，docs/TECH_DESIGN.md §34.3.16）。
* 本文件是 platform-node 中唯一直接 import node:net 的模块。
* net 的类型/对象不得出现在本包公开 API 中。
*/
/** 将 Buffer 安全转换为 Uint8Array（共享内存视图，事件回调内消费安全）。 */
function toUint8Array(buffer) {
	return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
var RealSocket = class {
	socket = new Socket();
	host;
	port;
	opened = false;
	dataListeners = /* @__PURE__ */ new Set();
	errorListeners = /* @__PURE__ */ new Set();
	closeListeners = /* @__PURE__ */ new Set();
	constructor(options) {
		this.host = options.host;
		this.port = options.port;
		this.socket.on("data", (chunk) => {
			const bytes = toUint8Array(chunk);
			for (const listener of this.dataListeners) listener(bytes);
		});
		this.socket.on("error", (error) => {
			for (const listener of this.errorListeners) listener(error);
		});
		this.socket.on("close", () => {
			this.opened = false;
			for (const listener of this.closeListeners) listener();
		});
	}
	get isOpen() {
		return this.opened;
	}
	open() {
		return new Promise((resolve, reject) => {
			if (this.opened) {
				resolve();
				return;
			}
			const onConnect = () => {
				cleanup();
				this.opened = true;
				resolve();
			};
			const onError = (error) => {
				cleanup();
				reject(error);
			};
			const onClose = () => {
				cleanup();
				reject(/* @__PURE__ */ new Error(`tcp connection closed before connect (${this.host}:${this.port})`));
			};
			const cleanup = () => {
				this.socket.off("connect", onConnect);
				this.socket.off("error", onError);
				this.socket.off("close", onClose);
			};
			this.socket.once("connect", onConnect);
			this.socket.once("error", onError);
			this.socket.once("close", onClose);
			this.socket.connect({
				host: this.host,
				port: this.port
			});
		});
	}
	close() {
		return new Promise((resolve) => {
			if (this.socket.readyState === "closed") {
				resolve();
				return;
			}
			this.socket.once("close", () => resolve());
			this.socket.destroy();
		});
	}
	write(data) {
		return new Promise((resolve, reject) => {
			this.socket.write(data, (error) => error ? reject(error) : resolve());
		});
	}
	onData(listener) {
		this.dataListeners.add(listener);
		return () => this.dataListeners.delete(listener);
	}
	onError(listener) {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}
	onClose(listener) {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}
};
var RealNetFactory = class {
	connect(options) {
		return new RealSocket(options);
	}
};
//#endregion
//#region ../../packages/platform-node/src/error-mapping.ts
/**
* 串口库错误 → 统一错误模型（docs/TECH_DESIGN.md §34.3.17）。
* 综合错误类型 / 错误码 / OS errno / 受控字符串匹配，不得只依赖完整错误字符串；
* 无法识别的错误映射为通用串口错误，同时保留原始技术信息用于诊断。
*/
function readString(value) {
	return typeof value === "string" ? value : "";
}
function toTcpMamepError(cause, fallback) {
	const code = readString(cause?.code);
	const message = cause instanceof Error ? cause.message : String(cause);
	const normalized = message.toLowerCase();
	if (code === "EADDRINUSE") return createMamepError({
		code: "TCP_PORT_IN_USE",
		category: "permission",
		retryable: false,
		userMessageKey: "errors.tcpPortInUse",
		technicalMessage: `tcp port already in use: ${message}`,
		cause
	});
	if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EPIPE") return createMamepError({
		code: "TCP_CONNECTION_FAILED",
		category: "connection",
		retryable: true,
		userMessageKey: "errors.tcpConnectionFailed",
		technicalMessage: `tcp connection failed: ${message}`,
		cause
	});
	if (normalized.includes("address already in use") || normalized.includes("port already in use")) return createMamepError({
		code: "TCP_PORT_IN_USE",
		category: "permission",
		retryable: false,
		userMessageKey: "errors.tcpPortInUse",
		technicalMessage: message,
		cause
	});
	if (normalized.includes("connection refused") || normalized.includes("no such host") || normalized.includes("host unreachable") || normalized.includes("network is unreachable") || normalized.includes("getaddrinfo")) return createMamepError({
		code: "TCP_CONNECTION_FAILED",
		category: "connection",
		retryable: true,
		userMessageKey: "errors.tcpConnectionFailed",
		technicalMessage: message,
		cause
	});
	if (fallback === "open") return createMamepError({
		code: "TCP_OPEN_FAILED",
		category: "transport",
		retryable: true,
		userMessageKey: "errors.tcpOpenFailed",
		technicalMessage: message,
		cause
	});
	return createMamepError({
		code: "TCP_CONNECTION_FAILED",
		category: "connection",
		retryable: true,
		userMessageKey: "errors.tcpConnectionFailed",
		technicalMessage: message,
		cause
	});
}
/** TCP 通用映射（读/写/关闭）。 */
function mapTcpError(cause) {
	return toTcpMamepError(cause, "io");
}
/** TCP 打开专用映射（未知打开错误 → TCP_OPEN_FAILED）。 */
function mapTcpOpenError(cause) {
	return toTcpMamepError(cause, "open");
}
//#endregion
//#region ../../packages/platform-node/src/node-tcp-transport.ts
var NodeTcpTransport = class {
	kind = "node-tcp";
	openFlag = false;
	closeEmitted = false;
	socket;
	dataListeners = /* @__PURE__ */ new Set();
	errorListeners = /* @__PURE__ */ new Set();
	closeListeners = /* @__PURE__ */ new Set();
	constructor(socket) {
		this.socket = socket;
		socket.onData((chunk) => {
			if (!this.openFlag) return;
			if (chunk.length === 0) return;
			for (const listener of this.dataListeners) listener(chunk);
		});
		socket.onError((error) => {
			if (!this.openFlag) return;
			const mapped = mapTcpError(error);
			for (const listener of this.errorListeners) listener(mapped);
		});
		socket.onClose(() => this.emitClose());
	}
	onData(listener) {
		this.dataListeners.add(listener);
		return () => this.dataListeners.delete(listener);
	}
	onError(listener) {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}
	onClose(listener) {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}
	async open() {
		if (this.openFlag) return fail(createMamepError({
			code: "TCP_OPEN_FAILED",
			category: "transport",
			retryable: false,
			userMessageKey: "errors.tcpOpenFailed",
			technicalMessage: "tcp connection is already open"
		}));
		try {
			await this.socket.open();
			this.openFlag = true;
			this.closeEmitted = false;
			return ok(void 0);
		} catch (cause) {
			return fail(mapTcpOpenError(cause));
		}
	}
	async close() {
		this.openFlag = false;
		try {
			await this.socket.close();
		} catch (cause) {
			const error = mapTcpError(cause);
			this.emitClose();
			return fail(error);
		}
		this.emitClose();
		return ok(void 0);
	}
	async write(bytes) {
		if (!this.openFlag) return fail(createMamepError({
			code: "TRANSPORT_NOT_OPEN",
			category: "transport",
			userMessageKey: "errors.transportNotOpen",
			technicalMessage: "tcp connection is not open"
		}));
		try {
			await this.socket.write(bytes);
			return ok(void 0);
		} catch (cause) {
			return fail(mapTcpError(cause));
		}
	}
	isOpen() {
		return this.openFlag;
	}
	emitClose() {
		if (this.closeEmitted) return;
		this.closeEmitted = true;
		this.openFlag = false;
		for (const listener of this.closeListeners) listener();
	}
};
//#endregion
//#region ../../packages/platform-node/src/real-clock.ts
/** Node 宿主真实时钟（setTimeout / Date.now），供 Node Platform Host 使用。 */
var nodeClock = {
	now: () => Date.now(),
	schedule: (callback, delayMs) => {
		const id = setTimeout(callback, delayMs);
		return { cancel: () => clearTimeout(id) };
	}
};
//#endregion
//#region ../../packages/platform-node/src/node-tcp-platform-host.ts
/** 仅 TCP 的能力声明（Electron 主进程矩阵由 electronCapabilities 承担，本值备用/测试）。 */
var nodeTcpHostCapabilities = Object.freeze({
	modbusRtu: false,
	modbusTcp: true,
	serialPorts: "unsupported",
	filesystem: "unsupported",
	nodePlugins: false,
	webPlugins: false
});
/** 仅 TCP 的 Node 平台宿主：与 NodePlatformHost.openTcpTransport 同构，但零 serialport 依赖。 */
var NodeTcpPlatformHost = class {
	clock;
	capabilities;
	netFactory;
	constructor(options = {}) {
		this.netFactory = options.netFactory ?? new RealNetFactory();
		this.clock = options.clock ?? nodeClock;
		this.capabilities = options.capabilities ?? nodeTcpHostCapabilities;
	}
	/**
	* 打开 TCP 传输（Node TCP Adapter）。边界校验 profile（host/port/unitId，
	* unitId 范围 0~255，用户决策）；host/port 原样透传给 Node net。
	*/
	async openTcpTransport(profile) {
		const validation = createTcpConnectionProfile(profile);
		if (!validation.ok) return fail(validation.error);
		return ok(new NodeTcpTransport(this.netFactory.connect({
			host: profile.host,
			port: profile.port
		})));
	}
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a$1;
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
var propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
var NUMBER_FORMAT_RANGES = {
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
var initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
var $ZodError = $constructor("$ZodError", initializer$1);
var $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
var safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
var safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
var duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
var uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
var integer = /^-?\d+$/;
var number$1 = /^-?\d+(?:\.\d+)?$/;
var boolean$1 = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
var $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
var $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) {
			if (def.inclusive) bag.maximum = def.value;
			else bag.exclusiveMaximum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) {
			if (def.inclusive) bag.minimum = def.value;
			else bag.exclusiveMinimum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
var version = {
	major: 4,
	minor: 4,
	patch: 3
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
var $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
var $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
var $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
var $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
var $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
var $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
var $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
var $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
var $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
var $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$1);
	$ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
var $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
var $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
var $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
var $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
var $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
var $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
var $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
var $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
var $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
var $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
var $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
var $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
var $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
	def.inclusive = false;
	$ZodUnion.init(inst, def);
	const _super = inst._zod.parse;
	defineLazy(inst._zod, "propValues", () => {
		const propValues = {};
		for (const option of def.options) {
			const pv = option._zod.propValues;
			if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
			for (const [k, v] of Object.entries(pv)) {
				if (!propValues[k]) propValues[k] = /* @__PURE__ */ new Set();
				for (const val of v) propValues[k].add(val);
			}
		}
		return propValues;
	});
	const disc = cached(() => {
		const opts = def.options;
		const map = /* @__PURE__ */ new Map();
		for (const o of opts) {
			const values = o._zod.propValues?.[def.discriminator];
			if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
			for (const v of values) {
				if (map.has(v)) throw new Error(`Duplicate discriminator value "${String(v)}"`);
				map.set(v, o);
			}
		}
		return map;
	});
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				code: "invalid_type",
				expected: "object",
				input,
				inst
			});
			return payload;
		}
		const opt = disc.value.get(input?.[def.discriminator]);
		if (opt) return opt._zod.run(payload, ctx);
		if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
		payload.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: def.discriminator,
			options: Array.from(disc.value.keys()),
			input,
			path: [def.discriminator],
			inst
		});
		return payload;
	};
});
var $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
var $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values) {
			payload.value = {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				unrecognized = unrecognized ?? [];
				unrecognized.push(key);
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized
			});
		} else {
			payload.value = {};
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
var $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
var $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
	const values = new Set(def.values);
	inst._zod.values = values;
	inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
var $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
var $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
var $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
var $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
var $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
var $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
var $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process$1(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process$1(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
var numberProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
var enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
var literalProcessor = (schema, ctx, json, _params) => {
	const def = schema._zod.def;
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof val === "bigint") {
		if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
		else vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
var customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process$1(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
var objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process$1(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process$1(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
var unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process$1(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
var intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process$1(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process$1(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
var recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = keyType._zod.bag?.patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = process$1(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process$1(def.keyType, ctx, {
			...params,
			path: [...params.path, "propertyNames"]
		});
		json.additionalProperties = process$1(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	if (keyValues) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues;
	}
};
var nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process$1(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date(params) {
	return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
var ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
var ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
var initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
var ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
var ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(/* @__PURE__ */ _overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
var _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(/* @__PURE__ */ _regex(...args));
		},
		includes(...args) {
			return this.check(/* @__PURE__ */ _includes(...args));
		},
		startsWith(...args) {
			return this.check(/* @__PURE__ */ _startsWith(...args));
		},
		endsWith(...args) {
			return this.check(/* @__PURE__ */ _endsWith(...args));
		},
		min(...args) {
			return this.check(/* @__PURE__ */ _minLength(...args));
		},
		max(...args) {
			return this.check(/* @__PURE__ */ _maxLength(...args));
		},
		length(...args) {
			return this.check(/* @__PURE__ */ _length(...args));
		},
		nonempty(...args) {
			return this.check(/* @__PURE__ */ _minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(/* @__PURE__ */ _lowercase(params));
		},
		uppercase(params) {
			return this.check(/* @__PURE__ */ _uppercase(params));
		},
		trim() {
			return this.check(/* @__PURE__ */ _trim());
		},
		normalize(...args) {
			return this.check(/* @__PURE__ */ _normalize(...args));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ _toLowerCase());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ _toUpperCase());
		},
		slugify() {
			return this.check(/* @__PURE__ */ _slugify());
		}
	});
});
var ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
	inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
	inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
var ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
var ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	_installLazyMethods(inst, "ZodNumber", {
		gt(value, params) {
			return this.check(/* @__PURE__ */ _gt(value, params));
		},
		gte(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		min(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		lt(value, params) {
			return this.check(/* @__PURE__ */ _lt(value, params));
		},
		lte(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		max(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		int(params) {
			return this.check(int(params));
		},
		safe(params) {
			return this.check(int(params));
		},
		positive(params) {
			return this.check(/* @__PURE__ */ _gt(0, params));
		},
		nonnegative(params) {
			return this.check(/* @__PURE__ */ _gte(0, params));
		},
		negative(params) {
			return this.check(/* @__PURE__ */ _lt(0, params));
		},
		nonpositive(params) {
			return this.check(/* @__PURE__ */ _lte(0, params));
		},
		multipleOf(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		step(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		finite() {
			return this;
		}
	});
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
});
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
var ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
var ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
var ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
var ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
var ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(/* @__PURE__ */ _minLength(n, params));
		},
		nonempty(params) {
			return this.check(/* @__PURE__ */ _minLength(1, params));
		},
		max(n, params) {
			return this.check(/* @__PURE__ */ _maxLength(n, params));
		},
		length(n, params) {
			return this.check(/* @__PURE__ */ _length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
var ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function object(shape, params) {
	return new ZodObject({
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	});
}
var ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
var ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
	ZodUnion.init(inst, def);
	$ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
	return new ZodDiscriminatedUnion({
		type: "union",
		options,
		discriminator,
		...normalizeParams(params)
	});
}
var ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
var ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
var ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	return new ZodEnum({
		type: "enum",
		entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
		...normalizeParams(params)
	});
}
var ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
var ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
var ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
var ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
var ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
var ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
var ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
var ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
var ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
var ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region ../../packages/platform-api/src/session-payloads.ts
/**
* RTU 会话 RPC 载荷（HostMessage v1，VSCode 端接线，docs/TECH_DESIGN.md §22/§23）。
*
* 跨边界传输的领域对象用「可序列化投影」：Zod schema 产出纯 JSON 载荷类型，
* 配合 toXxxPayload / xxxFromPayload 在边界往返。品牌化 ID（ConnectionProfileId /
* RowId）在 JSON 往返后丢失名义类型，由 FromPayload 重建（结构化收窄，非蒙混）。
*
* 本文件只定义领域对象投影，不包含 Envelope / kind 白名单（见 host-message.ts），
* 不反向依赖 host-message.ts，避免循环导入。
*/
function bytesToHex(bytes) {
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var rtuConnectionProfilePayloadSchema = object({
	id: string(),
	name: string(),
	protocol: literal("rtu"),
	baudRate: number(),
	dataBits: union([literal(7), literal(8)]),
	stopBits: union([literal(1), literal(2)]),
	parity: _enum([
		"none",
		"even",
		"odd"
	]),
	flowControl: _enum([
		"off",
		"rts-cts",
		"xon-xoff"
	]),
	requestTimeoutMs: number(),
	retryCount: number(),
	/** Rx Delay：请求间隔，兼作 WP 轮询间隔。 */
	interRequestDelayMs: number(),
	addressAdjust: _enum(["off", "on"]),
	recentPortHint: string().nullable()
});
var tcpConnectionProfilePayloadSchema = object({
	id: string(),
	name: string(),
	protocol: literal("tcp"),
	host: string(),
	port: number(),
	unitId: number(),
	connectTimeoutMs: number(),
	requestTimeoutMs: number(),
	retryCount: number(),
	autoReconnect: boolean(),
	interRequestDelayMs: number()
});
function tcpConnectionProfileFromPayload(payload) {
	return {
		...payload,
		id: payload.id
	};
}
/** session-tcp-connect 载荷（2026-08-23）：TCP 无串口句柄，profile 即完整连接参数。 */
var sessionTcpConnectPayloadSchema = object({ profile: tcpConnectionProfilePayloadSchema });
var dataTypeEnumSchema = _enum([
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
]);
var registerAddressPayloadSchema = object({ value: number() });
var registerRowPayloadSchema = object({
	rowId: string(),
	order: number(),
	name: string(),
	comment: string(),
	addressDraft: string(),
	addressValue: registerAddressPayloadSchema.nullable(),
	dataType: dataTypeEnumSchema,
	pollingEnabled: boolean(),
	traceEnabled: boolean(),
	cellText: string(),
	lastKnownRawValue: registerAddressPayloadSchema.nullable(),
	createdAt: number(),
	updatedAt: number()
});
function registerRowFromPayload(payload) {
	const address = payload.addressValue === null ? null : RegisterAddress.create(payload.addressValue.value);
	const lastKnown = payload.lastKnownRawValue === null ? null : RawRegisterValue.create(payload.lastKnownRawValue.value);
	return {
		...payload,
		rowId: payload.rowId,
		addressValue: address === null ? null : address.ok ? address.value : null,
		lastKnownRawValue: lastKnown === null ? null : lastKnown.ok ? lastKnown.value : null
	};
}
var batchReadRowPayloadSchema = object({
	key: string(),
	/** null 表示地址为空或非法，将被跳过。 */
	address: number().nullable()
});
var batchReadSummaryPayloadSchema = object({
	batchId: string(),
	totalRows: number(),
	eligibleRows: number(),
	successCount: number(),
	failureCount: number(),
	skippedCount: number(),
	cancelledCount: number(),
	startedAt: number(),
	completedAt: number(),
	durationMs: number()
});
function toBatchReadSummaryPayload(summary) {
	return { ...summary };
}
object({ kind: literal("write-succeeded-no-verify") });
function toWriteOutcomePayload(outcome) {
	return { ...outcome };
}
var commLogEventPayloadSchema = object({
	timestamp: number(),
	direction: _enum(["request", "response"]),
	bytesHex: string(),
	/** 协议：rtu / tcp（2026-08-23 TCP 接线）。 */
	protocol: _enum(["rtu", "tcp"]),
	slaveAddress: number().nullable(),
	functionCode: number().nullable(),
	userAddress: number().nullable(),
	sentAddress: number().nullable(),
	quantity: number().nullable(),
	attempt: number(),
	status: _enum([
		"success",
		"failure",
		"timeout",
		"cancelled",
		"discarded"
	]),
	errorCode: string().nullable(),
	exceptionCode: number().nullable(),
	source: _enum([
		"manual-read",
		"manual-write",
		"batch-read",
		"polling",
		"trace",
		"plugin",
		"connection-control"
	]),
	durationMs: number().nullable()
});
function toCommLogEventPayload(event) {
	return {
		...event,
		bytesHex: bytesToHex(event.bytes)
	};
}
var traceSamplePayloadSchema = object({
	key: string(),
	sequence: number(),
	rawValue: number(),
	timestamp: number()
});
var appMessagePayloadSchema = object({
	timestamp: number(),
	level: _enum([
		"info",
		"warning",
		"error"
	]),
	messageKey: string(),
	params: record(string(), union([string(), number()])).optional(),
	detail: string().nullable()
});
function toAppMessagePayload(message) {
	return { ...message };
}
/** Electron IPC 频道：invoke（request/response/error）与 event 分开。 */
var MAMEP_IPC_INVOKE_CHANNEL = "mamep:invoke";
var MAMEP_IPC_EVENT_CHANNEL = "mamep:event";
/** request kind 白名单：主进程只处理这些 kind，其余一律拒绝。 */
var HOST_REQUEST_KINDS = [
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
];
/** 串口选项（Electron enumerated：主进程 select-serial-port 转发的可序列化端口列表项）。 */
var serialPortOptionSchema = object({
	portId: string(),
	label: string()
});
/** 宿主颜色主题（UI 侧映射为 antd light/dark；高对比度由宿主映射为 dark）。 */
var colorThemeSchema = _enum(["light", "dark"]);
var protocolVersionSchema = literal(1);
var messageIdSchema = string().min(1);
var requestKindSchema = _enum(HOST_REQUEST_KINDS);
var errorCategorySchema = _enum([
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
]);
var errorSeveritySchema = _enum([
	"info",
	"warning",
	"error",
	"fatal"
]);
var connectionStateSchema = _enum([
	"disconnected",
	"selecting-device",
	"connecting",
	"connected",
	"disconnecting",
	"reconnect-waiting",
	"reconnecting",
	"interrupted",
	"failed"
]);
/** 错误可序列化投影：跨进程传输 MamepError 的结构化字段（不含 cause/context 等本地对象）。 */
var hostErrorPayloadSchema = object({
	code: string(),
	category: errorCategorySchema,
	severity: errorSeveritySchema,
	retryable: boolean(),
	userMessageKey: string(),
	technicalMessage: string()
});
function toErrorPayload(error) {
	return {
		code: error.code,
		category: error.category,
		severity: error.severity,
		retryable: error.retryable,
		userMessageKey: error.userMessageKey,
		technicalMessage: error.technicalMessage
	};
}
/** Result<number> 可序列化投影（事件载荷用，如 poll-result）。 */
var hostResultPayloadSchema = discriminatedUnion("ok", [object({
	ok: literal(true),
	value: number()
}), object({
	ok: literal(false),
	error: hostErrorPayloadSchema
})]);
function toResultPayload(result) {
	return result.ok ? {
		ok: true,
		value: result.value
	} : {
		ok: false,
		error: toErrorPayload(result.error)
	};
}
/** session-connect 载荷。 */
var sessionConnectPayloadSchema = object({
	portId: string(),
	profile: rtuConnectionProfilePayloadSchema,
	slaveAddress: number()
});
object({ connectionState: connectionStateSchema });
object({ summary: batchReadSummaryPayloadSchema });
var requestBase = {
	protocolVersion: protocolVersionSchema,
	type: literal("request"),
	messageId: messageIdSchema
};
var hostRequestSchema = discriminatedUnion("kind", [
	object({
		...requestBase,
		kind: literal("get-capabilities"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("get-app-version"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("copy-text-to-clipboard"),
		payload: object({ text: string() })
	}),
	object({
		...requestBase,
		kind: literal("read-text-from-clipboard"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("select-serial-port"),
		payload: object({ portId: string() })
	}),
	object({
		...requestBase,
		kind: literal("get-color-theme"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("debug:get-state"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("serial-enumerate"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("session-connect"),
		payload: sessionConnectPayloadSchema
	}),
	object({
		...requestBase,
		kind: literal("session-disconnect"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("session-get-state"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("session-set-slave-address"),
		payload: object({ slave: number() })
	}),
	object({
		...requestBase,
		kind: literal("session-read-row"),
		payload: object({ row: registerRowPayloadSchema })
	}),
	object({
		...requestBase,
		kind: literal("session-write-row"),
		payload: object({ row: registerRowPayloadSchema })
	}),
	object({
		...requestBase,
		kind: literal("session-batch-read"),
		payload: object({ rows: array(batchReadRowPayloadSchema) })
	}),
	object({
		...requestBase,
		kind: literal("session-update-polling-targets"),
		payload: object({ rows: array(object({
			key: string(),
			address: number()
		})) })
	}),
	object({
		...requestBase,
		kind: literal("session-polling-start"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("session-polling-stop"),
		payload: object({})
	}),
	object({
		...requestBase,
		kind: literal("session-trace-start"),
		payload: object({
			key: string(),
			address: number(),
			speedMs: number()
		})
	}),
	object({
		...requestBase,
		kind: literal("session-trace-stop"),
		payload: object({ key: string() })
	}),
	object({
		...requestBase,
		kind: literal("session-tcp-connect"),
		payload: sessionTcpConnectPayloadSchema
	})
]);
union([
	hostRequestSchema,
	object({
		protocolVersion: protocolVersionSchema,
		type: literal("response"),
		messageId: messageIdSchema,
		kind: requestKindSchema,
		ok: literal(true),
		payload: unknown()
	}),
	object({
		protocolVersion: protocolVersionSchema,
		type: literal("error"),
		messageId: messageIdSchema,
		kind: string(),
		payload: hostErrorPayloadSchema
	}),
	discriminatedUnion("kind", [
		object({
			protocolVersion: protocolVersionSchema,
			type: literal("event"),
			messageId: messageIdSchema,
			kind: literal("connection-state"),
			payload: object({ state: connectionStateSchema })
		}),
		object({
			protocolVersion: protocolVersionSchema,
			type: literal("event"),
			messageId: messageIdSchema,
			kind: literal("serial-ports-available"),
			payload: object({ ports: array(serialPortOptionSchema) })
		}),
		object({
			protocolVersion: protocolVersionSchema,
			type: literal("event"),
			messageId: messageIdSchema,
			kind: literal("color-theme-changed"),
			payload: object({ theme: colorThemeSchema })
		}),
		object({
			protocolVersion: protocolVersionSchema,
			type: literal("event"),
			messageId: messageIdSchema,
			kind: literal("comm-log"),
			payload: object({ event: commLogEventPayloadSchema })
		}),
		object({
			protocolVersion: protocolVersionSchema,
			type: literal("event"),
			messageId: messageIdSchema,
			kind: literal("poll-result"),
			payload: object({
				key: string(),
				address: number(),
				result: hostResultPayloadSchema
			})
		}),
		object({
			protocolVersion: protocolVersionSchema,
			type: literal("event"),
			messageId: messageIdSchema,
			kind: literal("trace-sample"),
			payload: object({ sample: traceSamplePayloadSchema })
		}),
		object({
			protocolVersion: protocolVersionSchema,
			type: literal("event"),
			messageId: messageIdSchema,
			kind: literal("app-message"),
			payload: object({ message: appMessagePayloadSchema })
		})
	])
]);
/**
* Electron 能力矩阵（ADR-017 扩展，2026-08-21；2026-08-23 TCP 接线）：MVP 串口仍经
* Web Serial API（Renderer navigator.serial，serialPorts:"enumerated" 下拉选择）；
* Modbus TCP 已接线——会话承载在主进程（Node TCP Adapter + TcpSessionHost），
* Renderer 经 HostMessage v1 远程代理（modbusTcp:true）。
*/
var electronCapabilities = Object.freeze({
	modbusRtu: true,
	modbusTcp: true,
	serialPorts: "enumerated",
	filesystem: "limited",
	nodePlugins: false,
	webPlugins: true
});
Object.freeze({
	modbusRtu: true,
	modbusTcp: true,
	serialPorts: "enumerated",
	filesystem: "unsupported",
	nodePlugins: false,
	webPlugins: true
});
//#endregion
//#region ../electron/src/main/ipc.ts
/**
* 安全 IPC 处理核心（可测纯函数，docs/TECH_DESIGN.md §22.3、docs/AGENTS.md §23）。
* 与 electron 运行时解耦：外部能力经 IpcDeps 注入，便于单测校验/分发/拒绝路径
* （未知 kind、非法 payload、发送者校验、debug 探针打包禁用等）。
*/
/** 会话 RPC 包装：run 返回 Result 并映射为 response/error Envelope。 */
async function sessionResult(message, run) {
	try {
		const result = await run();
		if (result.ok) return okResponse(message, result.value);
		return errorEnvelope(message.messageId, result.error.code, result.error.technicalMessage);
	} catch (cause) {
		return errorEnvelope(message.messageId, "SESSION_INTERNAL_ERROR", cause instanceof Error ? cause.message : String(cause));
	}
}
/** 会话 void 命令包装（轮询/追踪/目标更新等）。 */
async function sessionVoid(message, run) {
	try {
		run();
		return okResponse(message, null);
	} catch (cause) {
		return errorEnvelope(message.messageId, "SESSION_INTERNAL_ERROR", cause instanceof Error ? cause.message : String(cause));
	}
}
/** 尽力从无法解析的原始消息中提取 messageId（诊断用；解析失败时为空串）。 */
function extractMessageId(raw) {
	if (typeof raw !== "object" || raw === null) return "";
	const id = raw.messageId;
	return typeof id === "string" && id.length > 0 ? id : "";
}
function errorEnvelope(messageId, code, technicalMessage) {
	return {
		protocolVersion: 1,
		type: "error",
		messageId,
		kind: "host-error",
		payload: toErrorPayload(createMamepError({
			code,
			category: "internal",
			userMessageKey: "errors.hostMessageRejected",
			technicalMessage
		}))
	};
}
function okResponse(message, payload) {
	return {
		protocolVersion: 1,
		type: "response",
		messageId: message.messageId,
		kind: message.kind,
		ok: true,
		payload: payload === void 0 ? null : payload
	};
}
async function handleRequest(message, deps, sender) {
	switch (message.kind) {
		case "get-capabilities": return okResponse(message, electronCapabilities);
		case "get-app-version": return okResponse(message, deps.appVersion());
		case "copy-text-to-clipboard":
			deps.clipboardWriteText(message.payload.text);
			return okResponse(message, null);
		case "read-text-from-clipboard": return okResponse(message, deps.clipboardReadText());
		case "select-serial-port":
			if (deps.resolveSerialPortSelection(message.payload.portId, sender)) return okResponse(message, null);
			return errorEnvelope(message.messageId, "SERIAL_PICKER_NOT_ACTIVE", "no pending serial port selection for this sender");
		case "get-color-theme": return errorEnvelope(message.messageId, "COLOR_THEME_UNSUPPORTED", "color theme RPC is not supported on the Electron host");
		case "serial-enumerate":
		case "session-connect":
		case "session-set-slave-address": return errorEnvelope(message.messageId, "SESSION_NOT_AVAILABLE", "RTU session RPC runs in the renderer (Web Serial); not handled by the Electron main host");
		case "session-tcp-connect": {
			const { profile } = message.payload;
			return sessionResult(message, () => deps.session.connectTcp(tcpConnectionProfileFromPayload(profile)));
		}
		case "session-disconnect": return sessionResult(message, () => deps.session.disconnect());
		case "session-get-state": return sessionResult(message, () => Promise.resolve({
			ok: true,
			value: { connectionState: deps.session.getConnectionState() }
		}));
		case "session-read-row": {
			const { row } = message.payload;
			return sessionResult(message, () => deps.session.readRow(registerRowFromPayload(row)));
		}
		case "session-write-row": {
			const { row } = message.payload;
			return sessionResult(message, async () => {
				const result = await deps.session.writeRow(registerRowFromPayload(row));
				return result.ok ? ok(toWriteOutcomePayload(result.value)) : result;
			});
		}
		case "session-batch-read": {
			const { rows } = message.payload;
			return sessionResult(message, async () => {
				const result = await deps.session.readAllRows(rows.map((r) => ({
					key: r.key,
					address: r.address
				}))).promise;
				return result.ok ? ok({ summary: toBatchReadSummaryPayload(result.value) }) : result;
			});
		}
		case "session-update-polling-targets": return sessionVoid(message, () => deps.session.updatePollingTargets(message.payload.rows));
		case "session-polling-start": return sessionVoid(message, () => deps.session.startPolling());
		case "session-polling-stop": return sessionVoid(message, () => deps.session.stopPolling());
		case "session-trace-start": return sessionVoid(message, () => deps.session.traceStart(message.payload.key, message.payload.address, message.payload.speedMs));
		case "session-trace-stop": return sessionVoid(message, () => deps.session.traceStop(message.payload.key));
		case "debug:get-state":
			if (deps.isPackaged()) return errorEnvelope(message.messageId, "DEBUG_PROBE_DISABLED", "debug probe is disabled in packaged builds");
			return okResponse(message, {
				platform: "electron",
				appVersion: deps.appVersion(),
				packaged: deps.isPackaged(),
				windowCount: deps.windowCount(),
				connectionState: deps.connectionState(),
				uptimeMs: deps.uptimeMs()
			});
		default: return message;
	}
}
async function handleInvoke(raw, options) {
	if (!options.isSenderMainWindow) return errorEnvelope(extractMessageId(raw), "HOST_MESSAGE_SENDER_REJECTED", "message sender is not the main window");
	const parsed = hostRequestSchema.safeParse(raw);
	if (!parsed.success) return errorEnvelope(extractMessageId(raw), "HOST_MESSAGE_INVALID", `invalid host request: ${parsed.error.message}`);
	return handleRequest(parsed.data, options.deps, options.sender);
}
//#endregion
//#region ../../packages/communication/src/cancellation.ts
function createCancellationToken() {
	let cancelled = false;
	let reason = null;
	return {
		get cancelled() {
			return cancelled;
		},
		get reason() {
			return reason;
		},
		cancel(cancelReason = "cancelled") {
			if (!cancelled) {
				cancelled = true;
				reason = cancelReason;
			}
		}
	};
}
//#endregion
//#region ../../packages/communication/src/batch-read-coordinator.ts
/**
* 全表读取协调器（docs/TECH_DESIGN.md §14、docs/AGENTS.md §15）。
* 一次性批量读取：快照、跳过非法行、单行失败继续、可取消尚未执行的任务、输出汇总。
*/
var BatchReadCoordinator = class {
	seq = 0;
	session;
	clock;
	constructor(session, clock) {
		this.session = session;
		this.clock = clock;
	}
	readAll(rows, onRowResult) {
		const batchId = `batch-${++this.seq}`;
		const cancelToken = createCancellationToken();
		const eligible = rows.filter((row) => row.address !== null);
		const skippedCount = rows.length - eligible.length;
		const startedAt = this.clock.now();
		let successCount = 0;
		let failureCount = 0;
		let cancelledCount = 0;
		let completed = 0;
		return {
			promise: new Promise((resolve) => {
				const finish = () => {
					if (completed < eligible.length) return;
					const completedAt = this.clock.now();
					resolve(ok({
						batchId,
						totalRows: rows.length,
						eligibleRows: eligible.length,
						successCount,
						failureCount,
						skippedCount,
						cancelledCount,
						startedAt,
						completedAt,
						durationMs: completedAt - startedAt
					}));
				};
				if (eligible.length === 0) {
					finish();
					return;
				}
				for (const row of eligible) this.session.readRegister(row.address ?? 0, {
					source: "batch-read",
					priority: "batch-read",
					group: batchId,
					cancelToken
				}).then((result) => {
					onRowResult?.(row.key, result);
					if (result.ok) successCount += 1;
					else if (result.error.code === "CANCELLED") cancelledCount += 1;
					else failureCount += 1;
					completed += 1;
					finish();
				});
			}),
			cancel: () => cancelToken.cancel("batch-cancelled")
		};
	}
};
//#endregion
//#region ../../packages/communication/src/connection-state-machine.ts
/**
* 连接状态机（docs/AGENTS.md §11.4、docs/TECH_DESIGN.md §10）。
* 状态必须通过受控状态机管理，禁止任意写入状态字符串。
*/
var LEGAL_TRANSITIONS = {
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
};
var ConnectionStateMachine = class {
	state = "disconnected";
	listeners = /* @__PURE__ */ new Set();
	getState() {
		return this.state;
	}
	/** 仅用于测试或从外部事实恢复状态；正常运行必须走 transition。 */
	forceState(state) {
		this.setState(state);
	}
	transition(to) {
		const legal = LEGAL_TRANSITIONS[this.state];
		if (legal === void 0 || !legal.has(to)) return fail(createMamepError({
			code: "ILLEGAL_STATE_TRANSITION",
			category: "connection",
			severity: "error",
			retryable: false,
			userMessageKey: "errors.illegalStateTransition",
			technicalMessage: `illegal connection state transition ${this.state} -> ${to}`
		}));
		this.setState(to);
		return ok(void 0);
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	setState(state) {
		if (this.state === state) return;
		this.state = state;
		for (const listener of this.listeners) listener(state);
	}
};
//#endregion
//#region ../../packages/communication/src/polling-coordinator.ts
var PollingCoordinator = class {
	targets = [];
	inFlight = /* @__PURE__ */ new Set();
	skippedTicks = /* @__PURE__ */ new Map();
	timer = null;
	runningFlag = false;
	listeners = /* @__PURE__ */ new Set();
	session;
	clock;
	options;
	constructor(session, clock, options) {
		this.session = session;
		this.clock = clock;
		this.options = options;
	}
	get isRunning() {
		return this.runningFlag;
	}
	getSkippedTicks(key) {
		return this.skippedTicks.get(key) ?? 0;
	}
	onResult(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	setTargets(targets) {
		this.targets = [...targets];
	}
	start() {
		if (this.runningFlag) return;
		this.runningFlag = true;
		this.scheduleNext();
	}
	stop() {
		this.runningFlag = false;
		this.timer?.cancel();
		this.timer = null;
	}
	scheduleNext() {
		this.timer = this.clock.schedule(() => this.tick(), this.options.getIntervalMs());
	}
	tick() {
		if (!this.runningFlag) return;
		for (const target of this.targets) {
			if (this.inFlight.has(target.key)) {
				this.skippedTicks.set(target.key, (this.skippedTicks.get(target.key) ?? 0) + 1);
				continue;
			}
			this.inFlight.add(target.key);
			const requestedAddress = target.address;
			this.session.readRegister(target.address, {
				source: "polling",
				priority: "polling"
			}).then((result) => {
				this.inFlight.delete(target.key);
				for (const listener of this.listeners) listener(target.key, requestedAddress, result);
			});
		}
		this.scheduleNext();
	}
};
//#endregion
//#region ../../packages/communication/src/request-scheduler.ts
/**
* 单连接请求调度器（docs/AGENTS.md §12）。
* - 同一连接任意时刻只执行一个设备请求；
* - 优先级只影响尚未开始的任务，不中断已发送请求；
* - 公平性：等待超过阈值的任务按 FIFO 执行，避免低优先级饥饿；
* - 相邻任务之间应用 interRequestDelayMs（Rx Delay，可取消）。
*/
var PRIORITY_ORDER = [
	"connection-control",
	"manual-write",
	"manual-read",
	"write-verify",
	"batch-read",
	"polling",
	"plugin-background"
];
var RequestScheduler = class {
	queue = [];
	running = false;
	lastTaskCompletedAt = 0;
	nextId = 1;
	pendingSleepResolve = null;
	clock;
	options;
	constructor(clock, options) {
		this.clock = clock;
		this.options = options;
	}
	get pendingCount() {
		return this.queue.length;
	}
	enqueue(run, options) {
		return new Promise((resolve) => {
			const task = {
				id: this.nextId++,
				priority: options.priority,
				group: options.group ?? null,
				cancelToken: options.cancelToken ?? null,
				createdAt: this.clock.now(),
				run,
				resolve: (result) => resolve(result)
			};
			this.queue.push(task);
			this.drain();
		});
	}
	/** 取消尚未开始的同组任务；已执行中的任务不被中断。 */
	cancelGroup(group) {
		for (const task of this.queue) if (task.group === group && !task.cancelToken?.cancelled) task.cancelToken?.cancel();
		this.drain();
	}
	cancelAll() {
		for (const task of this.queue) if (!task.cancelToken?.cancelled) task.cancelToken?.cancel();
		this.pendingSleepResolve?.();
	}
	async drain() {
		if (this.running) return;
		this.running = true;
		try {
			while (true) {
				const task = this.pickNext();
				if (task === null) break;
				const delayMs = this.lastTaskCompletedAt === 0 ? 0 : this.options.getInterRequestDelayMs();
				if (delayMs > 0 && !task.cancelToken?.cancelled) await this.sleep(delayMs);
				if (task.cancelToken?.cancelled) {
					task.resolve(fail(createMamepError({
						code: "CANCELLED",
						category: "cancellation",
						severity: "info",
						retryable: false,
						userMessageKey: "errors.cancelled",
						technicalMessage: task.cancelToken.reason ?? "task cancelled"
					})));
					continue;
				}
				try {
					const result = await task.run();
					this.lastTaskCompletedAt = this.clock.now();
					task.resolve(result);
				} catch (cause) {
					task.resolve(fail(createMamepError({
						code: "INTERNAL_ERROR",
						category: "internal",
						severity: "error",
						retryable: false,
						userMessageKey: "errors.internal",
						technicalMessage: cause instanceof Error ? cause.message : String(cause),
						cause
					})));
				}
			}
		} finally {
			this.running = false;
		}
	}
	pickNext() {
		const alive = [];
		for (const task of this.queue) if (task.cancelToken?.cancelled) task.resolve(fail(createMamepError({
			code: "CANCELLED",
			category: "cancellation",
			severity: "info",
			retryable: false,
			userMessageKey: "errors.cancelled",
			technicalMessage: task.cancelToken.reason ?? "task cancelled"
		})));
		else alive.push(task);
		this.queue = alive;
		if (alive.length === 0) return null;
		const now = this.clock.now();
		let starved = null;
		for (const task of alive) if (now - task.createdAt >= this.options.fairnessThresholdMs) {
			if (starved === null || task.createdAt < starved.createdAt) starved = task;
		}
		if (starved !== null) {
			this.queue = alive.filter((t) => t !== starved);
			return starved;
		}
		let best = null;
		for (const task of alive) {
			if (best === null) {
				best = task;
				continue;
			}
			const bestRank = PRIORITY_ORDER.indexOf(best.priority);
			const taskRank = PRIORITY_ORDER.indexOf(task.priority);
			if (taskRank < bestRank || taskRank === bestRank && task.createdAt < best.createdAt) best = task;
		}
		if (best !== null) this.queue = alive.filter((t) => t !== best);
		return best;
	}
	sleep(ms) {
		return new Promise((resolve) => {
			const finish = () => {
				this.pendingSleepResolve = null;
				resolve();
			};
			this.pendingSleepResolve = finish;
			this.clock.schedule(finish, ms);
		});
	}
};
//#endregion
//#region ../../packages/protocol-modbus/src/crc16.ts
/**
* CRC-16/Modbus（多项式 0xA001，初始 0xFFFF，字节序低字节在前）。
*/
function crc16Modbus(bytes, start = 0, end = bytes.length) {
	let crc = 65535;
	for (let i = start; i < end; i++) {
		crc ^= bytes[i] ?? 0;
		for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >> 1 ^ 40961 : crc >> 1;
	}
	return crc & 65535;
}
/** 将 CRC 附加到帧尾（低字节在前）。 */
function appendCrc(body) {
	const crc = crc16Modbus(body);
	const frame = new Uint8Array(body.length + 2);
	frame.set(body, 0);
	frame[body.length] = crc & 255;
	frame[body.length + 1] = crc >> 8 & 255;
	return frame;
}
function encodeReadHoldingRegistersRequest(request) {
	return appendCrc(Uint8Array.from([
		request.slaveAddress & 255,
		3,
		request.startAddress >> 8 & 255,
		request.startAddress & 255,
		request.quantity >> 8 & 255,
		request.quantity & 255
	]));
}
/** 即使只写一个寄存器也使用功能码 0x10（docs/AGENTS.md §5.1）。 */
function encodeWriteSingleRegisterRequest(request) {
	return appendCrc(Uint8Array.from([
		request.slaveAddress & 255,
		16,
		request.address >> 8 & 255,
		request.address & 255,
		0,
		1,
		2,
		request.rawValue >> 8 & 255,
		request.rawValue & 255
	]));
}
function protocolError$1(code, technicalMessage) {
	return createMamepError({
		code,
		category: "protocol",
		severity: "error",
		retryable: false,
		userMessageKey: `errors.${code.toLowerCase().replaceAll("_", "")}`,
		technicalMessage
	});
}
function decodeRtuResponse(frame, expected) {
	if (frame.length < 4) return fail(protocolError$1("RTU_INVALID_LENGTH", `frame too short: ${frame.length} bytes`));
	const bodyLength = frame.length - 2;
	const expectedCrc = crc16Modbus(frame, 0, bodyLength);
	const actualCrc = (frame[bodyLength] ?? 0) | (frame[bodyLength + 1] ?? 0) << 8;
	if (actualCrc !== expectedCrc) return fail(protocolError$1("RTU_CRC_MISMATCH", `crc mismatch: expected ${expectedCrc.toString(16)}, got ${actualCrc.toString(16)}`));
	const slaveAddress = frame[0] ?? -1;
	if (slaveAddress !== expected.slaveAddress) return fail(protocolError$1("RTU_SLAVE_MISMATCH", `slave mismatch: expected ${expected.slaveAddress}, got ${slaveAddress}`));
	const functionCode = frame[1] ?? -1;
	const expectedFunction = expected.kind === "read-holding" ? 3 : 16;
	if ((functionCode & 127) === expectedFunction && (functionCode & 128) !== 0) {
		if (frame.length !== 5) return fail(protocolError$1("RTU_INVALID_LENGTH", `exception frame must be 5 bytes, got ${frame.length}`));
		return ok({
			kind: "exception",
			exceptionCode: frame[2] ?? 0
		});
	}
	if (functionCode !== expectedFunction) return fail(protocolError$1("RTU_FUNCTION_MISMATCH", `function mismatch: expected ${expectedFunction.toString(16)}, got ${functionCode.toString(16)}`));
	if (expected.kind === "read-holding") {
		if (frame.length !== 5 + expected.quantity * 2) return fail(protocolError$1("RTU_INVALID_LENGTH", `read frame must be ${5 + expected.quantity * 2} bytes, got ${frame.length}`));
		const byteCount = frame[2] ?? -1;
		if (byteCount !== expected.quantity * 2) return fail(protocolError$1("RTU_BYTE_COUNT_MISMATCH", `byte count expected ${expected.quantity * 2}, got ${byteCount}`));
		const values = [];
		for (let i = 0; i < expected.quantity; i++) {
			const hi = frame[3 + i * 2];
			const lo = frame[4 + i * 2];
			if (hi === void 0 || lo === void 0) return fail(protocolError$1("RTU_DATA_LENGTH_MISMATCH", "read response data truncated"));
			values.push(hi << 8 | lo);
		}
		return ok({
			kind: "read-holding",
			values
		});
	}
	if (frame.length !== 8) return fail(protocolError$1("RTU_INVALID_LENGTH", `write frame must be 8 bytes, got ${frame.length}`));
	const respAddress = (frame[2] ?? 0) << 8 | (frame[3] ?? 0);
	if (respAddress !== expected.address) return fail(protocolError$1("RTU_ADDRESS_MISMATCH", `address expected ${expected.address}, got ${respAddress}`));
	const respQuantity = (frame[4] ?? 0) << 8 | (frame[5] ?? 0);
	if (respQuantity !== expected.quantity) return fail(protocolError$1("RTU_QUANTITY_MISMATCH", `quantity expected ${expected.quantity}, got ${respQuantity}`));
	return ok({ kind: "write-single" });
}
function protocolError(code, technicalMessage) {
	return createMamepError({
		code,
		category: "protocol",
		severity: "error",
		retryable: false,
		userMessageKey: `errors.${code.toLowerCase().replaceAll("_", "")}`,
		technicalMessage
	});
}
/** 组 MBAP 头 + PDU 为完整 ADU。length = unitId(1) + pdu.length。 */
function buildTcpFrame(transactionId, unitId, pdu) {
	const length = 1 + pdu.length;
	const frame = new Uint8Array(6 + length);
	frame[0] = transactionId >> 8 & 255;
	frame[1] = transactionId & 255;
	frame[2] = 0;
	frame[3] = 0;
	frame[4] = length >> 8 & 255;
	frame[5] = length & 255;
	frame[6] = unitId & 255;
	frame.set(pdu, 7);
	return frame;
}
function encodeTcpReadHoldingRegistersRequest(request) {
	const pdu = Uint8Array.from([
		3,
		request.startAddress >> 8 & 255,
		request.startAddress & 255,
		request.quantity >> 8 & 255,
		request.quantity & 255
	]);
	return buildTcpFrame(request.transactionId, request.unitId, pdu);
}
/** 即使只写一个寄存器也使用功能码 0x10（docs/AGENTS.md §5.1）。 */
function encodeTcpWriteSingleRegisterRequest(request) {
	const pdu = Uint8Array.from([
		16,
		request.address >> 8 & 255,
		request.address & 255,
		0,
		1,
		2,
		request.rawValue >> 8 & 255,
		request.rawValue & 255
	]);
	return buildTcpFrame(request.transactionId, request.unitId, pdu);
}
/** 解码 TCP 响应 ADU。MBAP 头 7 字节 + PDU；严格长度校验（长度字段与实收一致）。 */
function decodeTcpResponse(frame, expected) {
	if (frame.length < 8) return fail(protocolError("TCP_INVALID_LENGTH", `frame too short: ${frame.length} bytes`));
	const protocolId = (frame[2] ?? 0) << 8 | (frame[3] ?? 0);
	if (protocolId !== 0) return fail(protocolError("TCP_PROTOCOL_MISMATCH", `protocol identifier expected 0, got ${protocolId}`));
	const declaredLength = (frame[4] ?? 0) << 8 | (frame[5] ?? 0);
	if (frame.length !== 6 + declaredLength) return fail(protocolError("TCP_INVALID_LENGTH", `frame length ${frame.length} does not match MBAP length ${declaredLength}`));
	const transactionId = (frame[0] ?? 0) << 8 | (frame[1] ?? 0);
	if (transactionId !== expected.transactionId) return fail(protocolError("TCP_TRANSACTION_MISMATCH", `transaction id expected ${expected.transactionId}, got ${transactionId}`));
	const unitId = frame[6] ?? -1;
	if (unitId !== expected.unitId) return fail(protocolError("TCP_UNIT_ID_MISMATCH", `unit id expected ${expected.unitId}, got ${unitId}`));
	const functionCode = frame[7] ?? -1;
	const expectedFunction = expected.kind === "read-holding" ? 3 : 16;
	if ((functionCode & 127) === expectedFunction && (functionCode & 128) !== 0) {
		if (frame.length !== 9) return fail(protocolError("TCP_INVALID_LENGTH", `exception frame must be 9 bytes, got ${frame.length}`));
		return ok({
			kind: "exception",
			exceptionCode: frame[8] ?? 0
		});
	}
	if (functionCode !== expectedFunction) return fail(protocolError("TCP_FUNCTION_MISMATCH", `function mismatch: expected ${expectedFunction.toString(16)}, got ${functionCode.toString(16)}`));
	if (expected.kind === "read-holding") {
		if (frame.length !== 9 + expected.quantity * 2) return fail(protocolError("TCP_INVALID_LENGTH", `read frame must be ${9 + expected.quantity * 2} bytes, got ${frame.length}`));
		const byteCount = frame[8] ?? -1;
		if (byteCount !== expected.quantity * 2) return fail(protocolError("TCP_BYTE_COUNT_MISMATCH", `byte count expected ${expected.quantity * 2}, got ${byteCount}`));
		const values = [];
		for (let i = 0; i < expected.quantity; i++) {
			const hi = frame[9 + i * 2];
			const lo = frame[10 + i * 2];
			if (hi === void 0 || lo === void 0) return fail(protocolError("TCP_DATA_LENGTH_MISMATCH", "read response data truncated"));
			values.push(hi << 8 | lo);
		}
		return ok({
			kind: "read-holding",
			values
		});
	}
	if (frame.length !== 12) return fail(protocolError("TCP_INVALID_LENGTH", `write frame must be 12 bytes, got ${frame.length}`));
	const respAddress = (frame[8] ?? 0) << 8 | (frame[9] ?? 0);
	if (respAddress !== expected.address) return fail(protocolError("TCP_ADDRESS_MISMATCH", `address expected ${expected.address}, got ${respAddress}`));
	const respQuantity = (frame[10] ?? 0) << 8 | (frame[11] ?? 0);
	if (respQuantity !== expected.quantity) return fail(protocolError("TCP_QUANTITY_MISMATCH", `quantity expected ${expected.quantity}, got ${respQuantity}`));
	return ok({ kind: "write-single" });
}
//#endregion
//#region ../../packages/communication/src/tcp-frame-parser.ts
/**
* TCP 帧解析器（docs/TECH_DESIGN.md §8.6）。
* TCP 是字节流协议：维护接收缓冲，按 MBAP Header 中的 Length 分帧；
* 处理半包 / 粘包 / 多响应连续到达 / 迟到响应 / 非法 Length。无 CRC（与 RTU 的关键差异）。
* Transaction ID 由 CommunicationSession 维护（§8.7），本解析器按当前请求的 tid 匹配：
* 完整帧解码失败（tid / 协议标识 / unitId 不匹配等）时丢弃该帧继续解析——
* 迟到响应不得被后续请求误接收，当前请求的响应可能出现在其后的帧中。
*/
/** MBAP 头长度：transactionId(2) + protocolId(2) + length(2) + unitId(1)。 */
var MBAP_HEADER_LENGTH = 7;
/**
* 合法 Length 上限：unitId(1) + 最大 PDU(253) = 254（Modbus TCP 上限）。
* 超过视为噪声/损坏，丢弃首字节重新同步。
*/
var MAX_MBAP_LENGTH = 254;
var TcpFrameParser = class {
	buffer = [];
	expect;
	constructor(expect) {
		this.expect = expect;
	}
	push(chunk) {
		for (const byte of chunk) this.buffer.push(byte);
		return this.tryParse();
	}
	tryParse() {
		while (true) {
			if (this.buffer.length < MBAP_HEADER_LENGTH) return { done: false };
			const declaredLength = (this.buffer[4] ?? 0) << 8 | (this.buffer[5] ?? 0);
			if (declaredLength < 1 || declaredLength > MAX_MBAP_LENGTH) {
				this.buffer.shift();
				continue;
			}
			const frameLength = 6 + declaredLength;
			if (this.buffer.length < frameLength) return { done: false };
			const frame = Uint8Array.from(this.buffer.slice(0, frameLength));
			this.buffer = this.buffer.slice(frameLength);
			const result = decodeTcpResponse(frame, this.expect);
			if (result.ok) return {
				done: true,
				outcome: result,
				frame
			};
		}
	}
};
//#endregion
//#region ../../packages/communication/src/session.ts
/**
* 通信会话（docs/TECH_DESIGN.md §6.7、docs/AGENTS.md §10~§13）。
* - 单连接单队列：所有请求经 RequestScheduler 串行执行；
* - 超时从完整请求发送后开始；重试按 retryCount 语义（额外尝试次数）；
* - RTU 响应按期望长度分帧；迟到响应被丢弃并记录；
* - interRequestDelayMs（Rx Delay）作为相邻请求最小间隔，兼作轮询间隔。
*/
function cancelledError(reason) {
	return createMamepError({
		code: "CANCELLED",
		category: "cancellation",
		severity: "info",
		retryable: false,
		userMessageKey: "errors.cancelled",
		technicalMessage: reason
	});
}
function notConnectedError$1() {
	return createMamepError({
		code: "CONNECTION_NOT_CONNECTED",
		category: "connection",
		severity: "warning",
		retryable: false,
		userMessageKey: "errors.notConnected",
		technicalMessage: "session is not connected"
	});
}
function timeoutError(timeoutMs) {
	return createMamepError({
		code: "REQUEST_TIMEOUT",
		category: "timeout",
		severity: "error",
		retryable: true,
		userMessageKey: "errors.requestTimeout",
		technicalMessage: `no response within ${timeoutMs}ms`
	});
}
function modbusExceptionError(exceptionCode) {
	return createMamepError({
		code: `MODBUS_EXCEPTION_${exceptionCode.toString(16).toUpperCase().padStart(2, "0")}`,
		category: "modbus-exception",
		severity: "warning",
		retryable: false,
		userMessageKey: "errors.modbusException",
		technicalMessage: `modbus exception code ${exceptionCode}`
	});
}
/** RTU 帧解析器：按期望长度分帧，从噪声中同步，CRC 失败丢弃首字节继续。 */
var RtuFrameParser = class {
	buffer = [];
	expect;
	constructor(expect) {
		this.expect = expect;
	}
	push(chunk) {
		for (const byte of chunk) this.buffer.push(byte);
		return this.tryParse();
	}
	tryParse() {
		while (true) {
			const slaveIdx = this.buffer.indexOf(this.expect.slaveAddress);
			if (slaveIdx === -1) {
				this.buffer = [];
				return { done: false };
			}
			if (slaveIdx > 0) this.buffer = this.buffer.slice(slaveIdx);
			if (this.buffer.length < 2) return { done: false };
			const expectedFunction = this.expect.kind === "read-holding" ? 3 : 16;
			const functionByte = this.buffer[1] ?? -1;
			let frameLength;
			if (functionByte === expectedFunction) frameLength = this.expect.kind === "read-holding" ? 3 + this.expect.quantity * 2 + 2 : 8;
			else if (functionByte === (expectedFunction | 128)) frameLength = 5;
			else {
				this.buffer.shift();
				continue;
			}
			if (this.buffer.length < frameLength) return { done: false };
			const frame = Uint8Array.from(this.buffer.slice(0, frameLength));
			const result = decodeRtuResponse(frame, this.expect);
			if (result.ok) {
				this.buffer = this.buffer.slice(frameLength);
				return {
					done: true,
					outcome: result,
					frame
				};
			}
			if (result.error.code === "RTU_CRC_MISMATCH") {
				this.buffer.shift();
				continue;
			}
			this.buffer = this.buffer.slice(frameLength);
			return {
				done: true,
				outcome: result,
				frame
			};
		}
	}
};
var CommunicationSession = class {
	stateMachine = new ConnectionStateMachine();
	options;
	scheduler;
	pendingExchange = null;
	/** 会话协议：rtu / tcp。 */
	protocol;
	/** TCP Unit ID（MBAP 单元标识，默认 0）。 */
	unitId;
	/** 当前从站地址（RTU）：连接后可动态更新（每表独立设置，2026-08-19）。 */
	slaveAddress;
	/** TCP Transaction ID 计数器：16 位递增回绕，连接时重置（§8.7）。 */
	nextTransactionId = 0;
	constructor(options) {
		this.options = options;
		this.protocol = options.protocol ?? "rtu";
		this.unitId = options.unitId ?? 0;
		this.slaveAddress = options.slaveAddress ?? 1;
		this.scheduler = new RequestScheduler(options.clock, {
			fairnessThresholdMs: options.fairnessThresholdMs ?? 2e3,
			getInterRequestDelayMs: () => this.options.config.interRequestDelayMs
		});
		this.stateMachine.subscribe((state) => this.options.onStateChange?.(state));
		options.transport.onData((chunk) => {
			if (this.pendingExchange === null) this.emitLog({
				timestamp: this.options.clock.now(),
				direction: "response",
				bytes: chunk,
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
		});
		options.transport.onClose(() => this.handleTransportClosed());
		options.transport.onError((error) => this.handleTransportError(error));
	}
	handleTransportClosed() {
		const state = this.stateMachine.getState();
		if (state === "connected") {
			this.pendingExchange?.cancel("transport-closed");
			this.pendingExchange = null;
			this.enterInterrupted();
		} else if (state === "connecting") this.enterFailed();
	}
	handleTransportError(error) {
		const state = this.stateMachine.getState();
		if (state === "connected") {
			this.pendingExchange?.cancel("transport-error");
			this.pendingExchange = null;
			this.enterInterrupted();
		} else if (state === "connecting") this.enterFailed();
		this.emitLog({
			timestamp: this.options.clock.now(),
			direction: "response",
			bytes: /* @__PURE__ */ new Uint8Array(0),
			protocol: this.protocol,
			slaveAddress: this.logUnitAddress(),
			functionCode: null,
			userAddress: null,
			sentAddress: null,
			quantity: null,
			attempt: 0,
			status: "failure",
			errorCode: error.code,
			exceptionCode: null,
			source: "connection-control",
			durationMs: null
		});
	}
	enterInterrupted() {
		if (!this.stateMachine.transition("interrupted").ok) this.stateMachine.forceState("interrupted");
	}
	enterFailed() {
		if (!this.stateMachine.transition("failed").ok) this.stateMachine.forceState("failed");
	}
	getState() {
		return this.stateMachine.getState();
	}
	/**
	* 动态更新当前从站地址（RTU）：对后续所有请求（读/写/轮询/追踪）生效（2026-08-19）。
	* TCP 的 Unit ID 连接时由 profile 确定，会话内不做动态修改（2026-08-23）。
	*/
	setSlaveAddress(slave) {
		this.slaveAddress = slave;
	}
	getConfig() {
		return this.options.config;
	}
	async connect() {
		if (this.stateMachine.getState() === "connected") return ok(void 0);
		if (!this.stateMachine.transition("connecting").ok) this.stateMachine.forceState("connecting");
		this.nextTransactionId = 0;
		const openResult = await this.options.transport.open();
		if (!openResult.ok) {
			if (!this.stateMachine.transition("failed").ok) this.stateMachine.forceState("failed");
			return openResult;
		}
		if (!this.stateMachine.transition("connected").ok) this.stateMachine.forceState("connected");
		return ok(void 0);
	}
	async disconnect() {
		if (this.stateMachine.getState() === "disconnected") return ok(void 0);
		if (!this.stateMachine.transition("disconnecting").ok) this.stateMachine.forceState("disconnecting");
		this.scheduler.cancelAll();
		if (this.pendingExchange !== null) {
			this.pendingExchange.cancel("disconnected");
			this.pendingExchange = null;
		}
		const closeResult = await this.options.transport.close();
		this.stateMachine.forceState("disconnected");
		return closeResult;
	}
	readRegister(sentAddress, meta) {
		if (this.stateMachine.getState() !== "connected") return Promise.resolve(fail(notConnectedError$1()));
		return this.scheduler.enqueue(() => this.executeRead(sentAddress, meta), {
			priority: meta.priority ?? "manual-read",
			group: meta.group,
			cancelToken: meta.cancelToken
		}).then((result) => result);
	}
	writeRegister(sentAddress, rawValue, meta) {
		if (this.stateMachine.getState() !== "connected") return Promise.resolve(fail(notConnectedError$1()));
		return this.scheduler.enqueue(() => this.executeWrite(sentAddress, rawValue, meta), { priority: "manual-write" });
	}
	async executeRead(sentAddress, meta) {
		const decoded = await this.executeExchange(() => this.buildReadAttempt(sentAddress), {
			source: meta.source,
			userAddress: meta.userAddress ?? null,
			sentAddress,
			functionCode: 3,
			quantity: 1
		});
		if (!decoded.ok) return decoded;
		if (decoded.value.kind === "exception") return fail(modbusExceptionError(decoded.value.exceptionCode));
		if (decoded.value.kind === "read-holding") return ok(decoded.value.values[0] ?? 0);
		return fail(createMamepError({
			code: "UNEXPECTED_RESPONSE_KIND",
			category: "protocol",
			severity: "error",
			retryable: false,
			userMessageKey: "errors.unexpectedResponse",
			technicalMessage: `unexpected response kind for read: ${String(decoded.value)}`
		}));
	}
	async executeWrite(sentAddress, rawValue, meta) {
		const decoded = await this.executeExchange(() => this.buildWriteAttempt(sentAddress, rawValue), {
			source: meta.source,
			userAddress: meta.userAddress ?? null,
			sentAddress,
			functionCode: 16,
			quantity: 1
		});
		if (!decoded.ok) return decoded;
		if (decoded.value.kind === "exception") return fail(modbusExceptionError(decoded.value.exceptionCode));
		if (decoded.value.kind === "write-single") return ok({ kind: "write-succeeded-no-verify" });
		return fail(createMamepError({
			code: "UNEXPECTED_RESPONSE_KIND",
			category: "protocol",
			severity: "error",
			retryable: false,
			userMessageKey: "errors.unexpectedResponse",
			technicalMessage: `unexpected response kind for write: ${String(decoded.value)}`
		}));
	}
	async executeExchange(buildAttempt, meta) {
		const maxAttempts = this.options.config.retryCount + 1;
		let lastResult = null;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			if (this.stateMachine.getState() !== "connected") return fail(notConnectedError$1());
			const { frame, expect } = buildAttempt();
			const startedAt = this.options.clock.now();
			this.emitLog({
				timestamp: startedAt,
				direction: "request",
				bytes: frame,
				protocol: this.protocol,
				slaveAddress: "slaveAddress" in expect ? expect.slaveAddress : this.logUnitAddress(),
				functionCode: meta.functionCode,
				userAddress: meta.userAddress,
				sentAddress: meta.sentAddress,
				quantity: meta.quantity,
				attempt,
				status: "success",
				errorCode: null,
				exceptionCode: null,
				source: meta.source,
				durationMs: null
			});
			const exchange = this.startExchange(expect);
			const writeResult = await this.options.transport.write(frame);
			if (!writeResult.ok) {
				exchange.cancel("write-failed");
				lastResult = fail(writeResult.error);
				this.emitExchangeLog(/* @__PURE__ */ new Uint8Array(0), attempt, startedAt, meta, "failure", writeResult.error.code, null);
				continue;
			}
			exchange.startTimeout();
			const single = await exchange.promise;
			if (single.ok) {
				const decoded = single.value.result;
				if (decoded.kind === "exception") {
					this.emitExchangeLog(single.value.frame, attempt, startedAt, meta, "failure", `MODBUS_EXCEPTION_${decoded.exceptionCode.toString(16).toUpperCase().padStart(2, "0")}`, decoded.exceptionCode);
					return ok(decoded);
				}
				this.emitExchangeLog(single.value.frame, attempt, startedAt, meta, "success", null, null);
				return ok(decoded);
			}
			this.emitExchangeLog(/* @__PURE__ */ new Uint8Array(0), attempt, startedAt, meta, single.error.category === "timeout" ? "timeout" : "failure", single.error.code, null);
			lastResult = fail(single.error);
			if (!this.shouldRetry(single.error)) return single;
		}
		return lastResult ?? fail(notConnectedError$1());
	}
	shouldRetry(error) {
		if (!error.retryable) return false;
		return error.category === "timeout" || error.category === "transport";
	}
	/** 构建单次读尝试（frame + expect）：TCP 每次尝试（含重试）使用新 Transaction ID（§12.2）。 */
	buildReadAttempt(sentAddress) {
		if (this.protocol === "tcp") {
			const transactionId = this.allocateTransactionId();
			return {
				frame: encodeTcpReadHoldingRegistersRequest({
					transactionId,
					unitId: this.unitId,
					startAddress: sentAddress,
					quantity: 1
				}),
				expect: {
					kind: "read-holding",
					transactionId,
					unitId: this.unitId,
					startAddress: sentAddress,
					quantity: 1
				}
			};
		}
		return {
			frame: encodeReadHoldingRegistersRequest({
				slaveAddress: this.slaveAddress,
				startAddress: sentAddress,
				quantity: 1
			}),
			expect: {
				kind: "read-holding",
				slaveAddress: this.slaveAddress,
				startAddress: sentAddress,
				quantity: 1
			}
		};
	}
	/** 构建单次写尝试（frame + expect）：TCP 每次尝试（含重试）使用新 Transaction ID（§12.2）。 */
	buildWriteAttempt(sentAddress, rawValue) {
		if (this.protocol === "tcp") {
			const transactionId = this.allocateTransactionId();
			return {
				frame: encodeTcpWriteSingleRegisterRequest({
					transactionId,
					unitId: this.unitId,
					address: sentAddress,
					rawValue
				}),
				expect: {
					kind: "write-single",
					transactionId,
					unitId: this.unitId,
					address: sentAddress,
					quantity: 1
				}
			};
		}
		return {
			frame: encodeWriteSingleRegisterRequest({
				slaveAddress: this.slaveAddress,
				address: sentAddress,
				rawValue
			}),
			expect: {
				kind: "write-single",
				slaveAddress: this.slaveAddress,
				address: sentAddress,
				quantity: 1
			}
		};
	}
	/** TCP Transaction ID：16 位递增回绕（§8.7）；RTU 无事务 ID（不使用，返回 0）。 */
	allocateTransactionId() {
		const tid = this.nextTransactionId;
		this.nextTransactionId = this.nextTransactionId + 1 & 65535;
		return tid;
	}
	/** 日志字段 slaveAddressOrUnitId：RTU 为当前从站地址，TCP 为 Unit ID。 */
	logUnitAddress() {
		return this.protocol === "tcp" ? this.unitId : this.slaveAddress;
	}
	startExchange(expect) {
		const parser = "slaveAddress" in expect ? new RtuFrameParser(expect) : new TcpFrameParser(expect);
		const cancelToken = createCancellationToken();
		let settled = false;
		let timeoutHandle = null;
		let unsubscribeData = null;
		let resolvePromise = () => {};
		const finish = (result) => {
			if (settled) return;
			settled = true;
			timeoutHandle?.cancel();
			unsubscribeData?.();
			if (this.pendingExchange?.cancelToken === cancelToken) this.pendingExchange = null;
			resolvePromise(result);
		};
		const promise = new Promise((resolve) => {
			resolvePromise = resolve;
		});
		unsubscribeData = this.options.transport.onData((chunk) => {
			const parsed = parser.push(chunk);
			if (!parsed.done) return;
			if (parsed.outcome.ok) finish(ok({
				result: parsed.outcome.value,
				frame: parsed.frame
			}));
			else finish(parsed.outcome);
		});
		const exchange = {
			cancelToken,
			cancel: (reason) => finish(fail(cancelledError(reason))),
			startTimeout: () => {
				timeoutHandle = this.options.clock.schedule(() => finish(fail(timeoutError(this.options.config.requestTimeoutMs))), this.options.config.requestTimeoutMs);
			},
			promise
		};
		this.pendingExchange = exchange;
		return exchange;
	}
	emitExchangeLog(bytes, attempt, startedAt, meta, status, errorCode, exceptionCode) {
		this.emitLog({
			timestamp: this.options.clock.now(),
			direction: "response",
			bytes,
			protocol: this.protocol,
			slaveAddress: this.logUnitAddress(),
			functionCode: meta.functionCode,
			userAddress: meta.userAddress,
			sentAddress: meta.sentAddress,
			quantity: meta.quantity,
			attempt,
			status,
			errorCode,
			exceptionCode,
			source: meta.source,
			durationMs: this.options.clock.now() - startedAt
		});
	}
	emitLog(event) {
		this.options.onLog?.(event);
	}
};
//#endregion
//#region ../../packages/communication/src/trace-coordinator.ts
var TraceCoordinator = class {
	entries = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	session;
	clock;
	constructor(session, clock) {
		this.session = session;
		this.clock = clock;
	}
	onSample(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	start(key, address, speedMs) {
		this.stop(key);
		const entry = {
			key,
			address,
			speedMs,
			timer: null,
			inFlight: false,
			sequence: 0
		};
		this.entries.set(key, entry);
		this.schedule(entry);
	}
	stop(key) {
		const entry = this.entries.get(key);
		if (entry !== void 0) {
			entry.timer?.cancel();
			entry.timer = null;
			this.entries.delete(key);
		}
	}
	stopAll() {
		for (const key of [...this.entries.keys()]) this.stop(key);
	}
	schedule(entry) {
		entry.timer = this.clock.schedule(() => this.tick(entry), entry.speedMs);
	}
	tick(entry) {
		if (!this.entries.has(entry.key)) return;
		if (entry.inFlight) {
			this.schedule(entry);
			return;
		}
		entry.inFlight = true;
		this.session.readRegister(entry.address, {
			source: "trace",
			priority: "polling"
		}).then((result) => {
			entry.inFlight = false;
			if (this.entries.has(entry.key) && result.ok) {
				entry.sequence += 1;
				const sample = {
					key: entry.key,
					sequence: entry.sequence,
					rawValue: result.value,
					timestamp: this.clock.now()
				};
				for (const listener of this.listeners) listener(sample);
			}
		});
		this.schedule(entry);
	}
};
//#endregion
//#region ../../packages/data-conversion/src/data-types.ts
/**
* 16 位数据类型转换（docs/TECH_DESIGN.md §16）。
* 缩放类型使用确定性的十进制字符串整数运算，禁止浮点误差容差、无提示舍入或截断。
* Type 只改变解释、输入与显示，不改变寄存器原始值。
*/
var SCALE_DIGITS = {
	"unsigned-0.1": 1,
	"unsigned-0.01": 2,
	"unsigned-0.001": 3,
	"unsigned-0.0001": 4,
	"signed-0.1": 1,
	"signed-0.01": 2,
	"signed-0.001": 3,
	"signed-0.0001": 4
};
/**
* 错误码 → i18n userMessageKey（packages/ui/src/i18n 驼峰 key，en-US 主 + zh-CN）。
* 必须与 i18n 文案 key 一致（回归：曾机械生成全小写 code，导致错误文案断链）。
*/
var DATA_ERROR_MESSAGE_KEY = {
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
function dataError(code, technicalMessage) {
	return createMamepError({
		code,
		category: "validation",
		userMessageKey: DATA_ERROR_MESSAGE_KEY[code] ?? "errors.internal",
		technicalMessage
	});
}
function isScaled(type) {
	return SCALE_DIGITS[type] !== void 0;
}
function isSigned(type) {
	return type === "signed" || type.startsWith("signed-");
}
/** 把原始值按类型格式化为单元格显示文本。 */
function formatRawValue(raw, type) {
	switch (type) {
		case "hex": return raw.toString(16).toUpperCase().padStart(4, "0");
		case "binary": return raw.toString(2).padStart(16, "0");
		case "unsigned": return String(raw);
		case "signed": {
			const signed = raw >= 32768 ? raw - 65536 : raw;
			return String(signed);
		}
		default:
			if (!isScaled(type)) throw new Error(`unsupported data type: ${String(type)}`);
			return formatScaled(raw, type);
	}
}
function formatScaled(raw, type) {
	const digits = SCALE_DIGITS[type] ?? 0;
	const scale = 10 ** digits;
	const signedValue = isSigned(type) && raw >= 32768 ? raw - 65536 : raw;
	const sign = signedValue < 0 ? "-" : "";
	const abs = Math.abs(signedValue);
	return `${sign}${Math.trunc(abs / scale)}.${String(abs % scale).padStart(digits, "0")}`;
}
/** 把单元格文本按类型解析为原始值（0..65535）。失败返回结构化错误，不清空输入。 */
function parseCellText(text, type) {
	const trimmed = text.trim();
	if (trimmed === "") return fail(dataError("DATA_EMPTY", "cell text is empty"));
	switch (type) {
		case "hex": return parseHex(trimmed);
		case "binary": return parseBinary(trimmed);
		case "unsigned": return parseInteger(trimmed, false);
		case "signed": return parseInteger(trimmed, true);
		default:
			if (!isScaled(type)) return fail(dataError("DATA_UNSUPPORTED_TYPE", `unsupported data type: ${String(type)}`));
			return parseScaled(trimmed, type);
	}
}
function parseHex(text) {
	let hexPart = text;
	if (/^0[xX]/.test(hexPart)) hexPart = hexPart.slice(2);
	if (!/^[0-9a-fA-F]+$/.test(hexPart)) return fail(dataError("DATA_HEX_INVALID", `invalid hex input: ${JSON.stringify(text)}`));
	if (hexPart.length > 4) return fail(dataError("DATA_HEX_TOO_LONG", `hex input exceeds 4 digits: ${JSON.stringify(text)}`));
	return ok(Number.parseInt(hexPart, 16));
}
function parseBinary(text) {
	if (!/^[01]+$/.test(text)) return fail(dataError("DATA_BINARY_INVALID", `binary input must only contain 0 and 1 without prefix or spaces: ${JSON.stringify(text)}`));
	if (text.length > 16) return fail(dataError("DATA_BINARY_TOO_LONG", `binary input exceeds 16 bits: ${JSON.stringify(text)}`));
	return ok(Number.parseInt(text, 2));
}
function parseInteger(text, signed) {
	if (!/^[+-]?\d+$/.test(text)) return fail(dataError("DATA_INVALID_NUMBER", `invalid integer input: ${JSON.stringify(text)}`));
	const value = Number(text);
	if (signed) {
		if (value < -32768 || value > 32767) return fail(dataError("DATA_OUT_OF_RANGE", `signed value out of range: ${text}`));
		return ok(value < 0 ? value + 65536 : value);
	}
	if (value < 0 || value > 65535) return fail(dataError("DATA_OUT_OF_RANGE", `unsigned value out of range: ${text}`));
	return ok(value);
}
function parseScaled(text, type) {
	const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
	if (match === null) return fail(dataError("DATA_INVALID_NUMBER", `invalid decimal input: ${JSON.stringify(text)}`));
	const digits = SCALE_DIGITS[type] ?? 0;
	const scale = 10 ** digits;
	const sign = match[1] === "-" ? -1 : 1;
	const intPart = match[2] ?? "0";
	const fracPart = match[3] ?? "";
	if (sign === -1 && !isSigned(type)) return fail(dataError("DATA_INVALID_NUMBER", `negative value not allowed for ${type}: ${text}`));
	if (fracPart.length > digits) return fail(dataError("DATA_TOO_MANY_DECIMALS", `${text} has ${fracPart.length} decimals, ${type} allows ${digits}`));
	if (intPart.length > 6) return fail(dataError("DATA_OUT_OF_RANGE", `value out of range: ${text}`));
	const scaledValue = sign * (Number(intPart) * scale + Number(fracPart.padEnd(digits, "0")));
	if (isSigned(type)) {
		if (scaledValue < -32768 || scaledValue > 32767) return fail(dataError("DATA_OUT_OF_RANGE", `signed scaled value out of range: ${text}`));
		return ok(scaledValue < 0 ? scaledValue + 65536 : scaledValue);
	}
	if (scaledValue < 0 || scaledValue > 65535) return fail(dataError("DATA_OUT_OF_RANGE", `unsigned scaled value out of range: ${text}`));
	return ok(scaledValue);
}
//#endregion
//#region ../../packages/register-table/src/address.ts
/**
* 地址提交与 Address Adjust（docs/AGENTS.md §17.2、ADR-013、ADR-014）。
* - 编辑态 addressDraft 与提交值 addressValue 分离；
* - 校验失败保留用户输入并返回结构化错误；
* - 成功提交后按进制归一化：HEX 4 位大写补零；DEC 去首尾空格（不补零）；
* - Address Adjust ON 时发送地址 = 用户地址 − 1，日志记录双地址。
*/
/** 计算实际发送地址（Address Adjust）。用户地址 0 且 ON 时下溢报错。 */
function computeSentAddress(userAddress, addressAdjust) {
	if (addressAdjust === "on") {
		if (userAddress === 0) return fail(createMamepError({
			code: "ADDRESS_ADJUST_UNDERFLOW",
			category: "validation",
			userMessageKey: "errors.addressAdjustUnderflow",
			technicalMessage: "address 0 cannot be adjusted by -1"
		}));
		return ok(userAddress - 1);
	}
	return ok(userAddress);
}
//#endregion
//#region ../../packages/register-table/src/row-operations.ts
/**
* 寄存器行操作（不可变更新，docs/TECH_DESIGN.md §6.8）。
* 行号只表示表格顺序，不等于寄存器地址；增删移动后自动重排。
*/
/** 应用读取成功结果：按 Type 格式化并强制覆盖单元格（单一当前值模型，§15.1）。 */
function applyReadValueToRow(row, raw) {
	const rawValue = RawRegisterValue.create(raw);
	if (!rawValue.ok) return rawValue;
	return ok({
		...row,
		cellText: formatRawValue(raw, row.dataType),
		lastKnownRawValue: rawValue.value,
		updatedAt: Date.now()
	});
}
//#endregion
//#region ../../packages/register-table/src/table-service.ts
/**
* 寄存器表应用服务（docs/TECH_DESIGN.md §6.8、docs/AGENTS.md §17/§18）。
* - 读写编排走统一调度器（session 内部）；
* - 读取成功后按 Type 强制覆盖单元格文本；读取失败不改变单元格内容；
* - 写入前按 Type 校验并转换为 16 位原始值；失败保留用户输入；
* - Address Adjust 在发送前应用，日志记录用户地址与发送地址。
*/
function notConnectedError() {
	return createMamepError({
		code: "CONNECTION_NOT_CONNECTED",
		category: "connection",
		userMessageKey: "errors.notConnected",
		technicalMessage: "no active connection"
	});
}
function addressEmptyError() {
	return createMamepError({
		code: "REGISTER_ADDRESS_EMPTY",
		category: "validation",
		userMessageKey: "errors.registerAddressEmpty",
		technicalMessage: "register address is empty"
	});
}
var RegisterTableService = class {
	deps;
	constructor(deps) {
		this.deps = deps;
	}
	/** 单行读取：校验连接/地址/Address Adjust 后经统一调度器发送 FC03。 */
	async readRow(row) {
		const session = this.deps.getSession();
		if (session === null) return fail(notConnectedError());
		const address = row.addressValue?.value;
		if (address === void 0) return fail(addressEmptyError());
		const sent = computeSentAddress(address, this.deps.getAddressAdjustMode());
		if (!sent.ok) return sent;
		return session.readRegister(sent.value, {
			source: "manual-read",
			userAddress: address
		});
	}
	/** 读取成功后应用结果：按 Type 格式化并强制覆盖单元格文本（单一当前值模型）。 */
	applyReadResult(row, raw) {
		return applyReadValueToRow(row, raw);
	}
	/** 单行写入：校验连接/地址/输入值，转 16 位原始值后发送 FC0x10。 */
	async writeRow(row) {
		const session = this.deps.getSession();
		if (session === null) return fail(notConnectedError());
		const address = row.addressValue?.value;
		if (address === void 0) return fail(addressEmptyError());
		const sent = computeSentAddress(address, this.deps.getAddressAdjustMode());
		if (!sent.ok) return sent;
		const parsed = parseCellText(row.cellText, row.dataType);
		if (!parsed.ok) return parsed;
		return session.writeRegister(sent.value, parsed.value, {
			source: "manual-write",
			userAddress: address
		});
	}
	/** 新建空行（供 UI 便捷调用）。 */
	static createRow() {
		return createEmptyRow();
	}
};
//#endregion
//#region ../../packages/application/src/session-host-core.ts
var SessionHostCore = class {
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
	constructor(options) {
		this.clock = options.clock;
		this.events = options.events;
		this.getPollingIntervalMs = options.getPollingIntervalMs;
		this.tableService = new RegisterTableService({
			getSession: () => this.session,
			getAddressAdjustMode: options.getAddressAdjustMode
		});
	}
	/** 打开并连接会话：替换旧会话，恢复轮询/追踪配置（与 BrowserAppHost 行为一致）。 */
	async connect(session, portLabel) {
		this.stopPolling();
		this.trace?.stopAll();
		await this.session?.disconnect();
		this.portLabel = portLabel;
		const result = await session.connect();
		if (!result.ok) {
			await session.disconnect();
			return result;
		}
		this.session = session;
		this.polling = new PollingCoordinator(session, this.clock, { getIntervalMs: () => this.getPollingIntervalMs() });
		this.polling.onResult((key, address, result) => this.events.onPollResult(key, address, result));
		this.trace = new TraceCoordinator(session, this.clock);
		this.trace.onSample((sample) => this.events.onTraceSample(sample));
		if (this.pollingTargets.length > 0) {
			this.polling.setTargets(this.pollingTargets);
			this.polling.start();
		}
		for (const [key, entry] of this.activeTraces) this.trace.start(key, entry.address, entry.speedMs);
		return ok(void 0);
	}
	async disconnect() {
		this.stopPolling();
		this.trace?.stopAll();
		const result = await this.session?.disconnect();
		this.session = null;
		return result ?? {
			ok: true,
			value: void 0
		};
	}
	/** 释放全部资源（Webview 关闭 / 扩展停用 / 卸载）：断开会话并清空状态。 */
	async dispose() {
		await this.disconnect();
		this.polling = null;
		this.trace = null;
		this.portLabel = null;
	}
	getConnectionState() {
		return this.session?.getState() ?? "disconnected";
	}
	getPortLabel() {
		return this.portLabel;
	}
	/** 更新会话从站地址（RTU，每表独立）：对后续所有请求（读/写/轮询/追踪）生效。 */
	setSlaveAddress(slave) {
		this.session?.setSlaveAddress(slave);
	}
	readRow(row) {
		return this.tableService.readRow(row);
	}
	writeRow(row) {
		return this.tableService.writeRow(row);
	}
	readAllRows(rows) {
		if (this.session === null) return {
			promise: Promise.resolve(fail(createMamepError({
				code: "CONNECTION_NOT_CONNECTED",
				category: "connection",
				userMessageKey: "errors.notConnected",
				technicalMessage: "no active connection"
			}))),
			cancel: () => void 0
		};
		return new BatchReadCoordinator(this.session, this.clock).readAll(rows, (key, result) => {
			this.events.onPollResult(key, 0, result);
		});
	}
	updatePollingTargets(rows) {
		this.pollingTargets = rows;
		this.polling?.setTargets(rows);
		if (rows.length > 0 && this.session !== null) this.polling?.start();
		else this.polling?.stop();
	}
	startPolling() {
		if (this.pollingTargets.length > 0 && this.session !== null) this.polling?.start();
	}
	stopPolling() {
		this.polling?.stop();
	}
	traceStart(key, address, speedMs) {
		this.activeTraces.set(key, {
			address,
			speedMs
		});
		this.trace?.start(key, address, speedMs);
	}
	traceStop(key) {
		this.activeTraces.delete(key);
		this.trace?.stop(key);
	}
	/** 会话通信日志转发（协议专用宿主的 CommunicationSession onLog 回调）。 */
	emitLog(event) {
		this.events.onLog(event);
	}
	/** 会话状态变化转发（协议专用宿主的 CommunicationSession onStateChange 回调）。 */
	emitStateChange(state) {
		if (state === "interrupted") {
			this.stopPolling();
			this.trace?.stopAll();
			this.events.onMessage({
				timestamp: this.clock.now(),
				level: "error",
				messageKey: "messages.deviceDisconnected",
				detail: null
			});
		}
		this.events.onStateChange(state);
	}
};
//#endregion
//#region ../../packages/application/src/tcp-session-host.ts
var TcpSessionHost = class {
	core;
	currentProfile = null;
	constructor(options) {
		this.core = new SessionHostCore({
			clock: options.clock,
			events: options.events,
			getPollingIntervalMs: () => this.currentProfile?.interRequestDelayMs ?? 50,
			getAddressAdjustMode: () => "off"
		});
	}
	/** 打开并连接 TCP 会话：替换旧会话，恢复轮询/追踪配置。 */
	async connect(input) {
		this.currentProfile = input.profile;
		const session = new CommunicationSession({
			transport: input.transport,
			clock: this.core.clock,
			config: input.profile,
			protocol: "tcp",
			unitId: input.profile.unitId,
			onLog: (event) => this.core.emitLog(event),
			onStateChange: (state) => this.core.emitStateChange(state)
		});
		return this.core.connect(session, input.portLabel);
	}
	async disconnect() {
		return this.core.disconnect();
	}
	/** 释放全部资源（Webview 关闭 / 扩展停用 / 卸载）：断开会话并清空状态。 */
	async dispose() {
		await this.core.dispose();
		this.currentProfile = null;
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
	readRow(row) {
		return this.core.readRow(row);
	}
	writeRow(row) {
		return this.core.writeRow(row);
	}
	readAllRows(rows) {
		return this.core.readAllRows(rows);
	}
	updatePollingTargets(rows) {
		this.core.updatePollingTargets(rows);
	}
	startPolling() {
		this.core.startPolling();
	}
	stopPolling() {
		this.core.stopPolling();
	}
	traceStart(key, address, speedMs) {
		this.core.traceStart(key, address, speedMs);
	}
	traceStop(key) {
		this.core.traceStop(key);
	}
};
//#endregion
//#region ../electron/src/main/session-host.ts
/**
* Electron 主进程侧 TCP 会话宿主（docs/TECH_DESIGN.md §5.1.2、§6.2、§28.3）。
* 组合 NodeTcpPlatformHost（仅 TCP 打开，packages/platform-node/tcp）+ TcpSessionHost
* （会话/调度/轮询/追踪编排，packages/application）。Electron 的 Modbus TCP 会话
* 承载在主进程（§6.2 main 职责、§28.3 通信在主进程执行），Renderer 经 HostMessage v1
* RPC 远程代理；RTU 仍在 Renderer（Web Serial，ADR-017），不经过本类。
*
* 注意：平台宿主用「仅 TCP」的 NodeTcpPlatformHost（`@mamep2026/platform-node/tcp`）
* 而非 NodePlatformHost——后者会静态引入 serialport 原生绑定，被打进主进程 ESM bundle
* 会在初始化时抛 `__dirname is not defined`（2026-08-23 修复）。
* 会话事件经 events 回调外抛，由 main.ts 转换为 HostMessage v1 event 推送 Renderer。
*/
var ElectronSessionHost = class {
	platform;
	tcp;
	constructor(options) {
		this.platform = options.platform;
		this.tcp = new TcpSessionHost({
			clock: options.platform.clock,
			events: options.events
		});
	}
	/** 打开并连接 TCP 会话（session-tcp-connect；profile 即连接参数，无串口句柄）。 */
	async connectTcp(profile) {
		const openResult = await this.platform.openTcpTransport(profile);
		if (!openResult.ok) return openResult;
		return this.tcp.connect({
			profile,
			transport: openResult.value,
			portLabel: `${profile.host}:${profile.port}`
		});
	}
	disconnect() {
		return this.tcp.disconnect();
	}
	getConnectionState() {
		return this.tcp.getConnectionState();
	}
	readRow(row) {
		return this.tcp.readRow(row);
	}
	writeRow(row) {
		return this.tcp.writeRow(row);
	}
	readAllRows(rows) {
		return this.tcp.readAllRows(rows);
	}
	updatePollingTargets(rows) {
		this.tcp.updatePollingTargets(rows);
	}
	startPolling() {
		this.tcp.startPolling();
	}
	stopPolling() {
		this.tcp.stopPolling();
	}
	traceStart(key, address, speedMs) {
		this.tcp.traceStart(key, address, speedMs);
	}
	traceStop(key) {
		this.tcp.traceStop(key);
	}
	/** 释放全部资源（窗口关闭 / 应用退出）：断开会话并清空状态。 */
	async dispose() {
		await this.tcp.dispose();
	}
};
//#endregion
//#region ../electron/src/main/serial-permissions.ts
/** 派生允许的 origin：开发加载 dev server URL 页面；生产 loadFile（file:// 协议）。 */
function deriveAllowedOrigins(isPackaged, devServerUrl) {
	if (!isPackaged && devServerUrl !== void 0 && devServerUrl.length > 0) return [new URL(devServerUrl).origin];
	return ["file://", "file:///"];
}
/**
* 归一化 origin：仅对 http(s) 用 new URL().origin 规范化（去尾斜杠/默认端口等）。
* 背景（2026-08-22 实测）：dev 下 permissionCheck 上报 details.securityOrigin 为
* `http://localhost:5173/`（带尾斜杠），而 deriveAllowedOrigins 生成的是
* `new URL().origin`（无尾斜杠），直接精确匹配会把 serial 权限误拒（刷不出串口）。
* file://（file:///）保持原样：allowlist 已含两个变体，且 URL API 会把 file origin
* 归为 "null"，不能走 URL 归一化。
*/
function normalizeOrigin(origin) {
	if (origin === void 0) return void 0;
	if (origin.startsWith("http://") || origin.startsWith("https://")) try {
		return new URL(origin).origin;
	} catch {
		return origin;
	}
	return origin;
}
/** 端口列表 → 可序列化选项（label 优先 portName，其次 displayName，最后 portId）。 */
function toPortOptions(portList) {
	return portList.map((port) => ({
		portId: port.portId,
		label: port.portName ?? port.displayName ?? port.portId
	}));
}
/**
* 安装 Web Serial 最小授权：
* - select-serial-port：event.preventDefault() 后默认「延迟选择」——把端口列表经
*   onPortsAvailable 转发给渲染进程，挂起 callback 等待渲染进程经安全 IPC 回传选择
*   （resolvePendingSelection；空串 = 取消）；设置 selectPort 则自动选择。
* - setPermissionCheckHandler / setDevicePermissionHandler：仅对本应用 origin 放行 serial；
* - 不注册 serial-port-added/removed（官方文档：仅选择回调挂起期间触发，本项目无实时 picker UI）。
*
* 注：disable-serial-blocklist 默认不启用（Modbus 常用 USB 适配器 FTDI/CH340/CP210x 不在
* Chromium 黑名单）；如需可在 app.whenReady 前 app.commandLine.appendSwitch("disable-serial-blocklist")。
*/
function installSerialPermissionHandlers(session, options) {
	const allowed = options.allowedOrigins;
	const isAllowedOrigin = (origin) => {
		const normalized = normalizeOrigin(origin);
		return normalized !== void 0 && allowed.includes(normalized);
	};
	const selectPort = options.selectPort;
	let pending = null;
	session.setPermissionCheckHandler((_webContents, permission, _requestingOrigin, details) => {
		if (permission !== "serial") return false;
		return isAllowedOrigin(details.securityOrigin);
	});
	session.setDevicePermissionHandler((details) => {
		if (details.deviceType !== "serial") return false;
		return isAllowedOrigin(details.origin);
	});
	session.on("select-serial-port", (event, portList, webContents, callback) => {
		event.preventDefault();
		if (selectPort !== void 0) {
			callback(selectPort(portList));
			return;
		}
		pending = {
			callback,
			sender: webContents
		};
		options.onPortsAvailable?.(toPortOptions(portList));
	});
	return { resolvePendingSelection(portId, sender) {
		if (pending === null || pending.sender !== sender) return false;
		const callback = pending.callback;
		pending = null;
		callback(portId);
		return true;
	} };
}
//#endregion
//#region ../electron/src/main/main.ts
/**
* Electron 主进程（docs/TECH_DESIGN.md §6.2、§22.1、§41）。
* Main / Preload / Renderer 三层中的 Main：窗口创建与生命周期、安全 IPC 处理
* （版本化 Envelope + Zod 校验 + kind 白名单，docs/AGENTS.md §23）、
* Web Serial 最小授权（ADR-017，Renderer 经 navigator.serial 走浏览器路径）、
* 后续 TCP/文件能力的装配边界。
*
* Renderer 为 apps/web 同一套共享 UI（dev: VITE_DEV_SERVER_URL；生产: apps/web/dist/index.html）。
* MVP 串口（ADR-017）：与浏览器一致经 Web Serial API，主进程仅配合 select-serial-port 权限处理；
* 后续 Node Serial/TCP Adapter 落地后由本进程接管。
*/
var __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 生产模式渲染器加载的共享 UI（apps/web 的 Electron 模式构建产物）。 */
var RENDERER_INDEX = path.join(__dirname, "../apps/web/dist-electron/index.html");
var mainWindow = null;
var eventSeq = 0;
/**
* Web Serial 权限处理句柄（installSerialPermissionHandlers 返回值）：
* 持有挂起的 select-serial-port callback，供 select-serial-port invoke 回传选择结果。
* app.whenReady 后装配（在此之前无挂起请求，invoke 返回 SERIAL_PICKER_NOT_ACTIVE）。
*/
var serialPermissionHandlers = null;
/**
* 主进程侧连接状态：RTU 下连接会话由 Renderer（共享 UI）驱动，主进程不跟踪实时状态，
* 此处恒为离线（仅供 dev 探针 debug:get-state 的初始值）；TCP 会话由主进程承载，
* 其状态经 connection-state 事件推送 Renderer（真实状态以会话为准）。
*/
var currentConnectionState = "disconnected";
/** 主进程侧 TCP 会话宿主（Electron TCP 走主进程，惰性装配）。 */
var electronSessionHost = null;
/** 主进程会话事件 → 推送渲染进程（HostMessage v1 event Envelope；无窗口时静默丢弃）。 */
function postSessionEvent(event) {
	if (mainWindow !== null && !mainWindow.isDestroyed()) mainWindow.webContents.send(MAMEP_IPC_EVENT_CHANNEL, event);
}
/** 装配主进程 TCP 会话（2026-08-23 两端 TCP 接线）：NodeTcpPlatformHost（仅 TCP，零 serialport）+ TcpSessionHost。 */
function ensureSessionHost() {
	if (electronSessionHost === null) electronSessionHost = new ElectronSessionHost({
		platform: new NodeTcpPlatformHost(),
		events: {
			onLog: (event) => postSessionEvent({
				protocolVersion: 1,
				type: "event",
				messageId: nextEventId(),
				kind: "comm-log",
				payload: { event: toCommLogEventPayload(event) }
			}),
			onStateChange: (state) => postSessionEvent({
				protocolVersion: 1,
				type: "event",
				messageId: nextEventId(),
				kind: "connection-state",
				payload: { state }
			}),
			onPollResult: (key, address, result) => postSessionEvent({
				protocolVersion: 1,
				type: "event",
				messageId: nextEventId(),
				kind: "poll-result",
				payload: {
					key,
					address,
					result: toResultPayload(result)
				}
			}),
			onTraceSample: (sample) => postSessionEvent({
				protocolVersion: 1,
				type: "event",
				messageId: nextEventId(),
				kind: "trace-sample",
				payload: { sample }
			}),
			onMessage: (message) => postSessionEvent({
				protocolVersion: 1,
				type: "event",
				messageId: nextEventId(),
				kind: "app-message",
				payload: { message: toAppMessagePayload(message) }
			})
		}
	});
	return electronSessionHost;
}
function nextEventId() {
	eventSeq += 1;
	return `evt-${Date.now()}-${eventSeq}`;
}
/** 主进程侧真实依赖：注入可测的 ipc.ts（handleInvoke）。 */
var ipcDeps = {
	appVersion: () => app.getVersion(),
	isPackaged: () => app.isPackaged,
	windowCount: () => BrowserWindow.getAllWindows().length,
	connectionState: () => currentConnectionState,
	uptimeMs: () => Math.round(process.uptime() * 1e3),
	clipboardWriteText: (text) => clipboard.writeText(text),
	clipboardReadText: () => clipboard.readText(),
	resolveSerialPortSelection: (portId, sender) => serialPermissionHandlers?.resolvePendingSelection(portId, sender) ?? false,
	session: ensureSessionHost()
};
async function handleInvokeEvent(event, raw) {
	return handleInvoke(raw, {
		isSenderMainWindow: event.sender === mainWindow?.webContents,
		sender: event.sender,
		deps: ipcDeps
	});
}
function createWindow() {
	const win = new BrowserWindow({
		width: 1280,
		height: 800,
		title: "mamep2026",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	});
	mainWindow = win;
	win.setMenu(null);
	win.on("closed", () => {
		mainWindow = null;
	});
	win.webContents.on("did-finish-load", () => {
		const event = {
			protocolVersion: 1,
			type: "event",
			messageId: nextEventId(),
			kind: "connection-state",
			payload: { state: "disconnected" }
		};
		win.webContents.send(MAMEP_IPC_EVENT_CHANNEL, event);
	});
	if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
	else win.loadFile(RENDERER_INDEX);
}
app.whenReady().then(() => {
	serialPermissionHandlers = installSerialPermissionHandlers(session.defaultSession, {
		allowedOrigins: deriveAllowedOrigins(app.isPackaged, process.env.VITE_DEV_SERVER_URL),
		onPortsAvailable: (ports) => {
			const event = {
				protocolVersion: 1,
				type: "event",
				messageId: nextEventId(),
				kind: "serial-ports-available",
				payload: { ports }
			};
			mainWindow?.webContents.send(MAMEP_IPC_EVENT_CHANNEL, event);
		}
	});
	ipcMain.handle(MAMEP_IPC_INVOKE_CHANNEL, handleInvokeEvent);
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
app.on("window-all-closed", () => {
	electronSessionHost?.dispose();
	if (process.platform !== "darwin") app.quit();
});
//#endregion
export {};
