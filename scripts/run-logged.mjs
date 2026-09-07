// 通用「带日志执行」CLI。
// 用法：node scripts/run-logged.mjs <name> [--] <command...>
//
//   node scripts/run-logged.mjs acceptance -- pnpm --filter @mamep2026/acceptance test
//   node scripts/run-logged.mjs e2e-vscode -- "pnpm build:vscode && pnpm --filter @mamep2026/e2e-vscode test"
//
// 行为：
//   - 若环境变量 MAMEP_TEST_REPORT_DIR 已设置（例如由 scripts/test-all.mjs 设置），
//     日志写入该共享目录；否则在本目录下新建 test-reports/run-<时间戳>/。
//   - 命令的 stdout/stderr 同时打印到终端并写入 <目录>/<name>.log。
//   - 退出码与被执行命令一致。
import path from 'node:path';
import { createRunDir, runLogged } from './lib/test-report.mjs';

function main() {
  const argv = process.argv.slice(2);
  const name = argv[0];
  if (!name) {
    console.error('用法: node scripts/run-logged.mjs <name> [--] <command...>');
    process.exit(2);
  }

  const sep = argv.indexOf('--');
  const cmdArgs = sep === -1 ? argv.slice(1) : argv.slice(sep + 1);
  if (cmdArgs.length === 0) {
    console.error(`[run-logged] ${name}: 未提供命令`);
    process.exit(2);
  }
  const command = cmdArgs.join(' ');

  const logDir = process.env.MAMEP_TEST_REPORT_DIR || createRunDir();

  runLogged({ command, name, logDir }).then((code) => {
    if (!process.env.MAMEP_TEST_REPORT_DIR) {
      console.log(`[run-logged] 日志: ${path.join(logDir, `${name}.log`)}`);
    }
    process.exit(code);
  });
}

main();
