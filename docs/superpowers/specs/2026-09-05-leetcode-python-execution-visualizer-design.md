# LeetCode Python Execution Visualizer

## MVP Design Spec v0.2

---

# 1. Product Definition

## 一句話定義

在 LeetCode 頁面旁提供一個 Python visual debugger，把使用者目前實際寫出的程式碼與 testcase，在 browser 中重新執行並轉換成可以逐步檢視的 execution-state visualization。

核心 pipeline：

$$
\text{Python Code + Testcase}
\rightarrow
\text{Local Execution}
\rightarrow
\text{Execution Trace}
\rightarrow
\text{Runtime State}
\rightarrow
\text{State Diff}
\rightarrow
\text{Visual Interpretation}
\rightarrow
\text{Visualization}
$$

本產品不是 LeetCode solver。

本產品不需要理解「正確解法」。

本產品也不負責判斷：

* AC
* WA
* LeetCode TLE
* 正確演算法

它只回答：

> 這份 code 在目前 testcase 下，實際執行時發生了什麼？

---

# 2. Product Boundary

Visualizer 執行的是：

$$
(\text{Current Code}, \text{Current Testcase})
\overset{\text{Pyodide}}{\longrightarrow}
\text{Local Observable Execution}
$$

而不是：

$$
\text{LeetCode Judge Execution}
\longrightarrow
\text{Trace Replay}
$$

因此，本產品不宣稱完整重現 LeetCode judge environment。

Pyodide 與 LeetCode runtime 可能在以下方面不同：

* Python version
* recursion limit
* available modules
* LeetCode compatibility prelude
* native/runtime implementation
* CPU performance
* execution timeout
* memory constraints

因此：

`completed`

只表示：

> local execution returned normally.

不表示：

> Accepted.

`timeout`

只表示：

> local visualization runtime exceeded its wall-clock execution limit.

不等於：

> LeetCode TLE.

同樣地，一份在 LeetCode 上產生錯誤答案的程式，只要能正常執行完成，仍然可以完整 visualized。

---

# 3. Problem

目標使用情境：

使用者通常已經知道演算法大致想怎麼做，但無法一次準確地把 mental model 翻譯成 code。

目前 workflow：

```text
Idea
 ↓
嘗試寫 Code
 ↓
Run
 ↓
WA / Runtime Error / TLE
 ↓
閱讀 Code 猜問題
 ↓
修改
 ↓
Run again
```

本產品改成：

```text
Idea
 ↓
嘗試寫 Code
 ↓
Visualize
 ↓
觀看真實 Execution State
 ↓
找到 implementation 與 mental model 開始分岔的位置
 ↓
修改 Code
 ↓
Visualize again
```

因此主要問題不是：

> 正確答案是什麼？

而是：

> 我現在這份 code 實際上到底在做什麼？

---

# 4. MVP Thesis

本產品真正要驗證的不是：

> 我們能不能把演算法畫得很漂亮？

而是：

> 當使用者腦中知道大致該怎麼做、但無法把想法正確翻成 code 時，execution-state visualization 是否能縮短 mental model 與 implementation 之間的 debugging loop？

如果答案是 yes，產品方向成立。

---

# 5. Design Principles

## 5.1 Execution 與 Visualization 分離

核心原則：

> Tracer 負責「發生了什麼」；Visualizer 負責「怎麼讓人看懂」。

因此：

```text
Execution Layer
≠
Visualization Layer
```

Trace engine 不知道：

* Two Pointer
* Sliding Window
* Binary Search
* DFS
* Dynamic Programming
* Graph
* Hash Map

它只知道：

* line
* function
* frame
* locals
* call
* return
* exception
* stdout

Visualizer 才把：

```text
nums  = [2,7,11,15]
left  = 1
right = 3
```

解讀成：

```text
     left        right
       ↓            ↓
[2]  [7]  [11]  [15]
```

---

## 5.2 Execution Support ≠ Specialized Visualization Support

某類題目沒有 dedicated visualizer，不代表不能執行。

例如：

```python
graph = {
    0: [1, 2],
    1: [3],
    2: []
}
```

本質上只是：

```text
dict[int, list[int]]
```

因此 v0.1 可以 trace。

但不代表會畫成：

```text
○──○
│
○──○
```

同理：

```python
dp = [[0] * n for _ in range(m)]
```

可以 trace nested list state。

但 v0.1 不提供專用 DP matrix visualizer。

---

# 6. MVP Scope

## Language

Python 3

---

## Supported Primitive / Container Values

* int
* float
* bool
* str
* None
* list
* tuple
* dict
* set

Nested combinations of supported containers are allowed within configured serialization limits.

---

