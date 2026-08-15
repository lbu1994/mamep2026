/**
 * 通信日志滚动区「是否接近底部」的判定（PRD §6.8.3 自动滚动）。
 * 抽出为纯函数便于单测；threshold 为距离底部多少像素内视为贴底。
 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 16,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
