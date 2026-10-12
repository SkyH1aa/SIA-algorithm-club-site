# V10Flash 对 V9Thinker 双色对战

V10Flash（内部 10.4）先验取材规则变更后的换色完整对局验收。

## 对比方法

- 15×15 自由棋，无禁手，黑先白后，五连及长连均胜；空盘开始。
- 双方各执黑白一局，共两局。
- 真实 Chrome Worker 与墙钟：V10Flash 90 秒 / 16 层，V9Thinker 40 秒 / 7 层。
- 每局棋谱逐步重放校验（合法性、换色、终局一致），并复核所有资源 SHA256。

## 复现

```bash
node tools/run-gomoku-model-pair.mjs v10flash v9thinker v10flash-vs-v9thinker
```

## 结果

| 局次 | 黑方 | 白方 | 胜方 | 手数 |
| --- | --- | --- | --- | --- |
| 1 | V10Flash | V9Thinker | **V10Flash** | 21 |
| 2 | V9Thinker | V10Flash | **V10Flash** | 42 |

**V10Flash 2 胜 0 负，双色均胜。**

先验在第 2 局第 2 手生效一次：V10Flash 执白，Rapfi 原选 7,8，数据（10 局 7 胜 3 负）支持斜向，改下 6,6。

用时：V10Flash 32 手，均 1.59 秒，最大 11.22 秒；V9Thinker 31 手，均 0.47 秒，最大 1.26 秒。

## 局限

空盘换色各一局不构成 Elo 评估。一组对局只说明这一局面下的结果，不能推广到任意开局与设备。