## Execution

* normal function calls
* loops
* conditionals
* ordinary recursion
* exceptions
* return values
* stdout

---

## Primary Visualization

```text
list
+
index / pointer
```

---

## Generic Visualization

* locals inspector
* scalar value changes
* list mutation diff
* dict state / diff
* set state / diff
* nested container inspection
* call stack

---

## Primary Target Algorithm Styles

* Array
* Two Pointer
* Sliding Window
* Binary Search
* explicit Python-level sorting / mutation
* Hash Map
* ordinary recursion
* DFS over primitive/container structures
* simple Dynamic Programming
* adjacency-list Graph algorithms

---

# 7. Support Matrix

| 題型 / 結構                              | v0.1                                                     |
| ------------------------------------ | -------------------------------------------------------- |
| Array                                | Supported + dedicated list visualization                 |
| Two Pointer                          | Supported                                                |
| Sliding Window                       | Supported                                                |
| Binary Search                        | Supported                                                |
| Hash Map                             | Supported through generic dict state                     |
| Explicit Python list mutation        | Supported                                                |
| DP using 1D list                     | Supported                                                |
| DP using nested lists                | Supported through generic nested-container visualization |
| Dedicated DP table visualizer        | Not supported                                            |
| DFS recursion                        | Supported                                                |
| Graph represented by adjacency list  | Supported through generic containers                     |
| Dedicated node-edge Graph visualizer | Not supported                                            |
| ListNode                             | Not supported                                            |
| TreeNode                             | Not supported                                            |
| LeetCode Graph Node object           | Not supported                                            |
| Expression-level execution animation | Not supported                                            |

---

# 8. Explicit Non-Goals

v0.1 不處理：

* AI solution generation
* AI code correction
* AI algorithm explanation
* AI intent inference
* correctness evaluation
* LeetCode verdict reproduction

暫不支援 LeetCode-specific structures：

* ListNode
* TreeNode
* Graph Node
* NestedInteger

不做：

* C++
* Java
* JavaScript

不提供完整 IDE debugger capabilities，例如：

* conditional breakpoint
* watch expression
* arbitrary memory inspection
* bytecode stepping
* expression-level stepping

第一版 step granularity 固定為：

```text
Python line-level
```

---

# 9. Line-Level Trace Semantics

v0.1 使用 Python `sys.settrace` style line-level tracing。

需要捕捉：

* call
* line
* return
* exception

其中 `line` event 的語意明確定義為：

> Python interpreter is about to execute this source line.

因此：

```python
left += 1
```

當 tracer 收到這一行的 `line` event 時：

```text
left
```

仍然是該行執行前的值。

例如：

```text
Step 7

Current Line
left += 1

Current State
left = 0
```

下一個 trace step 才可能觀察到：

```text
State Changes
left
0 → 1
```

v0.1 不額外建立 expression/post-line instrumentation 去把 mutation 強行歸屬到同一個 source-line step。

這是 deliberate debugger semantics。

---

# 10. User Experience

使用者維持原本 LeetCode workflow。

```text
LeetCode Code Editor
       +
LeetCode Testcase
       │
       ▼
   Visualize
       │
       ▼
Side Panel opens
```

主要畫面：

```text
┌──────────────────────────────┐
│ Code                         │
│                              │
│  7      left += 1            │
│ >8  while left < right:      │
│                              │
├──────────────────────────────┤
│ Visual State                 │
│                              │
│        left          right   │
│          ↓              ↓    │
│ [2] [7] [11] [15] [20]      │
│                              │
├──────────────────────────────┤
│ State Changes                │
│                              │
│ left      0 → 1              │
│                              │
├──────────────────────────────┤
│ Locals                       │
│                              │
│ total     17                 │
│ target    20                 │
│ right      4                 │
│                              │
├──────────────────────────────┤
│ Call Stack                   │
│ Solution.twoSum              │
│                              │
├──────────────────────────────┤
│ ◀ Previous   Step 6/18  Next ▶
│             ▶ Play           │
└──────────────────────────────┘
```

Navigation priority：

1. Previous / Next
2. current step
3. Play / Pause

Manual stepping 是主要 interaction。

Autoplay 只是輔助。

---

# 11. High-Level Architecture

