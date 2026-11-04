# 备份、恢复与访问重置

> 预览版：整实例备份/恢复脚本尚未提供，以下为手工步骤。产品级迁移请用产品页的“导出产品”和“导入”页。

## 两种备份的区别

| | 产品导出（ZIP） | 实例备份 |
| --- | --- | --- |
| 范围 | 一个产品的需求、资料原文、条目、报告 | 整个数据库和数据目录 |
| 恢复方式 | 导入为**新**产品，ID 重新分配 | 覆盖整个实例 |
| 包含访问口令/会话 | 否 | 是（数据库中的哈希） |

## 不用 Docker（内嵌 PGlite）

数据全部在项目根目录的 `.data/`。

备份：先停止服务（`Ctrl+C`），再复制整个目录：

```bash
cp -R .data ".data-backup-$(date +%Y%m%d-%H%M)"
```

恢复：停止服务，用备份替换 `.data/`，再启动。服务运行时不要复制或替换 `.data/pglite`，否则可能得到损坏的副本。

## Docker Compose（Postgres）

备份：

```bash
docker compose exec db pg_dump -U pew -d pew -Fc > "pew-$(date +%Y%m%d-%H%M).dump"
```

恢复到新实例：

```bash
docker compose exec -T db pg_restore -U pew -d pew --clean --if-exists < pew-YYYYMMDD-HHMM.dump
```

## 升级与迁移失败

服务启动时自动执行 `migrations/` 中的数据库迁移。迁移失败时服务**会停止启动**并打印错误，不会在半迁移的数据库上运行。

升级前先按上面的步骤备份。迁移失败时：回到上一版本代码**并**恢复升级前的备份。只回退代码或镜像不会回滚数据库。

## 访问口令

忘记口令或怀疑泄露：

```bash
npm run access:reset
```

Docker：

```bash
docker compose exec web npm run access:reset
```

运行后所有已登录会话立即失效；终端显示的一次性初始化码 30 分钟内有效，在登录页输入并设置新口令。

## 模型密钥与主密钥

模型密钥用主密钥加密。主密钥来自环境变量 `PEW_MASTER_KEY`，否则保存在数据目录的 `master.key`。

- `.data/` 备份已包含 `master.key`，请当作敏感文件保管。
- Compose 的 `pg_dump` 备份**不包含**主密钥。恢复到新实例后，业务数据可以正常读取，但模型密钥无法解密：设置页会提示重新填写，其他数据不受影响。
- 产品导出 ZIP 不含模型配置。

## 已知限制

- 永久删除资料只清除本工具数据库中的内容。已导出的 ZIP、旧备份和你自己保存的文件不会被撤回；恢复旧备份可能恢复已删内容。
- 不承诺取证级磁盘擦除。
- 服务被强制结束后，`.data/pglite.lock` 可能残留；它记录的进程已不存在时会被自动忽略。
