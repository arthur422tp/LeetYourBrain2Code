# Visualization Coverage Expansion: Architecture + Linked List

## Design Spec v0.1

---

# 1. Goal

目前 LeetYourBrain2Code 已經具備：

- live LeetCode editor sync；
- active-tab ownership；
- selected testcase sync；
- bundled Pyodide execution；
- line-level execution trace；
- runtime-state reconstruction；
- scalar/container diff；
- list / tuple visualization；
- dict visualization；
- pointer/index bindings；
- call stack / stdout / exception / timeout trace inspection。

下一階段的核心問題不再是：

> 如何取得並執行目前 LeetCode code？

而是：

> 如何把更多 runtime data structures 與 topology 轉換成可理解的 execution-state visualization？

本 spec 建立一個可持續擴張的 visualization architecture，並以 **Linked List** 作為第一個新增的 structure visualizer。

這次要驗證兩件事：

1. 現有 `RuntimeState -> VisualModel -> Renderer` 邊界能否自然擴張到非 built-in container；
2. runtime object identity / reference topology 能否成為未來 Tree / Graph 等 visualizer 共用的底層能力。

第一階段實際 implementation scope 只做到 Linked List。

---

# 2. Product Principle

本專案維持原本核心原則：

> Visualize what the program actually did.

不做：

> Infer what algorithm the user intended.

因此 Linked List visualization 不依賴：

- LeetCode 題名；
- 題號；
- AI algorithm classification；
- 正確解法；
- AC / WA verdict。

例如：

```text
Reverse Linked List
Add Two Numbers
Linked List Cycle
```

題名本身不影響 visualizer selection。

Visualizer 只根據 execution trace 中觀察到的 runtime object topology、locals references、field mutations 與 current-line relevance 建立 visual state。

---

# 3. Scope

本 spec 包含：

1. visualization model architecture 從 container-only 擴張為 generic visual candidates；
2. stable session-local runtime object identity；
3. user-defined object reference snapshot；
4. object topology capture；
5. object graph reconstruction；
6. object topology diff；
7. Linked List detection；
8. Linked List visual model；
9. Linked List pointer/root semantics；
10. Linked List disconnected components；
11. next-edge reassignment visualization；
12. insertion / deletion / reverse / cycle-safe rendering；
13. visual candidate prioritization；
14. renderer registry / dispatch；
15. compatibility with existing List / Dict visualization；
16. bounded topology capture；
17. performance instrumentation / budget for the new path；
18. tests for serializer, reconstruction, diff, interpretation and renderer。

---

# 4. Explicit Non-Goals

本 spec 不實作：

- Tree visualizer；
- Graph visualizer；
- Stack-specific visualizer；
- Queue-specific visualizer；
- Heap visualizer；
- DP table visualizer；
- expression-level tracing；
- arbitrary Python object inspector；
- generic object graph UI；
- class-name-specific hardcoding for every LeetCode structure；
- AI structure inference；
- AI explanation / correction；
- correctness judgment；
- cross-execution object identity；
- cross-live-revision conceptual node matching；
- dynamic third-party visualizer plugin system；
- force-directed graph layout engine；
- animation timeline beyond existing step navigation / play controls。

Tree / Graph 只影響本次底層 abstraction 的 extension boundary，不在 implementation scope。

---

# 5. Existing Baseline

目前 trace schema 的 `ValueSnapshot` 支援：

```text
int
float
bool
str
none
list
tuple
dict
set
unknown
cycle
```

user-defined object 目前會 fallback 到：

```ts
{
  type: "unknown",
  className: string,
  repr: string
}
```

因此標準 LeetCode：

```python
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
```

在目前 trace 中無法可靠表示：

```text
node identity
node.val
node.next reference
head / curr / prev references
next edge reassignment
```

現有 `cycle.referenceId` 也只表示一次 recursive serialization 中的 cycle reference，不能作為跨 trace step 的 stable node identity。

因此 Linked List 不是單純新增一個 DOM renderer 就能完成；trace representation 必須增加 object identity / topology。

---

# 6. Architecture Direction

目前主要流程：

```text
TraceEvent
    ↓
RuntimeState
    ↓
FrameDiff
    ↓
buildVisualState()
    ↓
ListVisualModel | DictVisualModel
    ↓
TraceVisualizer
    ↓
ListVisualizer / DictVisualizer
```

本 spec 將其演化為：

```text
TraceEvent
    ↓
RuntimeState
    +
ObjectTopologyState
    ↓
FrameDiff
    +
ObjectTopologyDiff
    ↓
Visual Candidate Detection
    ↓
Visual Candidate Selection
    ↓
Visual Model Builders
    ↓
StructureVisualModel[]
    ↓
Visualizer Registry
    ↓
Specialized Renderer
```

共用的是：

```text
runtime capture
identity
references
topology reconstruction
diff
candidate lifecycle
renderer dispatch
```

不共用的是 structure-specific semantics：

```text
Linked List semantics
Tree semantics
General Graph semantics
DP table semantics
```

即使 Linked List / Tree / Graph 在數學上都可表示為 graph，也不建立單一 generic `Graph<Node, Edge>` visual model 強迫所有 structure 共用。

---

# 7. Stable Runtime Object Identity

Linked List visualization 的第一個必要條件是：

> 同一個 Python object 在同一個 execution session 的所有 trace steps 中必須擁有穩定 identity。

例如：

```python
a = ListNode(1)
b = ListNode(2)
a.next = b
```

可以映射為：

```text
obj-1 = a
obj-2 = b
```

之後：

```python
head = b
a.next = None
```