```text
┌──────────────────── LeetCode ────────────────────┐
│                                                 │
│ Code Editor                  Testcase Panel      │
│      │                            │              │
└──────┼────────────────────────────┼──────────────┘
       │                            │
       └─────────────┬──────────────┘
                     ▼
              LeetCode Adapter
                     │
                     ▼
          Execution Request Builder
                     │
              ┌──────┴──────┐
              ▼             ▼
       Entrypoint       Input Parser
        Resolver
              └──────┬──────┘
                     ▼
              ExecutionRequest
                     │
                     ▼
            Execution Controller
                     │
                     ▼
           ┌──────────────────┐
           │ Web Worker       │
           │                  │
           │ Pyodide          │
           │ Runtime Prelude  │
           │ Python Tracer    │
           └────────┬─────────┘
                    │
                    ▼
             TraceEvent Batches
                    │
                    ▼
          Trace Session Collector
                    │
                    ▼
       Runtime State Reconstruction
                    │
                    ▼
             State Diff Engine
                    │
                    ├──────────────────┐
                    ▼                  ▼
              AST Analyzer       Runtime State
                    │                  │
                    └────────┬─────────┘
                             ▼
                     Binding Resolver
                             │
                             ▼
                       Visual Model
                             │
                             ▼
                         Renderer
```

---

# 12. Chrome Extension Architecture

使用 Manifest V3。

主要 components：

```text
manifest.json

service-worker/
    background

content/
    leetcode-adapter

page-bridge/
    optional MAIN-world bridge

sidepanel/
    UI
    execution-controller
    trace-session-collector

worker/
    Pyodide runtime
    Python execution
    tracer

core/
    execution-request
    trace-schema
    runtime-state
    state-diff
    AST-analysis
    binding-resolver

visualizers/
    list
    generic-locals
    call-stack
```

Chrome Side Panel 作為主要 UI surface。

---

# 13. LeetCode Adapter

LeetCode Adapter 只負責：

```text
getCode()
getLanguage()
getTestcase()
getProblemMetadata()
```

其餘系統不可以直接操作 LeetCode DOM。

理由：

LeetCode UI 未來可能改版。

因此：

```text
LeetCode DOM
     │
     ▼
LeetCodeAdapter
     │
     ▼
stable internal interface
```

禁止：

```text
Visualizer
    ↓
querySelector(...)
```

散落各處直接依賴 LeetCode DOM structure。

如果一般 isolated content script 無法可靠取得 Monaco/page runtime state，可以使用極薄的 MAIN-world bridge。

MAIN-world bridge 只能負責 page-state extraction。

例如：

* current source code
* current testcase
* problem metadata

不得直接暴露 privileged extension operations。

資料流應維持：

```text
LeetCode Page JS
      ↕
MAIN-world Bridge
      ↓
validated message
      ↓
isolated extension context
```

---

# 14. Execution Request

LeetCodeAdapter 不直接呼叫 Pyodide。

中間建立 stable internal model：

```text
ExecutionRequest
```

Schema：

```text
ExecutionRequest
source_code
language
raw_testcase
entrypoint
runtime_prelude
limits
```

---

## Entrypoint

例如：

```python
class Solution:
    def twoSum(
        self,
        numbers: List[int],
        target: int
    ) -> List[int]:
        ...
```

EntryPoint：

```text
class_name
    Solution

method_name
    twoSum

parameter_count
    2
```

Execution engine 不自行猜哪一個 method 要執行。

---

# 15. Input Flow

例如：

```python
class Solution:
    def twoSum(
        self,
        numbers: List[int],
        target: int
    ) -> List[int]:
        ...
```

LeetCode testcase：

```text
[2,7,11,15]
9
```

Input Parser 產生 argument values：

```text
[
    [2,7,11,15],
    9
]
```

Invocation harness：

```text
Solution.twoSum(
    [2,7,11,15],
    9
)
```

v0.1 只要求能處理 Python primitive/container testcase。

如果 parser 無法確定解析方式：

```text
InputAdapterError
```

而不是猜測。

---

# 16. Runtime Compatibility Prelude

LeetCode user code 可能包含：

```python
List[int]
Optional[int]
```

或其他 LeetCode environment 預先存在的 names。

因此 Execution Engine 可以建立 controlled compatibility prelude。

但 prelude 不應直接 prepend 到 user source。

禁止：

```text
prelude
+
user source
```

因為會導致 source line number offset。

正確概念：

```text
create runtime globals
        ↓
execute compatibility prelude
        ↓
compile user code independently
        ↓
execute user code
        ↓
invoke entrypoint
```

user source 應具有自己的 filename，例如：

```text
<leetcode-user-code>
```

確保：

```text
TraceStep.line
```

可以一對一對應 LeetCode editor line number。

---

# 17. Execution Isolation

Python 不在 Side Panel main thread 執行。

使用：

```text
Side Panel
    │
    ▼
Execution Controller
    │
    ▼
module Web Worker
    │
    ▼
Pyodide
```

Pyodide runtime 必須隨 extension bundle 發布。

不在 runtime 從 CDN 下載 executable code。

