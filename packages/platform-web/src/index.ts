export * from "./indexeddb-repository";
export * from "./mock-scenarios";
export * from "./mock-transport";
export * from "./real-clock";
export * from "./web-serial-host";
export * from "./web-serial-transport";
// Web Serial 最小类型声明：供复用侧（如 ElectronAppHost 注入参数）显式引用。
export type * from "./web-serial";
