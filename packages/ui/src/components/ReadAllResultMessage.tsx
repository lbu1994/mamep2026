/**
 * Read All（全表读取）完成结果的富内容全局提示（antd message）。
 * 展示批次摘要：标题 + 成功/失败/跳过/取消统计（语义色分层）+ 耗时。
 *
 * 纯展示组件：数据来自 BatchReadSummary；文案走 i18n（table.* 命名空间）。
 * 由 RegisterTable.handleReadAll 经 App.useApp().message.open({ content }) 弹出，
 * 与底部面板既有的 batchSummary 消息并存（后者保留不动）。
 */
import { useTranslation } from "react-i18next";
import { Flex, Tag, Typography, theme } from "antd";
import { CheckCircleFilled, ExclamationCircleFilled } from "@ant-design/icons";
import type { BatchReadSummary } from "@mamep2026/communication";

export interface ReadAllResultMessageProps {
  summary: BatchReadSummary;
}

export function ReadAllResultMessage({
  summary,
}: ReadAllResultMessageProps): React.ReactNode {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  // 有失败或取消时标题用警示图标（§25.5 状态不只依赖颜色：语义色 + 图标双重表达）。
  const hasIssue = summary.failureCount > 0 || summary.cancelledCount > 0;
  return (
    <Flex vertical gap={4} className="read-all-result">
      <Flex align="center" gap={8}>
        {hasIssue ? (
          <ExclamationCircleFilled
            style={{ color: token.colorWarning, fontSize: token.fontSizeLG }}
          />
        ) : (
          <CheckCircleFilled
            style={{ color: token.colorSuccess, fontSize: token.fontSizeLG }}
          />
        )}
        <Typography.Text strong>{t("table.readAllComplete")}</Typography.Text>
      </Flex>
      <Flex align="center" gap={4} wrap>
        <Tag color="success">
          {t("table.readAllSucceeded", { count: summary.successCount })}
        </Tag>
        <Tag color={summary.failureCount > 0 ? "error" : "default"}>
          {t("table.readAllFailed", { count: summary.failureCount })}
        </Tag>
        <Tag>{t("table.readAllSkipped", { count: summary.skippedCount })}</Tag>
        <Tag>
          {t("table.readAllCancelled", { count: summary.cancelledCount })}
        </Tag>
        <Typography.Text type="secondary" className="read-all-result__duration">
          {t("table.readAllDuration", { ms: summary.durationMs })}
        </Typography.Text>
      </Flex>
    </Flex>
  );
}
