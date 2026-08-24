/** Vite 静态资源模块声明：packages/ui 源码直出（exports 指向 ./src），
 *  三端（浏览器/Electron/VSCode）均经 apps/web 的 Vite 编译，
 *  需在此声明 *.svg 导入为字符串 URL（Vite 默认 <4KB 内联为 data URI）。 */
declare module "*.svg" {
  const src: string;
  export default src;
}