概念 CSP：

```text
script-src 'self' 'wasm-unsafe-eval';
object-src 'self';
```

Web Worker 的主要目的：

* UI responsiveness
* execution containment
* timeout termination
* crash/failure isolation

它不是 hardened hostile-code sandbox。

---

# 18. Python Trace Engine

v0.1 使用：

```text
sys.settrace-style tracing
```

Relevant events：

```text
call
line
return
exception
```

每次 relevant event 形成：

```text
TraceEvent
```

不做 expression-level tracing。

例如：

```python
total = nums[left] + nums[right]
```

v0.1 是一個 source-line execution。

不拆成：

```text
read nums[left]
read nums[right]
add
assign total
```

如果未來需要，再考慮 AST instrumentation。

---

# 19. Core Data Model

## TraceSession

```text
TraceSession
schema_version
session_id

source_code
testcase
entrypoint
execution_environment

status
termination_reason

events

return_value
exception

limits
```

`status`：

```text
completed
exception
trace_limit
timeout
parse_error
input_error
internal_error
```

重要原則：

```text
failure ≠ no trace
```

Runtime Error、trace limit、timeout 都可能存在有效 trace prefix。

---

# 20. TraceEvent

```text
TraceEvent
step
event

frame_id
parent_frame_id

line
function
call_depth

locals
stdout_delta

event_payload
```

例如：

```text
step        = 18
event       = line

frame_id    = 4
parent_frame_id = null

line        = 7
function    = twoSum
call_depth  = 1

locals:
    numbers = [2,7,11,15]
    left    = 0
    right   = 3
    target  = 20
    total   = 17
```

---

# 21. Frame Identity

Function name 與 call depth 不足以識別 recursion invocation。

例如：

```text
dfs
  dfs
    dfs
```

全部 function 都叫：

```text
dfs
```

因此 tracer 必須為每次 function invocation 配置：

```text
frame_id
```

`frame_id`：

* session-local
* unique
* monotonic
* stable during frame lifetime

並記錄：

```text
parent_frame_id
```

如此才能可靠 reconstruct call stack。

---

# 22. Runtime State Reconstruction

Trace event 本身不等於 runtime state。

例如：

```text
call
line
line
return
```

是 events。

Visualizer 需要的是：

```text
active frame
call stack
locals per frame
current line
```

因此：

```text
TraceEvent Stream
        ↓
Runtime State Reconstruction
        ↓
RuntimeState
```

概念 model：

```text
RuntimeState
step

active_frame_id
frames

current_line
stdout

exception_state
```

---

# 23. ValueSnapshot

Tracer 不把 arbitrary Python object 直接暴露給 frontend。

所有 value 必須先：

```text
Python Object
     ↓
ValueSerializer
     ↓
ValueSnapshot
```

---

## Primitive

例如 int：

```text
type = int
value = "9007199254740993"
```

Python int 以 decimal string 儲存，避免 JavaScript Number precision loss。

---

## Float

需要支援：

```text
normal finite number
NaN
Infinity
-Infinity
```

---

## List

```text
type = list
length = 4
truncated = false

items:
    2
    7
    11
    15
```

---

## Dict

不能假設 Python dict key 是 JSON string。

因此：

```text
type = dict

entries:
    - key: ValueSnapshot
      value: ValueSnapshot
```

---

## Set

set 無語意 ordering。

Serialization 可以提供 deterministic display order，但 diff 不得依賴 render order。

---

## Unknown Object

```text
type = unknown
repr = "<SomeObject ...>"
```

Visualizer 不認識某種 object：

```text
fallback
```

而不是 execution failure。

---

## Recursive Containers

合法 Python：

```python
a = []
a.append(a)
```

ValueSerializer 必須避免 infinite serialization。

因此 ValueSnapshot 需要支援：

```text
cycle
truncated
```

---

# 24. Serialization Limits

每個 snapshot 必須受到 bounded serialization 約束。

至少包含：

```text
MAX_CONTAINER_ITEMS
MAX_NESTING_DEPTH
MAX_SNAPSHOT_BYTES
```

當物件超過限制：

```text
truncated = true
```

而不是 execution failure。

---

# 25. State Diff

每一步：

$$
\Delta_t = S_t-S_{t-1}
$$

需要偵測：

* added
* removed
* changed
* unchanged

例如：

```text
Step 18 → Step 19

changed:
    left
        0 → 1

unchanged:
    right = 3
    target = 20
```

---

# 26. Frame-Scoped Diff

State diff 必須以 frame 為 scope。

禁止單純比較：

$$
locals_t-locals_{t-1}
$$

因為進入新 function 時：

