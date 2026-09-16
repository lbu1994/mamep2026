// 测试报告/日志收集工具（轻量版）。
// 目标：把各测试步骤的终端输出 tee 到独立日志文件，并落盘一份结构化 summary，
// 便于追踪与 CI 消费。不做逐用例/逐包解析，仅记录步骤级结果。
import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 报告根目录（仓库根下的 test-reports）。 */
export const REPORTS_ROOT = path.resolve(__dirname, "../../test-reports");

// 匹配 ANSI / 终端控制序列（颜色、光标移动等），写日志文件时去除，便于阅读。
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

/** 去除字符串中的 ANSI 转义序列。 */
export function stripAnsi(s) {
  return String(s).replace(ANSI_RE, "");
}

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

/** 生成 `YYYYMMDD-HHmmss-SSS` 格式的时间戳，用于 run 目录命名。 */
export function timestamp(d = new Date()) {
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  );
}

/** 在报告根目录下创建一个新的 run 目录并返回其绝对路径。 */
export function createRunDir(root = REPORTS_ROOT) {
  const dir = path.join(root, `run-${timestamp()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 读取 run 目录下的 summary.json（步骤结果数组）；不存在或损坏时返回空数组。 */
export function readSummary(logDir) {
  const p = path.join(logDir, "summary.json");
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 追加一条步骤结果到 summary.json（以数组形式持久化）。 */
export function appendSummary(logDir, entry) {
  const arr = readSummary(logDir);
  arr.push(entry);
  writeFileSync(
    path.join(logDir, "summary.json"),
    `${JSON.stringify(arr, null, 2)}\n`,
  );
}

/** 运行一条命令，把 stdout/stderr 同时输出到终端与 `logDir/<name>.log`。
 *  返回 Promise<exitCode>。写日志文件时去除 ANSI 转义，并在结尾写入 summary。 */
export function runLogged({ command, name, logDir, env = {} }) {
  return new Promise((resolve) => {
    mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${name}.log`);
    const out = createWriteStream(logPath, { flags: "a" });
    const started = Date.now();

    const writeToTerminal = (d, stream) => {
      const s = typeof d === "string" ? d : d.toString();
      stream.write(s);
      out.write(stripAnsi(s));
    };

    const child = spawn(command, {
      shell: true,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (d) => writeToTerminal(d, process.stdout));
    child.stderr.on("data", (d) => writeToTerminal(d, process.stderr));
    child.on("error", (err) => {
      const msg = `[run-logged] 启动失败: ${err.message}\n`;
      process.stderr.write(msg);
      out.write(stripAnsi(msg));
    });

    child.on("close", (code) => {
      out.end();
      const durationMs = Date.now() - started;
      const exitCode = code ?? -1;
      appendSummary(logDir, { name, command, exitCode, durationMs });
      resolve(exitCode);
    });
  });
}