`a` 仍是 `obj-1`，`b` 仍是 `obj-2`。

定義：

$$
\operatorname{ObjectId}_{session}(x)
=
\operatorname{stableToken}(\operatorname{id}(x))
$$

Python `id()` 只在 worker/runtime 內作為 lookup key，不能直接出現在 trace schema 或 UI。

對外只傳 opaque session-local id：

```ts
type ObjectId = string;
```

格式可以是：

```text
obj-1
obj-2
obj-3
```

---

# 8. Object Identity Lifetime

Object identity scope 固定為：

```text
one ExecutionRequest / one TraceSession
```

不跨 live revision 保留。

例如：

```text
revision 120
  obj-1
  obj-2

revision 121
  obj-1
  obj-2
```

這兩個 `obj-1` 沒有任何 identity continuity 保證。

第一版不嘗試判斷：

> revision 120 的 obj-1 是否等價於 revision 121 的 conceptual node。

理由：不同 execution 本身就是重新建立 Python runtime values；跨執行 identity 會產生不可證實的 heuristic matching。

---

# 9. Identity Registry Ownership

stable identity registry 應屬於 `TraceCollector` / per-session tracing context，而不是每次 `ValueSerializer.serialize()` 自己建立。

概念上：

```python
ObjectIdentityRegistry
    python id(value)
        ↓
    obj-N
```

所有該 session 內建立的 serializers 都共享 registry。

因此目前 `_record()` 每次建立新 `ValueSerializer` 的行為可以保留或調整，但 identity registry 必須從 serializer instance lifecycle 中抽離。

Registry 必須在 execution 結束後釋放。

---

# 10. Reference Snapshot

新增 reference value representation：

```ts
export interface ObjectReferenceSnapshot {
  type: "reference";
  objectId: string;
  className: string;
}
```

並將：

```ts
ValueSnapshot
```

擴張為可包含：

```text
primitive/container snapshots
+
object reference snapshots
```

locals 因此可以直接表示：

```text
head -> obj-1
curr -> obj-2
prev -> None
```

例如：

```ts
locals = {
  head: {
    type: "reference",
    objectId: "obj-1",
    className: "ListNode"
  },
  curr: {
    type: "reference",
    objectId: "obj-2",
    className: "ListNode"
  },
  prev: {
    type: "none",
    value: null
  }
}
```

`reference` 表示 identity，不 recursive 展開整個 object。

---

# 11. Object Snapshot

object topology 與 locals reference 分開保存。

概念 schema：

```ts
export interface ObjectSnapshot {
  objectId: string;
  className: string;
  attributes: Record<string, ObjectAttributeSnapshot>;
}

export type ObjectAttributeSnapshot =
  | ValueSnapshot
  | ObjectReferenceSnapshot;
```

例如：

```python
node1.val = 1
node1.next = node2
node2.val = 2
node2.next = None
```

表示為：

```text
obj-1
  className: ListNode
  val: 1
  next: reference(obj-2)

obj-2
  className: ListNode
  val: 2
  next: None
```

object snapshot 不是 recursive nested tree：

```text
obj-1
  next:
    obj-2
      next:
        obj-3
```

而是 normalized identity graph。

---

# 12. Object Topology Model

從 runtime viewpoint：

$$
G_t = (V_t, E_t)
$$

其中：

- $V_t$：step $t$ 可觀察到的 runtime objects；
- $E_t$：object attribute reference edges。

例如：

```text
obj-1.next -> obj-2
obj-2.next -> obj-3
obj-3.next -> None
```

是：

$$
V=\{obj_1,obj_2,obj_3\}
$$

$$
E=\{
(obj_1,next,obj_2),
(obj_2,next,obj_3)
\}
$$

Linked List interpretation 之後才把這個 topology 讀成 linked-list structure。

未來 Tree 可以直接重用 capture：

```text
obj-1.left  -> obj-2
obj-1.right -> obj-3
```

但使用不同 structure interpreter / visual model。

---

# 13. Reachability and Capture Roots

第一版不掃描整個 Python heap。

object capture 必須從 observable roots 開始。

roots：

1. active/user frame locals；
2. return value；
3. traced user-frame locals 中 container 內可達的 reference values，在 configured bounds 內；
4. 必要時 parent user frames 的 locals，依目前 runtime reconstruction contract 保留。

從 roots 做 bounded traversal：

```text
local reference
    ↓
object
    ↓
selected attributes
    ↓
referenced objects
```

不能掃：

```text
gc.get_objects()
```

或任何 whole-runtime heap enumeration。

---

# 14. Object Attribute Capture Policy

第一階段針對 ordinary user-defined objects，只捕捉可安全讀取的 instance attributes。

優先來源：

```python
value.__dict__
```

不主動執行 arbitrary property descriptor / getter。

不得因 visualization 執行使用者自定義 property code，避免 tracer 改變 program behavior。

若 object 無 `__dict__` 或安全 attributes 不可取得：

```text
reference identity 可以保留
attributes 可以為空
```

不把 serializer failure 升級成 user execution failure。

---

# 15. Bounded Object Capture

object topology 必須受 limits 約束。

新增或共用 limits：

```text
max_object_nodes
max_object_attributes
max_object_depth
max_snapshot_bytes
max_session_bytes
```

第一版建議 default：

```text
max_object_nodes      = 200
max_object_attributes = 20 per object
max_object_depth      = 32 traversal edges
```

exact implementation constants 可以在 implementation plan 中依既有 trace limits 調整，但 contract 必須是 bounded。

達到 object capture bound 時：

