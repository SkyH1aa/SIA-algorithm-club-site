# V10Ultra 独立本地 NNUE 训练

网站继续加载原有 `public/gomoku-models/v10ultra/rapfi.data`。本目录没有被页面、Worker、边缘函数引用；所有脚本只读取生产资源，将教师副本、环境、缓存、棋谱、检查点及新权重写在本目录，**不会发布、修改网页、上传Supabase或替换任何模型**。入口运行前后核验整个 `public/gomoku-models/` 和训练先验的SHA256，结果在 `cache/isolation.json`。网页服务不应将本目录作为可下载的训练资产发布。

## 已安装与训练方式

官方 [pytorch-nnue-trainer](https://github.com/dhbloo/pytorch-nnue-trainer) 固定在 `ed6ff57cbd9d31bc5217ecbdf0de2a004c6be374`，下载在 `trainer/`；原生Rapfi 250615引擎在 `engine/`，教师是从网站包逐字节提取的当前Mix9sVQ自由网。GPU已验证为RTX5090 Laptop，实际显存约24GiB。

当前官方量化网没有附带原mapping MLP的`.pt`。本方案使用官方Mix9s的量化感知卷积/策略头/价值头，导入现有二进制：**冻结原棋型查表、码本及深度卷积，训练146,596个策略和价值头参数**。这是真正生成新的NNUE二进制，既不是从随机网起步，也不是恢复了完整的原训练检查点。导入/未训练导出的解压字节已验证完全相同。候选保持原架构、规则、大小及查表，原浏览器引擎可使用此格式；将来发布仍须做浏览器棋力与速度验收。

初始网教师用独立原生引擎更深搜索生成动作和分数标签；分数经明确的近似胜负平转换，85%教师标签混入15%完整棋谱结果。它不是读取原网原始策略概率，也不把玩家落子或整场败局粗暴当成正确策略。自对弈使用不同随机合法开局，双方同权重搜索，每局必须完整结束。教师与学生都是自由棋，黑白视角统一为当前行棋方。

八种对称增强只应用训练集；按完整棋谱划分训练/验证，重复下载、模型视角和相同轨迹去重；共享中后盘对称局面的棋谱分配同一集。前六手不用于本轮小样本头训练，以免公共开局联通全部训练/验证棋谱。原始七期数据全部保留，未终局记录跳过。新增败局会累计混入历史普通棋谱与自对弈，避免单局过拟合。

## 一条命令：100局后训练，再对初始网换色各一局

在PowerShell切换到仓库根目录后执行：

```powershell
& .\tools\train-gomoku-ultra-100.ps1
```

等价命令（可按需调整）：

```powershell
& .\training\gomoku-nnue\.venv\Scripts\python.exe .\tools\train-gomoku-ultra-selfplay.py --games 100 --cycles 1 --steps 2000 --batch 32 --selfplay-ms 2000 --selfplay-depth 24 --teacher-ms 10000 --teacher-depth 32 --compare-initial --comparison-pairs 1 --arena-ms 75000 --arena-depth 12 --skip-arena
```

这会新生成100条完整、不重复的自对弈棋谱，再累计教师标注并训练2000个优化步，最后候选执黑、执白各对初始网一局。自对弈每手2秒、标注每局面10秒、对比每手75秒；均为上限，实际可能提前完成。教师标注量大，整套可能运行数小时，控制台显示`SELFPLAY/LABEL/TRAIN/ARENA`进度。`--skip-arena`只跳过额外24场自动择优验收，**不会跳过你要求的双色两局**。两局用于观察，不足以证明整体更强，不会自动设为网站模型。

输出在 `runs/<时间戳>/`：

- `last.pt`、`best.pt`：可恢复头参数检查点。
- `candidate-last.bin.lz4`：最后一次真实训练后的权重。
- `candidate-best.bin.lz4`：验证集最优候选；若训练未改善验证损失，它可能仍是初始网，`bestStep=0`明确注明。
- `initial-comparison.json`：完整两局棋谱、每手搜索日志、候选颜色及胜负结果。若验证集没有改善，会比较实际训练的last候选，避免把初始网自己对战伪称训练效果。
- `manifest.json`：数据量、训练/验证棋谱ID、教师参数、损失、双色结果及`strengthAccepted=false`。

## 每次新增Ultra败局后训练

将下载的数据继续放入新的 `五子棋训练数据<期号>/`，在根目录执行：

```powershell
& .\training\gomoku-nnue\.venv\Scripts\python.exe .\tools\train-gomoku-ultra-losses.py --steps 2000 --skip-arena --compare-initial
```

只在出现此前未处理、已完整合法终局、`model_version=10.1/result=loss`的不同棋谱时训练。副本不触发重复训练，其他版本败局不会作为触发条件。新局全部落子、双方颜色都重新由教师标注，难例训练抽样权重为普通样本的3倍。默认每次从初始网起步，累计使用已缓存历史标签；保留每次输出。需要继续上一候选时显式指定 `--parent-weight <candidate.bin.lz4>`；`--resume <best.pt>`必须与该检查点的初始化父权重匹配，恢复头参数，优化器重新初始化。

手动运行一次即可；如希望自己在本机开启监听：

```powershell
& .\training\gomoku-nnue\.venv\Scripts\python.exe .\tools\train-gomoku-ultra-losses.py --watch --poll-seconds 30 --steps 2000 --skip-arena
```

按Ctrl+C停止；没有新独立败局时不训练。未执行下载、不读取远端数据库。当前提供了监听脚本，**尚未在后台启动监听或计划任务**。

## 多轮自对弈择优

```powershell
& .\training\gomoku-nnue\.venv\Scripts\python.exe .\tools\train-gomoku-ultra-selfplay.py --games 20 --cycles 5 --steps 2000 --pairs 12
```

每轮20局+训练，再用12个独立开局、模型换色共24场检验。只有独立验证损失改善、黑白得分均超过50%、配对得分保守下界超过50%时，候选才作为**训练内部**下一轮自对弈父权重。结果写 `runs/champion.json`；网站不变。这是寻找本次候选中较好的权重，无法保证数学意义上的“最优权重”，也无法保证每一轮变强。同教师仅自蒸馏的提升空间有限，长期仍需更多不同开局、强教师和广泛棋力验收。

## 重建环境与检查

已完成安装；换电脑时用Windows Python 3.10+、可用CUDA版PyTorch及VS C++ Build Tools运行：

```powershell
python .\tools\setup-gomoku-nnue.py
& .\training\gomoku-nnue\.venv\Scripts\python.exe .\tools\test-gomoku-nnue.py
```

环境使用`--system-site-packages`复用主Python中已安装的CUDA PyTorch；训练资源与网站隔离，但并非容器级Python包隔离。安装的额外依赖在`.venv`。上游通用`train.py`全网训练仍可能需要Linux/WSL及KeOps；这里Windows独立头训练只载入需要的官方模块，无需KeOps。

所有运行产物/下载依赖通过`.gitignore`排除；脚本、安装来源清单及这份文档保留。`build-gomoku-training-model.mjs`只构建网页开局先验，与NNUE训练不同；本流程不会运行它或改变生产先验。新期次若要发布至网页先验，需另行执行仓库累计构建与冻结边界验收。

目前已通过字节回环、双方原生搜索、GPU单步梯度和候选加载检查；**没有执行100局、长期训练或两场完整验收，也没有宣称新权重变强**。
