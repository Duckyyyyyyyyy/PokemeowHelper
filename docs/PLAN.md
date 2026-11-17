# MeowDex — Kế hoạch Chrome Extension hỗ trợ battle NPC cho PokeMeowRPG

> Trạng thái: **v0.2** (2026-11-17), đã cập nhật kết quả Giai đoạn 0 (mục 0 bên dưới). Các mục ⚠️ ở phần sau vẫn là giả định, trừ khi mục 0 đã xác nhận.
> Mockup UI: [`docs/ui-mockup.html`](ui-mockup.html)

---

## 0. Kết quả Giai đoạn 0 (xác minh, 2026-11-17)

Kiểm tra bằng Chrome đã đăng nhập của bạn. Mình chỉ đọc trang, không bấm hay chơi hộ.

### 0.1 ✅ Dữ liệu NPC: có sẵn, đầy đủ, dạng có cấu trúc
Wiki tải toàn bộ dữ liệu từ **một file JS tĩnh**: `/assets/_pokemon-star-wiki-data-<hash>.js` (~7,8 MB, ES module). File này đổi tên mỗi lần game deploy, nhưng được import từ chunk `wiki-*.js`. Bên trong có:

| Khoá | Số lượng | Nội dung |
|---|---|---|
| `challenges` | 107 | Gym / Elite Four / Champion; format `singles` hoặc `doubles`; `levelCap`, `requirements`, `team[]`, `medicines[]` (thuốc NPC dùng), `rematch{team}` |
| `battleTowers` | 4 | 20 Pokémon Lv100 mỗi tháp, guardian, phần thưởng |
| `frontierBrains` | 6 | Bộ Silver/Gold; mỗi con có **nhiều ability khả dĩ** (`abilities[]`) |
| `megaChambers` | 88 | Nhiều trainer mỗi phòng |
| `rivals` | 36 | Có Pokémon Mega custom (ví dụ Raichu-Mega-Y Lv120) |
| `rocketHideout` | 9 | Grunt/Admin |
| `worldBosses` | 34 | HP 3.000.000, có Max move riêng |
| `species` | 1.363 | Types, baseStats, abilities, **`naturalMoves` (level-up), `machineMoves` (TM), `eggMoves`**, evolutions |
| `moves` | 900 | type, category, power, accuracy, pp, priority, target, mô tả, `tmItem` |
| `abilities` | 316 · `items` 762 · `types` 18 (type chart đầy đủ) |

Mỗi Pokémon của NPC có đủ thông tin để tính damage chính xác:
```js
{ species:74, name:"Geodude", level:12, gender:"M",
  moves:["tackle","defensecurl","rockthrow","rocktomb"],
  ability:"Rock Head", nature:"Hardy", item:null,
  baseStats:{hp:40,atk:80,def:100,spa:30,spd:30,spe:20},
  ivs:{hp:31,...}, evs:{hp:0,...} }
```
**Hệ quả với plan:**
- Không cần `WikiReader` parse DOM. Khi bạn bấm **Đồng bộ**, extension đọc trang `/wiki/` (cần đăng nhập) để tìm tên file dữ liệu, tải file tĩnh đó, **parse như dữ liệu thuần (acorn, không chạy code)**, rồi cache vào IndexedDB. Cache gắn với tên file có hash: nếu game chưa deploy bản mới thì không tải lại.
- Có thể dùng luôn dex của game (species/moves/abilities/type chart) làm nguồn chính, thay cho `@pkmn/dex`. Pokémon custom (id > 1.000.000, Mega, Gmax) đã nằm sẵn trong đó.
- Learnset level-up và TM đã có, nên **gợi ý moveset (F4) làm được ngay từ Giai đoạn 2**.

### 0.2 ✅ Luật: extension chỉ tư vấn không bị cấm rõ ràng
Wiki → Rules: *"Play yourself. Do not use bots or automation to play for you."* Terms (mục 4) cấm thêm *"modified clients"*.

Extension chỉ hiển thị gợi ý, người chơi tự bấm, nên **không chơi thay**. Phần "modified client" vẫn là vùng xám nếu chèn UI vào trang. Vì vậy giữ nguyên các nguyên tắc ở mục 1.2: UI ở side panel, mini HUD mặc định tắt, không bấm hộ. Vẫn khuyến nghị hỏi staff qua *Bugs and Feedback* trước khi phát hành công khai.