- execution 不失敗；
- trace step 仍有效；
- topology state 標記 `truncated = true`；
- renderer 顯示部分 structure；
- traversal 必須停止。

session byte limit 仍是最終 hard bound。

---

# 16. Trace Schema Evolution

目前：

```ts
interface TraceEvent {
  ...
  locals: Record<string, ValueSnapshot>;
}
```

新增：

```ts
interface TraceEvent {
  ...
  locals: Record<string, ValueSnapshot>;
  objects?: ObjectSnapshot[];
  objectsTruncated?: boolean;
}
```

`objects` optional，以維持既有 schema consumer 對舊 trace 的兼容。

因 `ValueSnapshot` 增加 `reference` variant，trace schema version 應升版：

```text
TRACE_SCHEMA_VERSION = 2
```

Reader policy：

- v1 trace：照現有 List / Dict path 解讀；
- v2 trace：支援 object references / topology；
- unknown future schema：維持現有 protocol validation policy，不 silent misinterpret。

---

# 17. Object Topology Reconstruction

`RuntimeState` 目前只保存 frame / locals / stack / stdout / exception。

新增 topology state：

```ts
export interface ObjectTopologyState {
  objects: Map<ObjectId, ObjectSnapshot>;
  truncated: boolean;
}
```

可以直接掛入：

```ts
interface RuntimeState {
  ...
  objectTopology: ObjectTopologyState;
}
```

或由 trace interpreter 以 parallel state 保存。

本 spec 建議掛入 `RuntimeState`，原因：

- visual builders 本來就依賴完整 step runtime state；
- locals reference 與 topology 必須在同一 step 可查；
- Tree / Graph 未來也可直接使用。

重建語意：每個 trace event 的 `objects` 是該 step observable topology snapshot，而不是 topology delta。

第一版選擇 snapshot-over-delta，理由：

- correctness 較簡單；
- trace prefix 在 timeout / runtime exception 下仍可獨立解讀；
- state reconstruction 不依賴漏失的 intermediate event；
- limits 已存在。

之後若 profiling 證明 object snapshots 是主要瓶頸，再考慮 topology delta compression。

---

# 18. Object Topology Diff

現有 `FrameDiff` 處理：

```text
variable changes
list/tuple changes
dict changes
set changes
```

Linked List 需要新增 object-level diff。

概念 model：

```ts
export interface ObjectAttributeDiff {
  objectId: string;
  attribute: string;
  kind: "added" | "removed" | "changed";
  before?: ObjectAttributeSnapshot;
  after?: ObjectAttributeSnapshot;
}

export interface ObjectDiff {
  addedObjectIds: string[];
  removedObjectIds: string[];
  attributeChanges: ObjectAttributeDiff[];
}
```

其中：

```python
curr.next = prev
```

會產生：

```text
obj-2.next
obj-3 -> obj-1
```

而：

```python
prev = curr
```

只產生 frame variable reference change：

```text
prev
obj-1 -> obj-2
```

兩者必須分離。

形式上：

$$
\Delta S_t
=
\Delta_{locals,t}
+
\Delta_{containers,t}
+
\Delta_{objects,t}
$$

---

# 19. Object Removal Semantics

`removedObjectIds` 不代表 Python object 已被 garbage collected。

它只代表：

> 該 object 不再出現在目前 bounded observable topology snapshot。

UI 不應顯示：

```text
object destroyed
```

而應在 Linked List semantics 中解釋為：

```text
detached / no longer reachable from current visual roots
```

如果某個 node 仍由 local pointer 指向，即使已從 `head` chain detach，它仍應保留在 topology visualization。

---

# 20. Linked List Detection

第一版不要求 class 必須叫：

```text
ListNode
```

Linked-list node candidate 判定基於 runtime topology。

基本規則：

1. object 有 `next` instance attribute；
2. `next` 為 `None` 或 reference；
3. reference target 為同 class 或至少 topology-compatible object；
4. candidate graph 中每個 node 最多只有一個 outgoing `next` structural edge。

因此：

```python
class Foo:
    def __init__(self, value):
        self.value = value
        self.next = None
```

也可以被辨識。

不依賴 `ListNode` class name。

---

# 21. Linked List Payload Label

structural field 固定優先使用：

```text
next
```

node display payload 不強制只認：

```text
val
```

第一版 label selection：

1. `val`；
2. `value`；
3. `data`；
4. 第一個非-reference primitive attribute；
5. 若沒有，顯示 className / objectId fallback。

這只是 display selection，不是 linked-list detection rule。

若 object 有多個 primitive attributes，可以在 node detail / tooltip-like secondary text 中顯示 bounded subset，但主 node label 保持單一，避免畫面過載。

---

# 22. Linked List Structure Identity

visual structure identity 不能等於 variable name。

例如：

```python
head = obj1
curr = obj2
slow = obj2
```

不能產生三份 linked-list visual。

同一 topology 中的 locals 應成為 pointers：

```text
head
 ↓
[1] -> [2] -> [3]
       ↑
   curr, slow
```

structure candidate identity 應依 topology component / canonical object set 建立，而不是依 root variable name。

第一版 deterministic identity 可以以 component 中排序後的最小 ObjectId 作 canonical key：

```text
linked_list:obj-1
```

但這只是 session / step rendering key，不是跨 revision identity。

---

# 23. Disconnected Components

Linked List visual 不能假設只有一條從 `head` 開始的 chain。

Reverse Linked List 中會自然出現：

```text
prev component

[2] -> [1] -> None

curr component

[3] -> [4] -> None
```

