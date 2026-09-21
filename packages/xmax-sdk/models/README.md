# 自训插帧模型候选产物

`tfact2-ours/` 是从用户提供的 NCNN FP32 文件转换得到的 Web 权重，**当前为 SDK 默认模型，人工初步试用正常，尚未通过原生/WebGPU 全链路一致性验证**。

仓库只保留这套自训模型，原模型备份与回切配置已移除。`active-model.json` 记录当前模型 `tfact2-ours`。更新权重后，在仓库根目录运行 `pnpm --filter @xmaxai/web-sdk build`，然后刷新页面并重新建立视频会话。没有新增用户端 SDK 配置。

复现转换（输出目录必须不存在；父目录须已存在）：

```sh
node packages/xmax-sdk/scripts/convert-framegen-model.mjs "/Users/xmax.ai/Downloads/tfact2_ours" "/private/tmp/tfact2-ours-web-candidate"
```

脚本只读取五个输入文件，不修改源文件，不读取或混用 Framegen 原版权重。支持范围限定为已检查的这套 `trunk.param` / `mid.param` 拓扑、48/96 通道和 FP32 编码；其他图或量化编码会拒绝转换。

产物为 `tfact2_ours.bin`（小端 Float32）、`tfact2_ours.json`（每层 shape/offset，offset 单位为 Float32 元素）和 `conversion-report.json`（源文件/产物 SHA-256、转换步骤、未验证事项）。反卷积按 NCNN 的 `[out,in,kh,kw]` 转成当前 rt.js 的 `[in,out,kh,kw]`，不翻转空间核；参考 [NCNN 实现](https://github.com/Tencent/ncnn/blob/master/src/layer/deconvolution.cpp) 和 [PNNX 导出实现](https://github.com/Tencent/ncnn/blob/master/tools/pnnx/src/pass_ncnn/nn_ConvTranspose2d.cpp)。

`film_mlp.bin` 无自描述元数据，目前按 `film.0.weight / film.0.bias / film.2.weight / film.2.bias` 顺序解释。必须用原始导出脚本或原生推理结果确认这一假设，并核对 `TfactFilm`、`TfactRPrep`、`TfactCompose` 和输入 BGR/归一化/缩放逻辑。结构匹配及权重格式转换不等于推理效果一致，也不验证训练来源或授权。

此目录本身不会随 npm 包发布（`files` 白名单仅包含 `dist` 和 `LICENSE`）。`scripts/embed-framegen.mjs` 按 `active-model.json` 读取并校验模型，将自训权重嵌入生成文件与 `dist`。Framegen 依赖包仍用于运行时，但其自带权重不会被本脚本读取或嵌入 SDK。转换报告描述转换时的状态，不代表后续完整验收已经完成。