```python
def foo():
    x = 3
    bar()

def bar():
    y = 5
```

不能解讀成：

```text
removed x
added y
```

這只是 active frame transition。

因此：

$$
\Delta_t^f
=
S_t^f-S_{\operatorname{previous}(f)}^f
$$

variable identity 實際上是：

$$
(frame\_id,\ variable\_name)
$$

call / return 則作為獨立 execution event 顯示。

---

# 27. Container Mutation Diff

Array mutation 需要偵測 element-level change。

例如：

```text
nums

index 1
4 → 9

index 3
9 → 4
```

而不是只判斷：

```text
nums changed
```

同樣可以支援：

* dict entry added
* dict entry removed
* dict value changed
* set member added
* set member removed

---

# 28. Trace Storage

Logical API：

```text
S0
S1
S2
S3
...
```

但 implementation 不應永久 deep-copy unbounded locals。

MVP 可以先採：

```text
bounded serialized snapshots
```

並設定：

```text
MAX_TRACE_STEPS
MAX_CONTAINER_ITEMS
MAX_NESTING_DEPTH
MAX_SNAPSHOT_BYTES
MAX_SESSION_BYTES
MAX_STDOUT_BYTES
```

後續再升級：

$$
S_t=S_{t-1}+\Delta_t
$$

的 delta storage + periodic checkpoint reconstruction。

---

# 29. stdout

不在每個 TraceEvent 重複保存 cumulative stdout。

使用：

```text
stdout_delta
```

例如：

```text
TraceEvent 15
stdout_delta = "hello\n"
```

Session Collector 可以 reconstruction：

```text
full stdout
```

避免 cumulative copying 導致不必要的：

$$
O(n^2)
$$

storage behavior。

---

# 30. AST Analyzer

AST 不負責判斷演算法。

只負責 extraction of structural relations。

例如：

```python
nums[left]
```

得到：

```text
SubscriptRelation
scope      = Solution.twoSum
line       = 7
container  = nums
index      = left
```

```python
nums[right]
```

得到：

```text
SubscriptRelation
scope      = Solution.twoSum
line       = 7
container  = nums
index      = right
```

因此：

```text
left  → nums
right → nums
```

---

# 31. Pointer Binding

v0.1 不使用 name heuristic 作為主要 binding source。

Binding pipeline：

```text
AST structural evidence
        +
Runtime values
        ↓
PointerBinding
```

例如：

```text
PointerBinding
variable      = left
container     = nums
source        = subscript
confidence    = 1.0
```

如果只有：

```text
left = 3
nums = [...]
```

但 AST 從未出現：

```text
nums[left]
```

則不直接畫 pointer。

理由：

> missing visualization 比 false visualization 更安全。

尤其禁止因為：

$$
0\le target < len(nums)
$$

就把：

```text
target
```

誤畫成 array pointer。

---

# 32. Runtime Materialization

AST 只證明：

```text
left is structurally used as an index into nums.
```

真正 visual binding 仍要確認 runtime：

```text
nums is currently visualizable container
left is currently an integer
```

因此：

```text
AST Relation
+
Runtime State
↓
Binding Resolver
```

而不是 AST Analyzer 直接建立 UI。

---

# 33. Visual Model

Renderer 不直接讀 raw TraceEvent。

先產生：

```text
VisualModel
```

例如：

```text
ListVisual
container = numbers

items:
    [2,7,11,15]

pointers:
    left  → 1
    right → 3

changes:
    left
        0 → 1
```

因此：

```text
execution
interpretation
rendering
```

完全分離。

---

# 34. Visualization Priority

一個 step 同時存在大量 variables 時，不全部視覺化。

優先級：

1. Active list + pointer relation
2. Changed variables
3. Current source line
4. Relevant scalars
5. Other locals
6. Secondary containers

UI 不是：

> Debugger Variables Dump

而是：

> Algorithm State

---

# 35. Multiple Containers

例如：

```python
nums = [...]
prefix = [...]
i = ...
```

Visualizer 根據：

* active AST relation
* current line
* recent mutation
* runtime usage

決定 primary container。

Primary：

```text
expanded
```

Secondary：

```text
collapsed
```

使用者可以自行展開。

---

# 36. Dynamic Programming

DP 不屬於 unsupported algorithm category。

例如：

```python
dp = [0] * (n + 1)

for i in range(2, n + 1):
    dp[i] = dp[i - 1] + dp[i - 2]
```

v0.1 已經可以透過：

* list snapshot
* index relation
* element mutation diff
* scalar state

visualize execution。

例如：

```text
i = 4

dp

[0] [1] [1] [2] [3] [0]
                 ↑
               changed
```

對 2D DP：

