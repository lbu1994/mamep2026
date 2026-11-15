/**
 * Sheet 名重命名输入框（页签头 / 侧边栏共用）。
 * 收拢两处重复的输入框渲染与提交/取消逻辑：
 * - 进入编辑（页签头双击 / 侧边栏右键菜单 Rename）后，由父组件按编辑态渲染本组件；
 * - Enter / 失焦 → onCommit(当前值)；Escape → onCancel()；
 * - onClick / onKeyDown 均 stopPropagation：阻止键盘事件冒泡到宿主容器
 *   （Tabs 的 .ant-tabs-tab-btn / 侧边栏 Menu 项）的键盘导航与删除逻辑。
 *   否则在输入框内按 Backspace/Delete 会触发 Tabs 删除页签或焦点转移导致
 *   编辑态异常退出。
 */
export interface SheetNameEditorProps {
  /** 输入框类名：页签头 `.sheet-tab__input` / 侧边栏 `.sheet-item__input`（样式/测试/e2e 选择器依赖）。 */
  className?: string;
  /** 当前 Sheet 名（输入框初始值 defaultValue）。 */
  name: string;
  /** 挂载后自动聚焦（两处一致）。 */
  autoFocus?: boolean;
  /** 提交（Enter / 失焦）：携带输入框当前值。 */
  onCommit: (name: string) => void;
  /** 取消（Escape）：不提交。 */
  onCancel: () => void;
}

export function SheetNameEditor({
  className,
  name,
  autoFocus = false,
  onCommit,
  onCancel,
}: SheetNameEditorProps): React.ReactNode {
  return (
    <input
      className={className}
      defaultValue={name}
      autoFocus={autoFocus}
      onClick={(event) => event.stopPropagation()}
      // onFocus 阻止 focus 事件冒泡：页签头输入框是 .ant-tabs-tab-btn 的后代，
      // 聚焦时若 focus 冒泡到 tab button 的 onFocus，rc-tabs 会 setFocusKey 并经
      // TabNode effect 调 btnRef.focus() 抢回焦点，导致输入框立即 blur 退出编辑态。
      // stopPropagation 切断该回流链路（侧边栏 Menu 项无此处理器，不受影响）。
      onFocus={(event) => event.stopPropagation()}
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          onCommit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          onCancel();
        }
      }}
    />
  );
}