因此 visual model 使用 components：

```ts
export interface LinkedListComponent {
  componentId: string;
  nodeIds: string[];
  entryNodeIds: string[];
}
```

同一 LinkedListVisualModel 可以包含多個 components。

local pointers 決定哪些 component 與哪些 node 對使用者有直接 relevance。

---

# 24. LinkedListVisualModel

第一版 model：

```ts
export interface LinkedListNodeVisual {
  objectId: string;
  className: string;
  label: ValueSnapshot | null;
  nextObjectId: string | null;
  status: "unchanged" | "added" | "changed" | "detached";
  nextStatus: "unchanged" | "changed" | "added" | "removed";
}

export interface LinkedListPointerVisual {
  variableName: string;
  objectId: string | null;
  status: "unchanged" | "moved" | "added" | "removed";
}

export interface LinkedListComponent {
  componentId: string;
  nodeIds: string[];
  entryNodeIds: string[];
}

export interface LinkedListVisualModel {
  kind: "linked_list";
  visualId: string;
  nodes: LinkedListNodeVisual[];
  components: LinkedListComponent[];
  pointers: LinkedListPointerVisual[];
  cyclic: boolean;
  truncated: boolean;
}
```

`nextStatus` 與 node `status` 分開，因 reverse 的核心通常是 edge mutation，而不是 node payload mutation。

---

# 25. Cycle Semantics

Linked List cycle 必須安全支援。

例如：

```text
A -> B -> C
     ^    |
     |____|
```

renderer traversal 不能靠：

```text
follow next until None
```

必須有 visited object ids。

若發現 revisit：

```ts
cyclic = true
```

並畫出 back edge / cycle indication。

這讓 Linked List Cycle 類題型至少能 factual visualization。

本 spec 不額外推論：

```text
slow == fast therefore cycle exists
```

除非 runtime pointers 本身在該 step 指向同一 object；visualizer只顯示 observable state。

---

# 26. Pointer Semantics

任何 active frame local 若值為 reference 且指向 linked-list candidate node，皆可成為 pointer annotation。

例如：

```text
head
curr
prev
slow
fast
dummy
tail
```

名稱沒有 hardcoded semantic requirement。

Renderer 可以顯示：

```text
curr
 ↓
[2]
```

如果多個 variables 指向同一 node：

```text
curr, slow
     ↓
    [2]
```

pointer ordering deterministic：

```text
variable name ascending
```

或沿 locals stable order；implementation 必須選定一種 deterministic ordering 並測試。

---

# 27. Pointer Movement vs Topology Mutation

UI 必須區分：

```python
curr = curr.next
```

與：

```python
curr.next = prev
```

前者：

```text
pointer movement
```

後者：

```text
edge mutation
```

因此：

- pointer movement highlight pointer label / target；
- edge mutation highlight arrow / source node next edge；
- payload mutation highlight node value；
- node creation highlight node body；
- detached node使用 secondary detached state。

不得把所有變化都用同一 generic "changed" border，否則 reverse / splice 題型失去 debugging value。

---

# 28. Reverse Linked List UX

典型步驟：

```python
nxt = curr.next
curr.next = prev
prev = curr
curr = nxt
```

視覺語意依 line-level trace contract仍然是：

> current line is about to execute.

因此 mutation 會在下一個 captured state 中出現。

例如執行 `curr.next = prev` 後下一個 step：

```text
prev
 ↓
[1] -> None
 ^
 |
[2]
 ^
curr
```

`obj-2.next` edge 標記 changed。

接著 `prev = curr` 後：

```text
prev, curr
    ↓
   [2] -> [1] -> None
```

pointer movement / aliasing 可被直接看見。

不新增 post-expression instrumentation。

---

# 29. Insertion UX

例如：

```python
new = ListNode(5)
new.next = curr.next
curr.next = new
```

需要呈現：

1. new node added；
2. `new` local pointer 指向新 node；
3. `new.next` edge added；
4. `curr.next` edge changed；
5. topology 最終變成插入後 chain。

如果新 node 暫時尚未連入主 chain，但由 `new` local 指向：

```text
main component
...

new
 ↓
[5] -> None
```

它仍是 observable component，不應被丟掉。

---

# 30. Deletion / Detach UX

例如：

```python
curr.next = curr.next.next
```

被跳過的 node 若沒有 local/root reference，會從 observable linked-list topology 中消失。

visual diff 可以把前一步存在、下一步不再 observable 的 node標為 detached transition。

第一版 renderer 不需要跨多步 ghost animation；只需要在 diff-aware step rendering 中表達：

```text
edge changed
node detached
```

如果 local：

```python
removed = curr.next
```

仍指向該 node，該 node 必須保留成另一 component，而不是視為消失。

---

# 31. Dummy Head Semantics

常見：

```python
dummy = ListNode(0, head)
```

visualizer 不需要特殊知道 "dummy head" 演算法概念。

它只看到：

```text
dummy -> obj-X
obj-X.next -> head object
```

因此 `dummy` 自然成為 pointer，dummy node 自然成為 topology node。

不做 class / variable-name heuristic：

```text
if variable == "dummy"
```

---

# 32. Visual Candidate Architecture

現有 `selectPrimaryContainers()` 只處理 built-in containers。

擴張為：

```ts
export type VisualCandidate =
  | ContainerVisualCandidate
  | StructureVisualCandidate;
```

概念：

```ts
interface BaseVisualCandidate {
  visualId: string;
  kind: VisualKind;
}
```

candidate detector 只回答：

> 此 step 有哪些可視化結構？

而 candidate resolver 才回答：