```python
dp = [[0] * n for _ in range(m)]
```

v0.1 可以透過 generic nested-list state 顯示。

但不提供 dedicated matrix / DP-table interpretation。

---

# 37. Graph

Graph algorithms 依 runtime representation 分類。

如果：

```python
graph = {
    0: [1,2],
    1: [3],
    2: []
}
```

則屬於：

```text
dict + list
```

v0.1 可以執行與 trace。

例如 BFS：

```python
queue = [0]
visited = {0}
current = 0
```

可以透過：

* queue list
* visited set
* current scalar

觀察 state。

但 v0.1 不畫 dedicated node-edge diagram。

如果題目依賴 LeetCode：

```text
Node
```

object，則目前不支援。

---

# 38. Sorting

v0.1 可以 trace explicit Python-level sorting logic，例如：

```python
for i in range(...):
    ...
    nums[a], nums[b] = nums[b], nums[a]
```

但是：

```python
nums.sort()
```

內部排序 implementation 對 line-level tracer 可能表現為 atomic transition。

因此 UI 可能只看到：

```text
before:
[4,1,3,2]

after:
[1,2,3,4]
```

而不是每次 internal swap。

這符合 line-level tracing boundary。

---

# 39. TLE / Infinite Loop Handling

使用三層 protection。

---

## Layer 1 — Trace Step Limit

例如：

```text
MAX_TRACE_STEPS = 10,000
```

超過：

```text
status = trace_limit
termination_reason = step_limit
```

保留先前 trace。

---

## Layer 2 — Session Resource Limit

例如：

```text
MAX_SESSION_BYTES
MAX_STDOUT_BYTES
```

避免大量 snapshots / stdout 消耗 browser memory。

如果超過：

```text
status = trace_limit
termination_reason = trace_byte_limit
```

---

## Layer 3 — Worker Hard Timeout

```text
Execution Controller
        │
        ├── wall-clock timer
        │
        ▼
Web Worker
```

超過設定：

```text
worker.terminate()
```

並建立：

```text
status = timeout
termination_reason = hard_timeout
```

---

# 40. Streaming Trace Preservation

Worker 不可以等 execution 完成才一次回傳完整 TraceSession。

否則：

```text
worker.terminate()
```

會直接遺失 worker memory 中所有 trace。

因此 tracer 必須定期輸出 bounded batches：

```text
Worker
  │
  ├── TraceBatch 1
  ├── TraceBatch 2
  ├── TraceBatch 3
  ├── TraceBatch 4
  │
  X terminated
```

Side Panel 的 Trace Session Collector 持續保存：

```text
events 0 ... N
```

如此 hard timeout 後仍能查看：

> timeout 發生以前，程式到底做了什麼？

不得每一個 TraceEvent 都單獨 `postMessage()`。

實作使用 batching。

---

# 41. Repeating-State Detection

Repeating-state detection 不作為 v0.1 correctness-critical mechanism。

可作為 optional diagnostic。

概念 fingerprint：

$$
H(
\text{line},
\text{active frame state}
)
$$

若大量重複觀察到相同 execution state：

```text
Possible repeated execution state

left  = 3
right = 7

No observed change in selected state.
```

不得宣告：

```text
Infinite loop detected.
```

因為 tracer 只能證明：

> observed state appears repetitive.

不能普遍證明程式永遠不會 progress。

---

# 42. Runtime Error

Runtime Error 仍然保留完整 trace prefix。

例如：

```text
Step 41

left = 5

nums
index
0   1   2   3   4
                ↑
          last valid index

requested:
nums[5]

IndexError
```

Session：

```text
status = exception
```

ExceptionInfo：

```text
type
message
line
stack
frame_id
```

---

# 43. Syntax Error

如果 Python 無法 parse：

```text
status = parse_error
```

不建立 execution trace。

UI：

```text
Cannot visualize because the program cannot be executed.

SyntaxError
line ...
```

這符合產品 boundary：

> 能開始執行的錯誤程式可以 visualization；完全無法開始 execution 的程式不建立 execution visualization。

---

# 44. Input Error

如果 testcase 無法被 deterministic parser 解析：

```text
status = input_error
```

UI：

```text
Cannot execute this testcase.

The current MVP could not map the testcase
to the selected solution entrypoint.
```

禁止模型或 heuristic 猜測 input semantics。

---

# 45. Privacy / Security Boundary

MVP 不需要 backend。

因此：

```text
User Code
Testcase
Execution Trace
```

全部留在 browser extension。

不傳到 server。

不需要：

* account
* database
* OpenAI API
* AI provider key
* telemetry backend

除非未來另外設計 opt-in telemetry。

MVP 原則：