### 0.3 🟡 Màn battle: DOM có class rõ nghĩa, chưa xem trận thật
Chunk `BattlePage-*.js` dùng class name ngữ nghĩa, rất thuận lợi cho `BattleReader`:
- **Khung:** `battle-arena`, `battle-turn`, `battle-player-side`, `battle-opponent-side`
- **Chỉ số:** `battle-player-stats`, `battle-opponent-stats`, `double-active-card`
- **Move:** `battle-move-grid`, `battle-move-button`, `battle-move-name`, `battle-move-meta`, `battle-move-pp`
- **Switch:** `battle-switch-card`
- **Sân và log:** `battle-field-status`, `battle-field-effect`, `battle-log-scroll`
- **Đối thủ:** `battle-opponent-roster`, `battle-opponent-unrevealed`, `battle-outcome`
- **Data-attribute:** `data-fainted`, `data-status`, `data-no-pp`, `data-active`

**Còn thiếu:** HTML snapshot của một trận thật, để xác nhận HP hiển thị dạng số hay % và boost hiển thị thế nào. Cũng cần đối chiếu damage thực tế với công thức Gen 9.

### 0.4 Quyết định
- **Giai đoạn 1 và 2: làm được ngay**, dựa trên dữ liệu wiki thật.
- **Giai đoạn 3: khả thi về kỹ thuật.** Cần thêm 1 snapshot trận thật trước khi viết `BattleReader`.
- **Engine:** dùng `@smogon/calc` (Gen 9), nạp stat/moves/ability từ dữ liệu game. Với Pokémon custom thì truyền `overrides` (baseStats, types) cho `Pokemon` của calc.

---

## 1. Những gì đã tìm hiểu được

### 1.1 Về PokeMeowRPG (pokemeowrpg.com)
- Là **web game độc lập** (fan game), chạy trên trình duyệt, viết bằng **React + Vite**. Đây là sản phẩm khác với bot Discord "PokéMeow".
- UI battle dựng bằng **DOM, không dùng canvas**. Bundle có các data-attribute như `data-side`, `data-active`, `data-fainted`, `data-status`, `data-no-pp`, `data-has-item`, `data-format`, `data-ended`.
  → Đọc trạng thái trận đấu thụ động qua DOM là **khả thi** ⚠️ (vẫn cần xem màn battle thật).
- Có chế độ **Singles / Doubles / Triples**, Gym Leaders, Champions, Battle Frontier, Battle Tower, World Boss, Rocket Hideout, Mega Chambers.
- Cơ chế gần với **mainline Gen 8–9**. File `challenge-battle-rules` nhắc tới Wonder Guard, Ability Shield, Perish Body, Trick Room, weather, screens. Bundle cũng có ability, nature, EVs, IVs, held item, crit.
  → Có thể dùng **`@smogon/calc` (Gen 9)** làm lõi tính damage ⚠️. Game có thêm Pokémon custom (id > 1.000.000, ví dụ "Pa'u", "Pom-Pom"), nên cần một lớp override dữ liệu.
- Challenge có **luật riêng**: OHKO, Destiny Bond, Perish Song, Endeavor và Pain Split bị vô hiệu; đòn của đối thủ bỏ qua Wonder Guard. Engine phải hỗ trợ "rule modifiers" theo từng challenge.
- Không thấy WebSocket trong bundle công khai. Battle nhiều khả năng xử lý theo request/response ở server ⚠️.
- **Wiki (`/wiki/#/challenges`) yêu cầu đăng nhập (HTTP 401)**. Mình chưa xem được cấu trúc dữ liệu NPC.

