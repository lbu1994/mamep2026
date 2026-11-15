/**
 * Android 平台包：Capacitor 原生通信适配。
 *
 * 注意：`./capacitor-bridge` **不在此导出**（改用子路径 `@mamep2026/platform-android/capacitor`），
 * 使浏览器 / Electron / VSCode 构建不被迫加载 `@capacitor/core`。
 */
export * from "./android-capabilities";
export * from "./android-defaults";
export * from "./android-platform-host";
export * from "./bridge";
export * from "./bridge-contract";
export * from "./capacitor-tcp-transport";
export * from "./capacitor-usb-serial-transport";
export * from "./clock";
export * from "./detect-android";
export * from "./error-mapping";
export * from "./serial-parameters";