* least-privilege extension permissions
* bundled Pyodide runtime
* no automatic third-party package download
* no user-code upload
* no backend execution
* Worker 用於 responsiveness / failure containment

不宣稱 Web Worker / Pyodide 是 hardened hostile-code sandbox。

---

# 46. Failure Model

所有 termination 必須 deterministic 地落到明確 reason。

```text
completed
    normal_return

exception
    runtime_exception

trace_limit
    step_limit
    trace_byte_limit
    stdout_limit

timeout
    hard_timeout

parse_error
    syntax_error

input_error
    unsupported_testcase_format
    entrypoint_resolution_failed

internal_error
    worker_initialization_failed
    pyodide_initialization_failed
    tracer_internal_error
```

UI 不可以只顯示：

```text
Something went wrong.
```

---

# 47. MVP Acceptance Criteria

v0.1 完成的定義不是：

> 支援很多演算法。

而是以下 workflow 可以完整成立：

1. 使用者打開 LeetCode Python 題目。
2. 寫一份可能不正確的 Python solution。
3. 在 LeetCode Testcase 填 input。
4. 點擊 Visualize。
5. Extension 取得：

   * current source code
   * language
   * current testcase
   * problem metadata
6. Entrypoint Resolver 找到對應 `Solution.method`。
7. Input Parser 將 testcase deterministic 地轉成 arguments。
8. 在 Web Worker / Pyodide 中執行。
9. 建立：

   * line
   * call
   * return
   * exception
     trace events。
10. Side Panel 顯示：

    * current source line
    * visual state
    * pointer relation
    * state changes
    * locals
    * call stack
11. 使用者可以：

    * Previous
    * Next
    * Play
    * Pause
12. Code 即使產生錯誤答案，也可以完整 trace；Visualizer 不判斷 correctness。
13. Runtime Error 保留 exception 以前的 trace。
14. Recursive calls 可以透過 `frame_id` 正確區分。
15. non-progressing execution 不凍結 Side Panel UI。
16. Hard timeout 發生時，已經收到的 trace batches 必須保留。
17. step limit / resource limit / hard timeout 都有清楚 termination reason。
18. Source line number 必須與使用者 editor 原始 source 對齊，不受 runtime prelude 影響。
19. unknown/unvisualized object 只能 fallback，不得導致整個 execution failure。
20. Dedicated visualizer 不存在時，supported primitive/container state 仍可透過 generic inspector 查看。

只要這條 workflow 好用，MVP 就成立。

---

# 48. Recommended MVP Architecture Choice

## A. Browser-only Python Execution

```text
Chrome Extension
+
Pyodide
+
Web Worker
```

採用。

理由：

* no backend
* low interaction latency
* privacy
* simple deployment
* easy execution termination
* Python-first fits initial use case

---

## B. Remote Sandbox Backend

Post-MVP 才評估。

優點：

可以支援：

* Python
* C++
* Java
* JavaScript
* native dependencies

但需要：

* container isolation
* CPU quotas
* memory quotas
* network restrictions
* compiler management
* execution scheduler
* abuse prevention
* backend cost

不適合 v0.1。

---

## C. Instrument Code and Send to LeetCode Run

不採用為核心 architecture。

因為過度依賴：

* LeetCode execution protocol
* UI internals
* output formatting
* remote runner behavior
* website changes

且難以可靠取得完整 execution trace。

---

# 49. Phase 0 — Feasibility Spike

Phase 0 只驗證最危險的技術假設。

需要驗證：

1. LeetCode code extraction
2. LeetCode testcase extraction
3. Entrypoint resolution
4. Pyodide bundled inside MV3 extension
5. `sys.settrace` style:

   * call
   * line
   * return
   * exception
6. partial trace survives worker hard termination

成功標準：

### Case A

```text
simple Two Sum Python solution
→ extension
→ ordered line trace
```

### Case B

```text
intentional infinite loop
→ trace batches arrive
→ worker terminated
→ Side Panel still owns trace prefix
```

Phase 0 不做漂亮 UI。

---

# 50. Phase 1 — Trace Kernel

建立：

```text
ExecutionRequest
TraceSession
TraceEvent
ValueSnapshot
ExceptionInfo
Frame identity
```

以及：

* Python execution
* compatibility prelude
* serialization
* trace batching
* step limit
* session byte limit
* hard timeout

成功標準：

```text
normal program
runtime error
recursion
infinite loop
```

全部都有 deterministic termination。

---

# 51. Phase 2 — Runtime State + State Diff

建立：

```text
RuntimeState
frame reconstruction
call stack reconstruction
frame-scoped diff
```

支援：