> 哪一個應該是 primary / secondary？

---

# 33. Candidate Detectors

第一階段 detector families：

```text
detectContainerCandidates()
detectLinkedListCandidates()
```

未來：

```text
detectTreeCandidates()
detectGraphCandidates()
detectTableCandidates()
```

detector 不 render DOM。

detector input：

```text
RuntimeState
FrameDiff
ObjectDiff
StaticRelations
```

output：

```text
VisualCandidate[]
```

---

# 34. Candidate Prioritization

保留現有 container resolver 的核心哲學，擴張為 structure-neutral priority。

優先依據：

1. current-line relevance；
2. mutation relevance；
3. pointer / binding relevance；
4. local/root relevance；
5. deterministic fallback。

不需要第一版就引入 floating point scoring。

使用 lexicographic tuple：

```text
(
  activeLineRelevant,
  mutated,
  pointerRelevant,
  rootReferenceCount
)
```

descending 比較。

最後 tie breaker：

```text
kind
visualId
```

必須 deterministic，避免 live re-execution 時 panel ordering 抖動。

---

# 35. Current-Line Relevance

container current-line relevance 可繼續依既有 AST relations / binding relations。

Linked List current-line relevance 第一版主要來自：

- object attribute diff observed at current state transition；
- local pointer diff；
- current source line AST 中出現 candidate pointer variable / `.next` attribute access，可視 implementation effort 加入 lightweight static relation；
-若沒有 static object relation，至少 mutation / pointer relevance 已足以排序。

本 spec 不要求建立完整 Python points-to static analysis。

---

# 36. Visible Visual Limit

Side Panel 不應把所有 candidates 全部一次展開。

第一版：

```text
max visible visual models = 3
```

排序後：

```text
primary
secondary 1
secondary 2
```

其餘資訊仍保留在：

```text
Locals
State Changes
Debug details
```

未來可再加入 manual visual selector，不在本 spec scope。

---

# 37. Visual Model Union

現有：

```ts
type ContainerVisualModel =
  | ListVisualModel
  | DictVisualModel;
```

演化為：

```ts
export type StructureVisualModel =
  | ListVisualModel
  | DictVisualModel
  | LinkedListVisualModel;
```

未來自然增加：

```text
TreeVisualModel
GraphVisualModel
SequenceVisualModel
TableVisualModel
```

本 spec 不先定義那些未實作 model fields。

---

# 38. VisualState Evolution

目前存在：

```ts
primaryVisual: ListVisualModel | null;
containerVisuals: ContainerVisualModel[];
```

這兩個欄位帶有早期 list-first architecture 痕跡。

建議演化成：

```ts
interface VisualState {
  ...
  visuals: StructureVisualModel[];
  primaryVisualId: string | null;
  stateChanges: FrameDiff | null;
  objectChanges: ObjectDiff | null;
}
```

render ordering 由 `visuals` 本身 deterministic ordering 表示。

第一筆若與 `primaryVisualId` 一致可作 primary。

migration 過程可暫時保留 legacy fields，但 final implementation 應避免永久同時維護兩套 source of truth。

---

# 39. Renderer Dispatch

目前 `TraceVisualizer` 直接知道：

```text
list -> ListVisualizer
dict -> DictVisualizer
```

若繼續直接增加：

```text
linked_list
tree
graph
dp_table
```

會形成持續增長的 type branching。

新增小型 static renderer registry。

概念：

```ts
interface VisualizerHandle<TModel> {
  element: HTMLElement;
  update(model: TModel): void;
  dispose(): void;
}
```

registry：

```ts
const visualizerRegistry = {
  list: createListVisualizer,
  dict: createDictVisualizer,
  linked_list: createLinkedListVisualizer
};
```

`TraceVisualizer` 只負責：

```text
visualId
kind
lookup renderer
create / reuse / update / dispose
```

不負責 linked-list drawing semantics。

---

# 40. No Dynamic Plugin Platform

第一版不建立：

```text
registerVisualizer()
priority hook system
runtime plugin loading
third-party plugin API
plugin permissions
```

static typed registry 足夠。

目標是：

> establish an internal extension point

不是：

> establish an external extension platform

---

# 41. LinkedListVisualizer Layout

Side Panel width 有限，因此第一版採 **horizontal chain with wrap / component rows**，而不是任意 canvas graph layout。

acyclic component：

```text
head
 ↓
[1] -> [2] -> [3] -> None
       ↑
      curr
```

長 chain 允許 horizontal overflow / controlled wrapping；不得壓縮到 node label 無法閱讀。

多 component：

```text
prev
 ↓
[2] -> [1] -> None

curr
 ↓
[3] -> [4] -> None
```

每個 component 獨立 row / block。

---

# 42. Cycle Layout

cycle 不引入 full graph layout。

第一版使用 deterministic linear traversal 展示第一次訪問順序，再以 cycle edge indicator 指回已存在 node。

例如：

```text
[1] -> [2] -> [3]
       ^       |
       |_______|
```

DOM/SVG implementation 可以使用簡單 overlay / connector，但 layout 必須 deterministic。

如果 layout 技術成本過高，第一版可以用：

```text
[3] --next--> [2] (cycle)
```

明確 back-edge label 作 fallback；不能為了美觀引入大型圖形 library。

---

# 43. Node Rendering

node 最少顯示：

```text
payload label
```

optional secondary：

```text
object id
```

object id 默認不需要作主要視覺資訊，可放在 debug/data attribute，避免 UI 噪音。

狀態呈現：

```text
added      node highlight
changed    payload highlight
detached   subdued / detached indicator
```

