const REQUIRED_PRIVACY = {
  anonymous: true,
  uploaded: false,
  containsWorkspaceContent: false,
  containsDeviceMessages: false,
};

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function validateReport(report) {
  if (typeof report !== "object" || report === null) {
    throw new Error("performance report must be a JSON object");
  }
  if (report.schemaVersion !== 1) {
    throw new Error(
      `unsupported report schemaVersion: ${report.schemaVersion}`,
    );
  }
  if (report.kind !== "mamep-local-web-performance") {
    throw new Error(`unexpected report kind: ${report.kind}`);
  }
  for (const [field, expected] of Object.entries(REQUIRED_PRIVACY)) {
    if (report.privacy?.[field] !== expected) {
      throw new Error(`privacy.${field} must be ${String(expected)}`);
    }
  }
  if (!Array.isArray(report.sessions)) {
    throw new Error("performance report sessions must be an array");
  }
}

export function summarizeFieldPerformanceReport(report) {
  validateReport(report);
  const startupBudgetMs = report.targets?.startupInteractiveMs ?? 3000;
  const inpBudgetMs = report.targets?.inpMs ?? 200;
  const rows = report.sessions.map((session, index) => {
    const startupMs = numberOrNull(session?.metrics?.startupInteractiveMs);
    const inpMs = numberOrNull(session?.metrics?.inpMs);
    const startupPassed =
      startupMs !== null && startupMs <= startupBudgetMs ? true : false;
    const inpPassed = inpMs !== null && inpMs <= inpBudgetMs ? true : false;
    const status =
      startupMs === null || inpMs === null
        ? "unverified"
        : startupPassed && inpPassed
          ? "passed"
          : "failed";
    return {
      index: index + 1,
      collectedAt: session?.collectedAt ?? "unknown",
      cacheMode: session?.cacheMode ?? "unknown",
      networkProfile: session?.networkProfile ?? "unknown",
      theme: session?.context?.theme ?? "unknown",
      zoomPercent: session?.declaredZoomPercent ?? "unknown",
      activeSheetRows: numberOrNull(session?.context?.activeSheetRows),
      totalWorkspaceRows: numberOrNull(session?.context?.totalWorkspaceRows),
      browser: session?.environment?.userAgent ?? "unknown",
      hardwareConcurrency: numberOrNull(
        session?.environment?.hardwareConcurrency,
      ),
      deviceMemoryGb: numberOrNull(session?.environment?.deviceMemoryGb),
      viewport:
        session?.environment?.viewportWidth === undefined
          ? "unknown"
          : `${session.environment.viewportWidth}x${session.environment.viewportHeight}`,
      devicePixelRatio: numberOrNull(session?.environment?.devicePixelRatio),
      startupMs,
      inpMs,
      interactionCount: numberOrNull(session?.metrics?.interactionCount),
      startupPassed,
      inpPassed,
      status,
    };
  });
  const failures = rows.filter((row) => row.status !== "passed");
  const status = rows.length > 0 && failures.length === 0 ? "passed" : "failed";
  return {
    status,
    startupBudgetMs,
    inpBudgetMs,
    generatedAt: report.generatedAt ?? null,
    sessionCount: rows.length,
    rows,
    failures,
  };
}

export function fieldPerformanceMarkdown(summary) {
  const lines = [
    "# Web 真实设备性能验收摘要",
    "",
    `总体状态：**${summary.status === "passed" ? "通过" : "未通过/待补测"}**`,
    "",
    `预算：启动可交互 ≤${summary.startupBudgetMs} ms；INP ≤${summary.inpBudgetMs} ms。`,
    "",
    "| # | 时间 | 缓存 | 网络 | 主题 | 缩放 | 活动/总行数 | 视口 / DPR | CPU / 内存 | 启动 ms | INP ms | 结果 |",
    "| -: | --- | --- | --- | --- | -: | -: | --- | --- | -: | -: | --- |",
  ];
  for (const row of summary.rows) {
    const hardware = [
      row.hardwareConcurrency === null
        ? "?"
        : `${row.hardwareConcurrency} threads`,
      row.deviceMemoryGb === null ? "? GB" : `${row.deviceMemoryGb} GB`,
    ].join(" / ");
    lines.push(
      `| ${row.index} | ${markdownCell(row.collectedAt)} | ${markdownCell(row.cacheMode)} | ${markdownCell(row.networkProfile)} | ${markdownCell(row.theme)} | ${markdownCell(row.zoomPercent)}% | ${markdownCell(row.activeSheetRows)}/${markdownCell(row.totalWorkspaceRows)} | ${markdownCell(row.viewport)} / ${markdownCell(row.devicePixelRatio)} | ${markdownCell(hardware)} | ${markdownCell(row.startupMs ?? "missing")} | ${markdownCell(row.inpMs ?? "missing")} | ${row.status} |`,
    );
  }
  lines.push("", "## 浏览器", "");
  for (const row of summary.rows) {
    lines.push(`- #${row.index}: ${row.browser}`);
  }
  lines.push("", "## 仍超预算或无法确认的场景", "");
  if (summary.failures.length === 0) {
    lines.push("- 无。");
  } else {
    for (const row of summary.failures) {
      const reason =
        row.status === "unverified"
          ? "缺少启动可交互或 INP 采样"
          : [
              row.startupPassed ? null : `启动 ${row.startupMs} ms`,
              row.inpPassed ? null : `INP ${row.inpMs} ms`,
            ]
              .filter(Boolean)
              .join("，");
      lines.push(
        `- #${row.index} ${row.cacheMode}/${row.networkProfile}/${row.theme}/${row.zoomPercent}%：${reason}`,
      );
    }
  }
  lines.push(
    "",
    "> 本摘要只读取用户导出的本地采样 JSON；不连接网络，也不包含工作区行内容或设备报文。",
    "",
  );
  return `${lines.join("\n")}`;
}