* scalar diff
* list mutation diff
* dict diff
* set diff
* added / removed locals

成功標準：

可以回答：

> Step N → N+1 到底觀察到什麼 state change？

---

# 52. Phase 3 — Static Relation Analysis

建立 Python AST analyzer。

第一版只需要：

```text
SubscriptRelation
```

足以辨識：

```python
nums[i]
nums[left]
nums[right]
dp[i]
matrix[row]
```

保留：

* lexical scope
* source location
* container name
* index expression name

---

# 53. Phase 4 — Visual Model

建立：

```text
PointerBinding
ListVisual
VisualState
```

完成：

```text
AST relations
+
runtime state
+
state diff
→
VisualModel
```

---

# 54. Phase 5 — Side Panel

實作核心區域：

* Code
* Visual State
* State Changes
* Locals
* Call Stack
* Previous
* Next
* Play / Pause
* termination reason

---

# 55. Phase 6 — LeetCode Integration Hardening

將所有 site coupling 限制在：

```text
LeetCodeAdapter
```

加入：

* code extraction fallback
* testcase extraction fallback
* language validation
* entrypoint diagnostics
* unsupported-page diagnostics
* adapter version diagnostics

---

# 56. Phase 7 — MVP Validation

實際測試題型：

* Two Sum II
* Binary Search
* Sliding Window
* in-place array mutation
* HashMap
* one-dimensional DP
* simple two-dimensional DP
* adjacency-list BFS / DFS
* recursive function
* intentional infinite loop
* intentional IndexError

目標不是題目 AC。

目標是：

> 在錯誤 code 上，Visualizer 是否真的讓人更快看出 runtime state 與 mental model 的差異？

---

# 57. Post-MVP Specialized Visualization

如果 v0.1 驗證有效，再依序考慮：

## v0.2

```text
ListNode runtime adapter
+
linked-list visualization
```

## v0.3

```text
TreeNode runtime adapter
+
tree visualization
```

## v0.4

```text
Graph Node runtime adapter
+
node-edge graph visualization
```

## v0.5

```text
Dedicated 2D DP-table visualization
```

注意：

DP execution 本身在 v0.1 已支援 generic nested-container tracing。

v0.5 指的是：

> DP-specific interpretation and rendering.

## v0.6

```text
Expression-level AST instrumentation
```

例如把：

```python
total = nums[left] + nums[right]
```

拆成：

```text
nums[left] → 2
nums[right] → 15
2 + 15 → 17
total ← 17
```

此功能需要：

* AST transformation
* temporary-value instrumentation
* source mapping
* exception-semantics preservation

因此不屬於 MVP。

## v0.7

```text
user-defined visualization bindings
```

---

# 58. AI Boundary

AI 不在必要 roadmap 中。

除非未來找到一個：

* deterministic approach 不足
* AI 可以明確提升 usability
* 不會破壞 execution truthfulness

的具體使用情境，再另外評估。

目前不需要：

```text
LLM
embedding
agent
RAG
AI classifier
```

---

# 59. Architectural Boundary

最終模組依賴保持：

```text
LeetCode Adapter
      ↓
Execution Request Builder
      ↓
Execution Request
      ↓
Execution Engine
      ↓
Trace Events
      ↓
Trace Session Collector
      ↓
Runtime State
      ↓
State Diff
      ↓
Interpretation
      ↓
Visual Model
      ↓
Renderer
```

Static analysis 旁路：

```text
Source Code
    ↓
AST Analyzer
    ↓
Structural Relations
    ↓
Binding Resolver
```

禁止：

```text
Renderer → LeetCode DOM

Tracer → Side Panel components

LeetCodeAdapter → Pyodide internals

AST Analyzer → Renderer

MAIN-world Bridge → privileged Chrome APIs

Binding Resolver → execution control
```

這些 boundary 讓未來：

```text
LeetCode
→ HackerRank
```

或：

```text
Python
→ JavaScript
```

或：

```text
List Visualizer
→ Tree Visualizer
```

時，不需要重寫整個系統。

---

# 60. Final MVP Principle

第一版的優先順序不是：

```text
更多演算法
更多動畫
更多 heuristic
更多 AI
```

而是：

```text
execution truthfulness
        ↓
stable trace semantics
        ↓
useful state diff
        ↓
minimal interpretation
        ↓
clear visualization
```

如果程式使用目前支援的 Python primitive/container representation：

> 儘量讓它執行、trace、fallback。

只有需要特殊 runtime object 或 dedicated rendering 的部分，才延後到 specialized visualizer roadmap。

因此 v0.1 的核心不是：

> 辨識這是什麼演算法。

而是：

> 忠實呈現這份程式現在正在做什麼。
