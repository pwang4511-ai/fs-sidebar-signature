# 飞书客服审核 GitHub 包（FINAL PATCH94 20260711）

这是飞书客服审核 / GitHub 源码交付包。

## 内容

- `src/`：插件源码
- `dist/`：已构建产物
- `config.json`：飞书多维表格侧边栏插件配置
- `meta.json`：插件审核元信息
- `README.md`：项目说明和最终审核说明
- `package.json` / `package-lock.json`：构建依赖

## 版本

`1.0.42`

## 验证

已在打包前执行：

```bash
npm run build
npm run test:image-preview
npm run test:sidebar-key-safety
```

## 说明

- 未包含 `node_modules`、`.git`、服务器数据或运行日志。
- 默认后端地址为 `https://liupanqing.asia`。
- `src/` 与 `dist/` 和同批次最终前端完整包一致。