edge status：

```text
changed    arrow highlight
added      new arrow highlight
removed    removed-edge indicator if previous target is still representable
```

不要依賴顏色作唯一差異訊號；需配合 border / icon / text / line style，符合 accessibility 基本要求。

---

# 44. State Changes Panel Integration

現有 `State Changes` panel 應保留 generic diff。

Linked List 新增 object changes，例如：

```text
Object changes

obj-2.next
obj-3 -> obj-1

curr
obj-2 -> obj-3
```

UI 可以將 objectId 轉成較友善的：

```text
node(2).next
```

但若 payload label 不唯一，必須避免假裝 label 是 identity。

第一版最安全：

```text
ListNode[2] · next
```

並在內部保留 objectId。

---

# 45. Locals Panel Integration

`formatValue()` 增加 reference formatting。

例如：

```text
head = ListNode@obj-1
curr = ListNode@obj-2
prev = None
```

release UX 可進一步簡化為：

```text
head = ListNode(1)
```

但不能只用 payload value 代表 identity。

Debug details 保留完整 objectId。

---

# 46. Return Value

若 return value 是 user-defined object reference：

```python
return prev
```

terminal result 必須能 serialize 為：

```ts
ObjectReferenceSnapshot
```

且 final topology 必須包含該 return root 可達的 nodes，在 configured bounds 內。

這樣 Reverse Linked List 完成後最後 state 仍可看到 return head。

不能因 method return 後 active frame locals 消失，就完全失去 structure。

因此 terminal trace/result capture 要把 return value 作為 topology root。

---

# 47. Runtime Error / Timeout Semantics

Linked List support 不改既有 partial-trace principle。

如果 Runtime Error：

```text
trace prefix
+
last successfully captured object topology
+
exception
```

仍可 visualization。

如果 hard timeout：

```text
trace prefix before worker termination
```

能顯示到哪一步就顯示到哪一步。

object topology serialization failure 不應把 healthy execution轉成 runtime error；若是 visualization capture limitation，應退化為 truncated / unknown object state。

只有 trace/session hard byte limit 才依既有 trace-limit termination semantics。

---

# 48. Safety / Program Behavior

object topology capture 不得：

- 呼叫 user-defined methods；
- 執行 arbitrary properties；
- 修改 object；
- follow arbitrary descriptor side effects；
- import user-requested packages；
- scan whole runtime heap。

serializer 必須 best-effort observational。

對 `__dict__` 中 attribute value 做 identity/reference snapshot 不應改變 program semantics。

Web Worker / Pyodide 仍不是 hardened malicious-code sandbox；本 spec 不改既有 security boundary。

---

# 49. Performance Strategy

目前產品階段以 visualization coverage 為主，但新增 object topology 後需要量測，避免 coverage expansion 破壞 live feedback loop。

本 spec 不做全面 performance optimization。

做：

```text
instrument
budget
guard against pathological topology
```

不做：

```text
premature topology delta compression
worker protocol binary encoding
renderer virtualization framework
complex memoization
```

除非 measurement 顯示為 blocker。

---

# 50. Performance Budget

作為第一階段 engineering guardrail：

```text
live debounce                 200 ms existing default
visual interpretation p95    < 100 ms for ordinary bounded traces
single step render            < 100 ms
no side-panel main-thread task > 100 ms caused by linked-list rendering
ordinary linked-list trace overhead should not multiply session bytes without bound
```

execution p50 / p95 仍主要受 Pyodide 與 user code 影響，不把本 spec 定成硬 SLA。

需要新增 measurement 至少可分辨：

```text
Python execution / tracing
trace serialization
object topology serialization
TypeScript reconstruction / interpretation
DOM rendering
```

如果 object topology capture 成為主要瓶頸，第一個 optimization priority 是：

1. reduce captured object scope；
2. reduce repeated attributes；
3. only then consider delta encoding。

---

# 51. Compatibility Requirements

新增 Linked List support 後，以下既有 behavior 必須不 regression：

- Two Sum list visualization；
- Binary Search pointer visualization；
- list mutation changed indexes；
- dict entry diff；
- dict membership/subscript probes；
- call stack；
- stdout；
- Runtime Error visualization；
- timeout trace prefix；
- live scheduler latest-wins；
- active-tab ownership；
- testcase case selection。

新增 object support 不得讓普通 list/dict values 全部轉成 generic object graph。

built-in containers 仍使用原本 specialized snapshot path。

---

# 52. Suggested Module Boundaries

具體檔名可在 implementation plan 微調，但責任邊界如下。

## Worker / Python

```text
serializer.py
    primitive/container/reference serialization

object_identity.py or serializer-owned helper
    session-local object identity registry

object_topology.py
    bounded safe object snapshot traversal

tracer.py
    owns session capture context
    emits locals + object snapshots
```

不要求一定新增每個檔案；重要的是 identity registry 不能被 UI concern 污染。

## Shared schema

```text
trace-types.ts
    reference snapshot
    object snapshot
    schema v2
```

## Core

```text
runtime-state.ts
    object topology state

state-reconstructor.ts
    reconstruct objects per step

object-diff.ts
    topology/object attribute diff

visual-candidate.ts
    shared candidate contracts

visual-candidate-resolver.ts
    primary/secondary ordering

linked-list-interpreter.ts
    linked-list detection / components / pointers

visual-model.ts
    model orchestration / shared union
```

現有 `primary-container-resolver.ts` 可以被 generalize / replaced；不應長期同時維護兩個互相衝突的 primary-selection sources。

## Side Panel

