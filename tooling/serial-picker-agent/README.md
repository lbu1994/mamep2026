# Serial Picker Agent

Windows Web Serial 的系统端口选择器由 Edge 自己绘制，Playwright 无法操作。该 helper 使用
FlaUI/UIA3 在 Edge 主窗口内定位端口 `DataItem`，按名称选择指定端口，再触发 picker 的
“连接/Connect”按钮。

仅在真实 Web Serial E2E 中使用。普通测试使用 Web Serial mock，不依赖该 helper。

手工探测：

```powershell
dotnet run --project .\tooling\serial-picker-agent\SerialPickerAgent.csproj -c Release -- `
  --pid <msedge-main-pid> --dump --port COM4 --output .\test-reports\serial-picker-ui-tree.json
```

自动选择：

```powershell
dotnet run --project .\tooling\serial-picker-agent\SerialPickerAgent.csproj -c Release -- `
  --pid <msedge-main-pid> --select --port COM4
```
