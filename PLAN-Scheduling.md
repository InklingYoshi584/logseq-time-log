# PLAN-Scheduling — 时间调度系统

## 概述

在现有 Time Log 基础上添加调度（scheduling）功能。时间块可以提前计划（planned），系统自动追踪执行情况，对比计划与实际并显示误差。

## 数据模型

### 块格式

| 状态 | 格式 |
|------|------|
| 计划（未开始） | `(09:00) - (11:00) ((uuid))` 或 `(09:00) - (11:00) activity` |
| 计划（进行中） | 同上（视觉上：当前时间以上实心，以下虚线） |
| 开放块（未完成） | `08:45 - ((uuid))` 或 `08:45 - activity` |
| 合并块（提前开始+计划） | `08:45 - (11:00) ((uuid))` |
| 已完成（无误差） | `09:00 - 11:00 ((uuid))` |
| 已完成（有误差） | `09:00 - 10:55 ((uuid)) (+5)` 或 `09:05 - 11:00 (-5)` |

### 括号语义

- `(09:00)` — 开始时间是计划值
- `(11:00)` — 结束时间是计划值
- 无括号 — 该时间已实际发生
- `(+5)` — 晚5分钟；`(-3)` — 早3分钟
- 无误差文字 — 按计划完成或无需对比

### 类型扩展

```typescript
// TimeLogEntry 扩展
interface TimeLogEntry {
  uuid: string;
  startMinutes: number;
  endMinutes: number | null;  // null = 开放块（无结束时间）
  activity: string;
  todoUuid?: string;
  isClockEntry: boolean;
  isScheduled: boolean;
  isScheduledStart: boolean;  // 开始时间是否带括号
  isScheduledEnd: boolean;    // 结束时间是否带括号
  errorMinutes?: number;      // 带符号的误差分钟数，如 +5, -3
}
```

## 生命周期

### 创建调度块

**拖拽 TODO 到未来时间槽** → 自动创建计划块：
- 格式 `(start) - (end) ((uuid))`
- `isScheduled = true`

**拖拽 TODO 到过去时间槽** → 直接创建已完成块：
- 格式 `start - end ((uuid))`（无括号）
- 立刻写入 LOGBOOK CLOCK

**CBD（拖拽空白区域）** → 同样逻辑：未来=计划，过去=已完成

**点击当前时间线** → 打开弹窗：
- 输入名称（可选）
- 搜索关联 TODO（可选，搜索当天日记的 TODO）
- 创建开放块：`HH:MM - activity` 或 `HH:MM - ((uuid))`
- `endMinutes = null`，从当前时间延伸到手动关闭

### 自动打卡（Auto-Clock）

触发机制：`setTimeout` 精准定时 + 每10秒轮询兜底

**进入计划块（当前时间 ≥ 开始时间）：**
1. 如果有关联 TODO 且状态不是 DOING/DONE → 切换为 DOING
2. 写入 LOGBOOK CLOCK 开始行
3. 视觉：实心从顶部向下推进到当前时间

**离开计划块（当前时间 ≥ 结束时间）：**
1. 如果有关联 TODO → 切换回原状态
2. 写入 LOGBOOK CLOCK 结束行
3. 移除括号
4. 无干预完成 → 不显示误差文字

### 合并检测

每次渲染/刷新时检查：
- 存在开放块 `HH:MM - ((uuid))` 且同一 TODO 有计划块
- → 合并为一个块：开始时间用实际的，结束时间保留括号
- LOGBOOK：合并为一条 CLOCK

### 用户干预

**干预触发条件：**
1. 提前切换 TODO 状态（不是自动打卡触发的）
2. 点击进行中的块（开放块点任意位置关闭它）
3. 不等于计划结束时间的实际打卡结束

**干预结果：**
- 停止自动打卡
- 括号移除
- 显示误差文字

### 完成无误差

- 无用户干预
- 实际打卡结束时间 = 计划时间
- 括号移除，不显示误差

### Shift-Resize

**计划块（未开始）：** 更新计划时间，保持计划状态

**计划块（进行中）：**
- 调整开始时间 → 显示开始误差
- 调整结束时间：
  - 新结束 > 当前时间 → 更新计划结束
  - 新结束 ≤ 当前时间 → 显示误差，变为已完成

**已完成块：** 更新 CLOCK，重新计算误差

## 5分钟步进

- 所有时间操作强制5分钟步进
- 光标位置自动取最近5分钟：`Math.round(minutes / 5) * 5`
- 网格吸附到5分钟倍数
- CBD / 移动 / 缩放 → 吸附至5分钟
- CLOCK 写入 LOGBOOK 时，开始/结束时间取最近5分钟
- 网格线：15分钟一格（粗线），5分钟一格（细线）

## 视觉状态

| 状态 | 边框 | 填充 | 额外 |
|------|------|------|------|
| 计划（未来） | 虚线 | 半透明 | — |
| 计划（进行中） | 虚线 | 当前时间以上实心，以下虚线 | — |
| 开放块 | 实线 | 实心，底部延伸到当前时间 | 无结束手柄 |
| 合并块 | 混合 | 开始实心，结束虚线 | — |
| 已完成 | 实线 | 实心 | — |
| 已完成（误差） | 实线 | 实心 | 误差徽章 |

## 开放块行为

- **移动**：无移动 — 点击任意位置关闭块
- **关闭**：点击块任意位置 → 结束时间 = 当前时间 → 变为已完成
- **不跨天**：午夜自动关闭
- **没有 TODO**：纯时间块，不影响任何 TODO 状态

## 影响范围

### types.ts
- `TimeLogEntry` 扩展：`endMinutes: number | null`，`isScheduled`，`isScheduledStart`，`isScheduledEnd`，`errorMinutes`

### logseq.ts
- `parseTimeLogEntry` 重写：处理括号、开放块、误差文字
- `formatTimeLogEntry` 新增：TimeLogEntry → 文本格式
- 5分钟吸附工具函数：`snapTo5(minutes)`
- 合并检测函数：`detectAndMerge()`

### App.tsx
- 自动打卡系统：`setTimeout` + 10s 轮询
- 当前时间线点击弹窗
- `handleDropOnTimeLog`：未来/过去判断
- `handleTimeLogDragEnd`：吸附5分钟
- CBD 弹窗（如果在未来）

### TimeBlock.tsx
- 虚线/实线/混合边框
- 实心/半透明填充
- 误差徽章
- 开放块：不显示底部手柄，不响应移动

### CurrentTimeLine.tsx
- 可点击，触发创建开放块弹窗

### 新组件
- `QuickCreateDialog.tsx`：点击当前时间线弹出的名称+TODO搜索弹窗

### App.css
- 计划块样式（虚线边框、半透明）
- 进行中样式（渐变填充）
- 误差徽章样式