```text
components/LinkedListVisualizer.ts
components/visualizer-registry.ts
TraceVisualizer.ts
```

`TraceVisualizer.ts` 只處理 orchestration。

---

# 53. Testing Strategy

測試層級分為：

```text
serializer / worker
protocol/schema
core reconstruction
object diff
structure interpretation
candidate selection
renderer
regression
```

Linked List 不只靠 browser manual test。

---

# 54. Serializer / Worker Tests

至少測：

1. same object across trace events receives stable objectId；
2. different objects receive different objectIds；
3. registry resets between sessions；
4. object local serializes as reference；
5. object snapshot includes safe `__dict__` attributes；
6. `next=None`；
7. `next=reference`；
8. self-cycle；
9. multi-node cycle；
10. max object nodes truncation；
11. max attributes truncation；
12. property getter is not invoked；
13. serializer failure degrades safely；
14. return object is captured as reference/topology root；
15. ordinary built-in containers remain unchanged。

---

# 55. Protocol / Schema Tests

至少測：

```text
schema version 2
reference snapshot validation
object snapshot validation
optional objects field
objectsTruncated
v1 compatibility where supported
malformed object references rejected / handled according to protocol contract
```

不能出現 dangling reference 被 renderer silent 當正常 node。

若 trace 中 reference target 因 truncation 不存在，core 應建立 explicit unresolved/truncated state，而不是 throw。

---

# 56. Reconstruction Tests

至少測：

```text
head -> obj-1
curr -> obj-2

obj-1.next -> obj-2
obj-2.next -> None
```

能重建相同 step topology。

測：

- object added；
- object disappears from observable snapshot；
- next target changes；
- payload changes；
- disconnected fragments；
- cycle；
- truncated topology；
- return-root topology。

---

# 57. Diff Tests

必須明確區分：

## Pointer movement

```python
curr = curr.next
```

expected：

```text
VariableDiff(curr)
no next-edge ObjectAttributeDiff
```

## Edge mutation

```python
curr.next = prev
```

expected：

```text
ObjectAttributeDiff(currObject, "next")
```

## Payload mutation

```python
curr.val += 1
```

expected：

```text
ObjectAttributeDiff(currObject, "val")
```

## New node

```python
new = ListNode(5)
```

expected：

```text
added object
new local reference
```

---

# 58. Linked List Interpretation Tests

至少測：

1. standard `ListNode.val/next`；
2. custom class with `value/next`；
3. custom class with `data/next`；
4. multiple locals alias same node；
5. multiple roots same component；
6. disconnected components；
7. reverse partial state；
8. inserted node before connection；
9. removed node still referenced by local；
10. detached node no longer observable；
11. self-cycle；
12. longer cycle；
13. class with `next` pointing incompatible object should not become invalid infinite list；
14. topology truncation；
15. no `next` attribute => not Linked List candidate。

---

# 59. Candidate Resolver Tests

既有 container priority semantics 要保留並擴張。

Examples：

## Linked List mutation beats unrelated list

```text
nums unchanged
curr.next changed
```

expected primary：

```text
linked_list
```

## Active list pointer beats unchanged Linked List

current line：

```python
value = nums[i]
```

expected：

```text
nums list primary
```

若 static relevance 無法可靠判斷，至少 deterministic mutation / pointer ordering 不得 random。

## Dedup aliases

```text
head -> obj-1
curr -> obj-2
slow -> obj-2
```

expected：

```text
one linked-list candidate
three pointer annotations
```

---

# 60. Renderer Tests

`LinkedListVisualizer` 至少測 DOM semantics：

- nodes in deterministic order；
- arrows / next links；
- None termination；
- pointer labels；
- alias pointer labels；
- multiple components；
- changed edge marker；
- added node marker；
- detached state；
- cycle indicator；
- truncated indicator；
- update reuses handle without stale nodes；
- dispose cleans any listeners / animation resources。

避免 pixel-perfect screenshot tests 作主要 correctness test。

---

# 61. Integration Fixtures

至少增加代表性 execution fixtures：

## Reverse Linked List

```python
class Solution:
    def reverseList(self, head):
        prev = None
        curr = head
        while curr:
            nxt = curr.next
            curr.next = prev
            prev = curr
            curr = nxt
        return prev
```

## Middle / fast-slow pointer

```text
slow
fast
```

驗證 alias / pointer movement。

## Insertion / splice

驗證 new node / edge reassignment。

## Cycle

驗證 traversal bounded / cyclic model。

Fixtures 應測 trace -> interpretation -> visual model，避免只手工建 model。

---

# 62. LeetCode Input Compatibility Boundary

目前 execution request 使用 `ast.literal_eval` 解析 testcase argument lines。

Linked List support若要直接吃 LeetCode `[1,2,3,4]` testcase，execution prelude / argument conversion 必須能將對應 parameter 建立成 ListNode chain。

這是 Linked List feature 的必要 end-to-end boundary。

第一版需要支援 LeetCode standard linked-list parameter conversion，但不能把一般 list parameter全部自動轉成 ListNode。

轉換依據應來自 entrypoint parameter annotation / LeetCode-compatible runtime prelude / resolvable signature metadata，而不是題名。

如果目前 entrypoint resolver 無法取得足夠 type information，implementation plan 必須安排最小的 ListNode argument binding strategy。

---

# 63. LeetCode ListNode Runtime Prelude

本 spec允許在 bundled runtime prelude 提供 LeetCode-compatible：

```python
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
```

但若 user source 自己定義 `ListNode`，不得強制覆蓋 user definition。