### 1.2 ⚠️ Rủi ro Điều khoản dịch vụ (quan trọng)
Mục 4 của [Terms](https://pokemeowrpg.com/terms) cấm *"bots, scripts, macros, modified clients or other automation to play"*. Terms cũng yêu cầu tuân theo luật ghi trong game và Wiki.

Vì vậy extension phải tuân thủ các nguyên tắc **bắt buộc** sau:
1. **Chỉ tư vấn (advisory-only)**: không bao giờ tự click, tự gửi input hay tự chọn move.
2. **Đọc thụ động**: chỉ quan sát DOM bằng `MutationObserver`. Không patch `fetch`/WebSocket, không sửa code game, không gọi API của game. Ngoại lệ duy nhất: nút **Đồng bộ dữ liệu** tải trang wiki và các file tĩnh mà wiki vốn tải, chỉ khi bạn bấm, không bao giờ tự động.
3. **UI tách khỏi game**: giao diện chính nằm ở **Chrome Side Panel**, không chèn vào trang. Mini HUD trong trang là tuỳ chọn, mặc định tắt.
4. **Không crawl hàng loạt**: dữ liệu NPC đến từ một lần tải file dữ liệu của wiki (~8 MB) khi bạn bấm đồng bộ, rồi được cache cho tới khi game cập nhật.
5. **Nên hỏi admin/staff của game trước** khi làm Giai đoạn 3 (live battle). Kể cả overlay chỉ đọc cũng vẫn là vùng xám.

### 1.3 Các tool/extension tương tự đã tham khảo
Không tìm thấy tool nào dành riêng cho PokeMeowRPG (trong phạm vi tìm kiếm). Các tool gần nhất:

| Tool | Làm gì | Bài học cho MeowDex |
|---|---|---|
| [Showdex](https://github.com/doshidak/showdex) (Showdown, mã nguồn mở) | Nhúng damage calc vào trận, tự đồng bộ forme/HP/status/boost/item/moveset | Mô hình **"calc tự đồng bộ theo battle state"**. Dùng `@smogon/calc`. Đây là reference chính cho tab Battle. |
| [dekzeh/calc](https://github.com/dekzeh/calc) (Run & Bun) | Fork của Smogon calc, **nạp sẵn toàn bộ team trainer** | Mô hình **"dữ liệu NPC định sẵn + calc"**: đúng bài toán Phase 1–2. |
| [PokeRogue Move Effectiveness](https://chromewebstore.google.com/detail/pokerogue-move-effectiven/eddppccaklpaijbchhhilfghgnigflco) | Overlay hiển thị hiệu quả hệ của move trong fan game trên trình duyệt | Ví dụ gần nhất về extension cho **fan game web**, nhưng chỉ dừng ở type chart. |
| [Pokémon Showdown Battle Advisor](https://chromewebstore.google.com/detail/pok%C3%A9mon-showdown-battle-a/jplpafeoapffclcclpoaekblbjaobheb) | Gợi ý move/switch realtime (ML + fallback theo luật) | Ý tưởng **fallback rule-based** khi chưa đủ dữ liệu. |
| [Pokémon Showdown Helper](https://chromewebstore.google.com/detail/pok%C3%A9mon-showdown-helper/omjjmfpdpboofoijkjepfnojlhhkgjgm) | Popup kéo-thả, xem stat + type | Gợi ý cho **mini HUD kéo-thả**. |
| [poke-engine](https://github.com/pmariglia/poke-engine), [PokéChamp](https://arxiv.org/pdf/2503.04094) | Search expectiminimax / agent battle | Hướng nâng cấp engine gợi ý sau MVP. |
| [Gen 4 trainer AI notes](https://gist.github.com/lhearachel/ff61af1f58c84c96592b0b8184dba096) | Cách AI trainer chấm điểm move | Tham khảo để **dự đoán nước đi của NPC**. |

*Lưu ý: thông tin về các tool trên lấy từ trang store và README qua tìm kiếm. Mình chưa cài thử từng cái.*

---

## 2. Mục tiêu sản phẩm

| # | Tính năng | Giai đoạn |
|---|---|---|
| F1 | Duyệt danh sách NPC/challenge: team, level, moveset, luật | 1 |
| F2 | Phân tích điểm yếu của team NPC (type coverage, mối đe doạ chính) | 1 |
| F3 | **Gợi ý đội Pokémon** từ box của người dùng để đánh một NPC | 1–2 |
| F4 | **Gợi ý moveset** (move đang có, học được qua level-up/TM) | 2 |
| F5 | Ma trận damage (mỗi Pokémon của bạn đấu từng Pokémon NPC) | 2 |
| F6 | **Gợi ý move realtime** khi đang battle, kèm dự đoán nước đi NPC | 3 |
| F7 | Doubles/Triples, log trận, tự học AI của NPC từ lịch sử | 4 |

---

## 3. Kiến trúc

```
┌──────────────────── Chrome Extension (Manifest V3) ────────────────────┐
│                                                                         │
│  content script (pokemeowrpg.com)        service worker                 │
│  ┌──────────────────────────┐            ┌──────────────────────────┐   │
│  │ GameAdapter: PokeMeowRPG │──state───▶ │ Store (chrome.storage +  │   │
│  │  • BattleReader (DOM)    │  events    │        IndexedDB)        │   │
│  │  • (sync: nút Đồng bộ)   │            │ Engine (Web Worker)      │   │
│  │  • BoxReader (DOM)       │            │  • calc  (@smogon/calc)  │   │
│  │  • [mini HUD, tuỳ chọn]  │◀─advice──  │  • TeamBuilder           │   │
│  └──────────────────────────┘            │  • MovesetOptimizer      │   │
│                                          │  • TurnAdvisor           │   │
│                                          └────────────┬─────────────┘   │
│                                                       │                 │
│                                   Side Panel UI (Preact) ◀──────────────┘
│                                   tabs: NPC · Team · Battle · ⚙        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Các module

**Đã có (Giai đoạn 1):**
- **`src/data/`**
  - `sync.ts`: tìm và tải file dữ liệu wiki khi bạn bấm nút.
  - `literalParser.ts`: parse bằng acorn, không chạy code.
  - `normalize.ts`: mỗi nguồn NPC một adapter (challenges, towers, frontier, mega, rivals, rocket, world boss), đưa về chung một schema.
  - `db.ts`: IndexedDB.
- **`src/engine/`** (TypeScript thuần, có test)
  - `typeChart.ts`: bảng hệ lấy từ dữ liệu game, cộng các ability miễn nhiễm/giảm sát thương. Chỉ áp dụng khi ability đã chắc chắn.
  - `analysis.ts`: hệ nên đánh, hệ chịu đòn tốt, đòn ưu tiên/setup, thuốc NPC mang.
  - `teamSuggest.ts`: chấm điểm từng cặp đối đầu theo hệ (0–100), chọn đội tham lam, tôn trọng level cap của từng biến thể.
- **`src/ui/`**: side panel bằng Preact + `@preact/signals`. Thanh tab là danh sách `TABS` trong `App.tsx`, mỗi tab một component.
- **`src/shared/types.ts`**: schema dùng chung, có `SCHEMA_VERSION` để tự làm mới cache khi schema đổi.

**Dự kiến (Giai đoạn 2–3):**
- `src/adapters/pokemeowrpg/` gồm `selectors.ts`, `battle.ts`, `box.ts`, chạy trong content script chỉ đọc DOM.
- `engine/calc.ts`: wrapper `@smogon/calc` Gen 9. Stat, moves và ability lấy từ dữ liệu game; Pokémon custom dùng `overrides`.
- `engine/moveset.ts`, `engine/turnAdvisor.ts`, `engine/npcModel.ts`.
- Chuyển engine sang Web Worker nếu tính toán chậm.

### 3.2 Schema dữ liệu NPC (✅ đã cài đặt, xem `src/shared/types.ts`)
```ts
interface Npc {
  id: string;                 // "challenge:brock", "tower:whirl-tower", "mega:..."
  name: string; title: string;
  category: "gym"|"elite-four"|"champion"|"tower"|"frontier"|"mega"|"rival"|"rocket"|"boss";
  group?: string; location?: string; specialty?: string; trainerSprite?: string;
  variants: NpcTeamVariant[]; // "Lần đầu" / "Rematch" / "Silver" / "Gold"...
}
interface NpcTeamVariant {
  label: string; format: "singles"|"doubles";
  team: NpcMon[]; medicines: string[];
  levelCap?: number;          // Rematch: không có cap (theo wiki)
  requirements?: string[]; trainerName?: string;
}
interface NpcMon {
  species: number; name: string; level?: number;
  moves: string[]; ability?: string; possibleAbilities?: string[];
  item?: string|null; nature?: string; baseStats; ivs?; evs?;
}
```

### 3.3 Thuật toán gợi ý move (Phase 3)
Chấm điểm mỗi hành động (4 move + switch) bằng **expectimax 1–2 lượt**:
```
score = P(KO đối thủ) × wKO  + E[damage%] × wDmg
      − P(bị KO trước) × wRisk − (mất lợi thế speed/priority) × wSpeed
      + giá trị setup/status (nếu an toàn)
```
- Thứ tự ra đòn: speed, priority, Trick Room, paralysis.
- Phản đòn của NPC lấy từ `npcModel`, tính theo phân bố xác suất.
- Mỗi gợi ý kèm **lý do ngắn** để người dùng tự quyết.

### 3.4 Tech stack
- **Vite 5 + TypeScript + Preact + @preact/signals.** Manifest viết tay trong `public/manifest.json`, không dùng CRXJS.
- `acorn` để parse dữ liệu, `idb` cho IndexedDB, font Nunito đóng gói kèm (`@fontsource`).
- Quyền: `sidePanel`, `unlimitedStorage`, host `https://pokemeowrpg.com/*`. Không có content script và không có `scripting` ở Giai đoạn 1.
- Giai đoạn 2 trở đi: `@smogon/calc`. Vitest cho engine; adapter sẽ được test bằng HTML snapshot của trang game.

---

## 4. UI — phong cách Pokémon, compact

Xem mockup: **[`docs/ui-mockup.html`](ui-mockup.html)**

- **Bảng màu Pokémon**: vàng `#FFCB05` cho hành động chính và tab đang chọn; xanh navy `#1B3A6B` cho header và thương hiệu; xanh dương `#2A75BB` cho thông tin và lựa chọn; đỏ Pokéball `#E3350D` cho đối thủ và cảnh báo.
- **Phong cách hiện đại, dễ theo dõi**: thẻ trắng bo góc, bóng nhẹ, tab dạng segmented control. Mỗi màn hình đọc từ trên xuống: bối cảnh → kết quả → gợi ý → hành động. Màu trạng thái nhất quán: xanh lá = tốt/KO, vàng = trung bình, đỏ = rủi ro.
- **Chữ**: font **Nunito** cho toàn bộ giao diện, cỡ tối thiểu 11–12px. **Badge 18 hệ** theo màu chuẩn; **thanh HP** bo tròn; icon Pokéball vẽ bằng CSS (không dùng asset có bản quyền).
- Rộng **~340px**, 4 tab:
  1. **NPC**: tìm kiếm, danh sách challenge, team NPC, cảnh báo điểm yếu và luật.
  2. **Team**: đội gợi ý kèm điểm, moveset, ma trận đối đầu, nút khoá slot/tối ưu lại/xuất.
  3. **Battle**: HP hai bên, top 3 hành động có % damage/KO và lý do, dự đoán nước của NPC.
  4. **⚙**: bật/tắt mini HUD, ngôn ngữ, light/dark, import/export dữ liệu.
- **Mini HUD** trong trang (tuỳ chọn): một ô nhỏ kéo-thả, chỉ hiện nước đi #1 cùng hai lựa chọn kế tiếp.
- Mở rộng: thêm tab mới (Doubles, World Boss, Log) chỉ cần đăng ký plugin. Có sẵn token màu cho light/dark.

---

## 5. Lộ trình

### Giai đoạn 0 — Xác minh (1–2 ngày) ⬅ **làm trước tiên**
- [x] Bạn đăng nhập game trong trình duyệt. Mình sẽ xem trang `wiki/#/challenges`: cấu trúc NPC (level, move, ability, item, EV/IV?), số lượng, có phân trang không.
- [x] Đọc luật trong Wiki xem có điều gì về extension/tool hỗ trợ không.
- [~] (Đã có class name; còn thiếu snapshot trận thật) Vào một trận NPC thật: chụp HTML snapshot màn battle, xác định đọc được species/HP/move/PP/boost từ DOM.
- [ ] Đối chiếu damage thực tế với `@smogon/calc` Gen 9 trên vài đòn để xác nhận công thức.
- [ ] (Khuyến nghị) Hỏi staff game về extension chỉ đọc, chỉ tư vấn.
- **Kết quả:** chốt schema dữ liệu, danh sách selector, và quyết định có làm Phase 3 hay không.

### Giai đoạn 1 — MVP: NPC + Type advisor 🟡 (code xong và có test 2026-11-17; chưa chạy thử trong Chrome thật – xem README)
- Khung extension (MV3, side panel, Pokédex theme, hệ thống tab plugin).
- Đồng bộ dữ liệu wiki bằng nút bấm (xem mục 0.1), import/export box JSON.
- Tab NPC: duyệt và tìm kiếm, phân tích điểm yếu theo type chart.
- Tab Team (bản đơn giản): gợi ý theo type coverage từ danh sách Pokémon nhập tay.

### Giai đoạn 2a — Box sync ✅ (code + test 2026-11-17; chưa chạy thử trong Chrome thật)
- Nguồn: `GET /api/collection?egg=false&sort=level&order=desc&limit=30[&cursor=…]`, đúng tham số mà team picker của game dùng. Mỗi Pokémon có species, level, 4 moves, nature, `abilitySlot`, `heldItem`, gender, IVs và EVs.
- Chỉ chạy khi bạn bấm, hoặc tự làm mới khi mở panel (tối đa 1 lần/5 phút, tắt được). Lần đầu luôn phải bấm tay.
- Tải lần lượt từng trang, nghỉ khoảng 0,8 s giữa các trang, tối đa 40 trang. Dừng ngay khi gặp 429 hoặc 401/403, và dừng nếu gặp cursor lặp lại.
- Pokémon đồng bộ thay thế lần đồng bộ trước; Pokémon nhập tay được giữ nguyên.
- Ability thật của bạn được dùng khi tính đòn nhận vào (ví dụ Levitate miễn Ground).
- Luật wiki: *"If the game asks you to wait, let the limit expire instead of repeatedly trying again."* Box sync tuân theo luật này.
- UI chuyển sang tiếng Anh (2026-11-17).

### Giai đoạn 2 — Damage calc + Team/Moveset optimizer (1,5–2 tuần)
- Tích hợp `@smogon/calc`, rule modifiers, override cho Pokémon custom.
- `BoxReader`: đọc box/party của bạn.
- `teamBuilder` và `moveset` (learnset/TM), ma trận damage.

### Giai đoạn 3 — Live battle advisor (2 tuần) — *chỉ làm nếu Giai đoạn 0 cho phép*
- `BattleReader` bằng MutationObserver và state machine theo lượt.
- `turnAdvisor` cùng `npcModel` heuristic; tab Battle và mini HUD (tuỳ chọn).
- Ghi lại các move NPC thực sự dùng, cập nhật dữ liệu (`battle-observed`).

### Giai đoạn 4 — Mở rộng
- Doubles/Triples (đòn đánh nhiều mục tiêu, spread damage), Battle Tower/Frontier.
- Học hành vi NPC từ log, chia sẻ bộ dữ liệu NPC qua file JSON.
- Đóng gói lên Chrome Web Store (nếu staff đồng ý).

---

## 6. Rủi ro & cách giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Vi phạm ToS → bị khoá tài khoản | Chỉ tư vấn, đọc thụ động, UI ở side panel, hỏi staff trước Phase 3 |
| Game đổi UI → selector hỏng | Gom selector một chỗ, test bằng HTML snapshot, báo lỗi rõ trong panel |
| Cơ chế game khác mainline | Đối chiếu damage ở Phase 0, có lớp override và rule modifier |
| Dữ liệu NPC thiếu (ẩn EV/item) | Đánh dấu "chưa biết", dùng giá trị mặc định thận trọng, bổ sung từ quan sát trận |
| Engine chậm khi box lớn | Web Worker, beam search giới hạn, cache kết quả calc |

---

## 7. Cấu trúc thư mục dự kiến
```
PokemeowHelper/
├─ docs/            PLAN.md, ui-mockup.html
├─ src/
│  ├─ manifest.ts
│  ├─ background/   service worker, message bus
│  ├─ content/      entry + adapters/pokemeowrpg/{selectors,battle,wiki,box}.ts
│  ├─ engine/       calc, matchup, teamBuilder, moveset, turnAdvisor, npcModel (worker)
│  ├─ data/         dex overrides, npc store, box store
│  ├─ ui/           sidepanel/ (tabs/, components/, theme.css), hud/
│  └─ shared/       types, i18n, utils
└─ tests/           fixtures/html-snapshots, engine tests
```