目標是重現常見 LeetCode execution contract，不是提供任意 object construction DSL。

list testcase conversion：

```text
[1,2,3]
```

可轉成：

```text
ListNode(1) -> ListNode(2) -> ListNode(3)
```

只在 parameter 被判定為 linked-list node parameter 時進行。

---

# 64. Type Detection for Testcase Conversion

優先順序：

1. parsed method annotation 可辨識 `Optional[ListNode]` / `ListNode`；
2. known LeetCode runtime type annotation syntax；
3.若 annotation unavailable，不做題名 inference。

第一版可以不支援完全沒有 type annotation 且只靠平台 hidden metadata 才知道是 ListNode 的所有題型。

若 page metadata 未提供 signature type，UI 應保留 generic execution/input-error semantics，而不是錯誤把 list 轉成 ListNode。

未來可另開 spec 擴張 LeetCode signature metadata extraction。

---

# 65. Failure / Degradation Modes

## Object identity unavailable

fallback：

```text
unknown snapshot
```

不 crash trace。

## Attribute capture fails

保留 reference + className，attributes empty。

## Topology truncated

顯示部分 structure + truncated indicator。

## Dangling reference caused by bound

顯示 unresolved target marker，不 throw。

## Structure detector uncertain

不建立 LinkedListVisualModel，仍顯示 locals / generic values。

## LinkedList renderer internal failure

TraceVisualizer 不應整體崩潰；至少 fallback 顯示 locals / changes。Implementation 可以用 defensive factory boundary，但不需要複雜 error framework。

---

# 66. Migration Plan Constraints

implementation 應避免 big-bang rewrite。

推薦 migration sequence：

```text
trace schema reference/object support
    ↓
runtime reconstruction + object diff
    ↓
linked-list interpreter
    ↓
generic visual candidate selection
    ↓
renderer registry
    ↓
LinkedListVisualizer
    ↓
end-to-end ListNode testcase support
```

現有 list/dict behavior 每個階段都應保持 tests green。

不先重寫 ListVisualizer / DictVisualizer。

---

# 67. Future Extension Boundary

完成本 spec 後，下一個 Tree spec 應能直接重用：

```text
ObjectId
ObjectReferenceSnapshot
ObjectSnapshot
ObjectTopologyState
ObjectDiff
VisualCandidate
VisualCandidateResolver
Visualizer Registry
```

Tree 只新增：

```text
Tree detection
left/right semantics
TreeVisualModel
TreeVisualizer
```

Graph 同理，但可能需要 container adjacency-list + object node topology 兩種 detection path。

這就是本 spec 判斷 architecture 成功的主要標準之一。

---

# 68. Acceptance Criteria

本 spec implementation 完成時必須滿足：

1. 使用者在 LeetCode Linked List 題中可用目前 live workflow 自動取得 code / testcase；
2. standard `ListNode` input 能建立可執行 local runtime input；
3. trace 中同一 node 在同 session 跨 step identity 穩定；
4. locals 能保存 node references；
5. node `next` topology 能 reconstruction；
6. `curr = curr.next` 被呈現為 pointer movement；
7. `curr.next = prev` 被呈現為 edge mutation；
8. Reverse Linked List 過程可以逐 step 看見已反轉 / 尚未反轉 components；
9. multiple local pointers 可標在相同 node；
10. insertion / detach 可正確呈現；
11. cycle 不造成 infinite traversal / render hang；
12. topology bound 不造成 unbounded trace growth；
13. List / Dict existing visualizers 無 regression；
14. `TraceVisualizer` 不新增 linked-list-specific orchestration branch chain，而透過 registry dispatch；
15. renderer ordering deterministic；
16. `npm test`、`npm run typecheck`、`npm run build` 全部通過。

---

# 69. Success Criteria for the Architecture

這一階段不只看 Linked List 畫面是否能出現。

architecture 成功代表：

```text
Tree support
```

未來不需要重新發明：

```text
object identity
reference serialization
object topology reconstruction
object diff
candidate selection
renderer lifecycle
```

也不需要把 `TraceVisualizer` 重新大改。

如果實作 Linked List 時發現需要把所有 structure logic 塞入：

```text
visual-model.ts
TraceVisualizer.ts
```

則表示本 spec 的 boundaries 沒有被正確落實。

---

# 70. Final Architecture

完成後主要 pipeline：

```text
LeetCode Editor + Testcase
        ↓
LiveExecutionScheduler
        ↓
ExecutionController
        ↓
Pyodide Worker
        ↓
TraceCollector
        │
        ├── frame locals
        ├── stable object references
        └── bounded object topology
        ↓
TraceEvent v2
        ↓
RuntimeState Reconstruction
        │
        ├── FrameState
        └── ObjectTopologyState
        ↓
Diff
        │
        ├── FrameDiff
        └── ObjectDiff
        ↓
Candidate Detection
        │
        ├── containers
        └── linked lists
        ↓
Visual Candidate Resolver
        ↓
Visual Model Builders
        │
        ├── ListVisualModel
        ├── DictVisualModel
        └── LinkedListVisualModel
        ↓
Visualizer Registry
        │
        ├── ListVisualizer
        ├── DictVisualizer
        └── LinkedListVisualizer
        ↓
Chrome Side Panel
```

這個版本的核心產品 loop 維持不變：

```text
Write code
    ↓
Execute latest runnable draft
    ↓
See actual runtime state
    ↓
Inspect topology / pointers / mutations
    ↓
Adjust code
```

Linked List 是 visualization coverage expansion 的第一個 structure family，不是另一套 execution system。
