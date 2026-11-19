# MeowHelper — Kế hoạch Chrome Extension hỗ trợ battle NPC cho PokeMeowRPG

> Trạng thái: **v0.2** (2026-11-17), đã cập nhật kết quả Giai đoạn 0 (mục 0 bên dưới). Các mục ⚠️ ở phần sau vẫn là giả định, trừ khi mục 0 đã xác nhận.
> Mockup UI: [`docs/design/ui-mockup.html`](design/ui-mockup.html)

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

| Tool | Làm gì | Bài học cho MeowHelper |
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

### 3.3 Thuật toán gợi ý move (Phase 3) ✅ expectimax 2–3 lượt (2026-11-19, xem 4d)
Chấm điểm mỗi hành động (4 move + switch) bằng **expectimax 2–3 lượt** (`src/engine/lookahead.ts`):
```
nút quyết định (mình) → move tấn công, move hỗ trợ, đổi Pokémon
nút ngẫu nhiên (NPC)  → nước đáp của NPC: 75% theo npcModel + 25% đòn mạnh nhất (vì npcModel dựa trên ít quan sát)
nút ngẫu nhiên (roll) → mỗi đòn: KO / không KO (16 roll damage, tỉ lệ crit, độ chính xác, tê liệt/rối loạn/đóng băng)
                        + 1 nhánh hiệu ứng phụ (flinch chỉ khi ra đòn trước, trạng thái, rối loạn, hạ chỉ số)
lá                    → projection 1v1 cũ (cùng thang 0–100, 55+ = thắng 1v1)
```
- Thứ tự ra đòn: priority, speed (stage, tê liệt, Scarf); hoà tốc độ tính là địch đi trước.
- Pokémon NPC bị KO → con tiếp theo theo thứ tự đội vào sân (buff của mình còn nguyên: "set up rồi quét"). Pokémon mình ngất → con tốt nhất trên bench vào miễn phí ("chip trước để con sau KO"), điểm bị chặn < 55.
- Mỗi gợi ý kèm **lý do ngắn** + **đường đi** (vd. "Swords Dance → Brick Break KOs both remaining").
- Đường rẻ (`lookahead: 0`): projection 1 lượt cũ — dùng cho Explore (Defeat it) và bộ đếm "guess right"; tab Team vẫn dùng `duel`/`rateSupport`.

### 3.4 Tech stack
- **Vite 5 + TypeScript + Preact + @preact/signals.** Manifest viết tay trong `public/manifest.json`, không dùng CRXJS.
- `acorn` để parse dữ liệu, `idb` cho IndexedDB, font Nunito đóng gói kèm (`@fontsource`).
- Quyền: `sidePanel`, `unlimitedStorage`, host `https://pokemeowrpg.com/*`. Không có content script và không có `scripting` ở Giai đoạn 1.
- Giai đoạn 2 trở đi: `@smogon/calc`. Vitest cho engine; adapter sẽ được test bằng HTML snapshot của trang game.

---

## 4. UI — phong cách Pokémon, compact

Xem mockup: **[`docs/design/ui-mockup.html`](design/ui-mockup.html)**

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
- [x] (Đã xem trận Brock thật 2026-11-18, xem 3a) Vào một trận NPC thật: chụp HTML snapshot màn battle, xác định đọc được species/HP/move/PP/boost từ DOM.
- [x] Đối chiếu damage thực tế với `@smogon/calc` Gen 9 trên vài đòn để xác nhận công thức (xem 3b: Brock 1/1, Juan 4/4 → sau đó 6/6 trong khoảng).
- [ ] (Khuyến nghị) Hỏi staff game về extension chỉ đọc, chỉ tư vấn.
- **Kết quả:** chốt schema dữ liệu, danh sách selector, và quyết định có làm Phase 3 hay không.

### Giai đoạn 1 — MVP: NPC + Type advisor ✅ (đã chạy thử trong Chrome thật 2026-11-17)
- Khung extension (MV3, side panel, Pokédex theme, hệ thống tab plugin).
- Đồng bộ dữ liệu wiki bằng nút bấm (xem mục 0.1), import/export box JSON.
- Tab NPC: duyệt và tìm kiếm, phân tích điểm yếu theo type chart.
- Tab Team (bản đơn giản): gợi ý theo type coverage từ danh sách Pokémon nhập tay.

### Giai đoạn 2b — Damage calc ✅ (code + test 2026-11-18; chưa chạy thử trong Chrome thật)
- Công thức chỉ số **đã xác minh** với game: Timburr Lv16 Modest có IV/EV lấy từ box API cho ra 51/30/24/17/20/20, đúng như bảng chỉ số trong game.
- `engine/damage.ts`: dùng `@smogon/calc` 0.12 (Gen 9). baseStats/types của species và power/type/category của move luôn lấy từ dữ liệu game. Species không có trong dex của calc thì dùng placeholder kèm overrides.
- Duel 1v1: mỗi bên dùng đòn mạnh nhất mỗi lượt; speed, priority và Choice Scarf quyết định ai đánh trước. Điểm: thắng = 55–100 theo HP còn lại, thua = 0–45 theo sát thương gây ra.
- `engine/moveset.ts`: gợi ý 4 đòn gây sát thương tốt nhất từ đòn đang biết, đòn level-up ≤ level hiện tại, và TM.
- Giả định còn lại: chưa đối chiếu damage thực tế trong trận (sẽ làm ở Giai đoạn 3 bằng battle log). Frontier Brain không có level: Lv 50, hoặc ở Open Level = cấp cao nhất bạn đăng ký (tối thiểu 60) — xem 4d.

### Giai đoạn 2a — Box sync ✅ (đã chạy thử trong Chrome thật 2026-11-17: 71 Pokémon, 3 trang)
- Nguồn: `GET /api/collection?egg=false&sort=level&order=desc&limit=30[&cursor=…]`, đúng tham số mà team picker của game dùng. Mỗi Pokémon có species, level, 4 moves, nature, `abilitySlot`, `heldItem`, gender, IVs và EVs.
- Chỉ chạy khi bạn bấm, hoặc tự làm mới khi mở panel (tối đa 1 lần/5 phút, tắt được). Lần đầu luôn phải bấm tay.
- Tải lần lượt từng trang, nghỉ khoảng 0,8 s giữa các trang, tối đa 40 trang. Dừng ngay khi gặp 429 hoặc 401/403, và dừng nếu gặp cursor lặp lại.
- Pokémon đồng bộ thay thế lần đồng bộ trước; Pokémon nhập tay được giữ nguyên.
- Ability thật của bạn được dùng khi tính đòn nhận vào (ví dụ Levitate miễn Ground).
- Luật wiki: *"If the game asks you to wait, let the limit expire instead of repeatedly trying again."* Box sync tuân theo luật này.
- UI chuyển sang tiếng Anh (2026-11-17).

### Giai đoạn 2c — Luật challenge + điều khiển đội ✅ (code + test 2026-11-18; chưa chạy thử trong Chrome thật)
- `engine/rules.ts`: OHKO (Fissure, Guillotine, Horn Drill, Sheer Cold), Destiny Bond, Perish Song, Endeavor, Pain Split bị loại khỏi duel và gợi ý move; đòn của NPC bỏ qua Wonder Guard (cả damage calc lẫn điểm theo hệ).
- ⚠️ Giả định: luật này chỉ áp dụng cho Gym, Elite Four, Champion (NPC từ khoá `challenges`). Luật không có trong file dữ liệu wiki nên được viết cứng. Tower, Rival, Boss… dùng luật thường.
- Các move bị cấm vốn đã ra 0 damage trong calc, nên luật chỉ thật sự đổi kết quả với Wonder Guard (ví dụ Shedinja).
- Tab Team: 🔓 khoá Pokémon vào đội (lock đi trước, greedy lấp phần còn lại, không vượt level cap), ✕ loại Pokémon, bấm tên ở Bench để khoá, nút Reset, **Copy team** (văn bản kiểu Showdown, có ô copy tay nếu clipboard bị chặn). Lưu trong `localStorage` theo `uid` (`game:<id>` không đổi qua các lần sync).

### Giai đoạn 2 — Damage calc + Team/Moveset optimizer ✅ (xong phần code; chờ chạy thử trong Chrome thật)
- [x] Tích hợp `@smogon/calc`, rule modifiers, override cho Pokémon custom.
- [x] `BoxReader`: đọc box của bạn (qua API collection, xem 2a).
- [x] `teamBuilder` và `moveset` (learnset/TM), ma trận damage, khoá/loại slot, xuất đội.

### Giai đoạn 3a — Battle reader + gợi ý theo lượt ✅ (đã chạy thử trong Chrome thật 2026-11-18, trận Brock)
- Bạn chọn: làm để dùng cá nhân trước, hỏi staff trước khi phát hành công khai. Không có HUD trong trang; gợi ý chỉ nằm ở side panel.
- **Đã xem màn battle thật** (Brock, 6 lượt, bạn tự chơi, mình chỉ đọc):
  - HP hiện **số thật** cả hai bên (`.battle-hp-numbers` "43/43 HP"), level, held item (aria-label), status (`[data-status="par"]` trong `.battle-status-par`).
  - Move: aria-label của `.battle-move-button` có đủ "Tên · Hệ · Loại · Power · Accuracy · PP".
  - Switch: aria-label "Switch to Timburr, level 16, 51 of 51 HP"; `data-fainted` trên `.battle-switch-card`.
  - Đội đối thủ: `.battle-opponent-roster li` có `data-active`/`data-fainted`, HP từng con (cả con chưa ra sân).
  - Kết thúc: `.battle-arena[data-status="won"]`. URL vẫn là `/` (SPA) nên nhận diện bằng `.battle-arena`.
  - **Boost không hiện trên màn hình**, chỉ có trong log: "Your Timburr's Defense fell harshly!", "Your Turtwig's Speed fell!". Reader dựng lại stat stage từ log, reset khi đổi Pokémon ("Go, X!" / "sent out X!").
  - Log có damage thật: "It dealt 12 damage." Rock Tomb của Onix Lv14 lên Turtwig Lv14 = 12, nằm trong khoảng calc (9–12 với IV 31). Có test.
- `src/content/battleReader.ts` (selector gom ở `SEL`), `src/content/index.ts` (MutationObserver, debounce 300 ms, ghi snapshot vào `chrome.storage.local`; không click, không sửa trang, không gọi API). Quyền mới: `storage` + `content_scripts`.
- `src/engine/turnAdvisor.ts`: tìm NPC + variant theo tên và roster; ghép Pokémon của bạn với box (species + move trùng). Mỗi move và mỗi switch được chấm 0–100 bằng dự đoán 1v1 từ HP/status/stage hiện tại. Switch phải nhận một đòn miễn phí trước.
- Kiểm tra trên trận thật: bản đầu đọc thiếu Pokémon đang ra sân và đọc tên trong roster thành "Male" (tên nằm trong phần tử con, cạnh nhãn giới tính). Đã sửa bằng `monName()`; tab Battle chạy đúng trong Chrome của bạn.
- ⚠️ Fixture test `tests/fixtures/battle/brock-turn3.reconstructed.html` là **bản dựng lại** từ cấu trúc đã đọc (công cụ trình duyệt không cho lấy HTML thô). Nên thay bằng trang lưu thật (Ctrl+S) khi có dịp.
- Chưa làm: Doubles, dự đoán NPC đổi Pokémon, crit, hiệu ứng phụ, expectimax nhiều lượt, so sánh damage thật với calc ngay trong panel.

### Giai đoạn 3b — Log trận: kiểm tra calc + đoán nước NPC ✅ (đã chạy thử trong Chrome thật 2026-11-18, trận Juan)
- Reader đọc **toàn bộ log** thành sự kiện (snapshot `v: 2`): ai dùng move gì, lên ai, lượt nào, damage bao nhiêu, trượt, KO, và stat stage ngay lúc ra đòn. Chỉ parse câu đã thấy trong trận thật; câu lạ (crit, multi-hit, recoil…) được đánh dấu và bỏ qua.
- **Calc check** (`engine/damageCheck.ts`): mỗi đòn mới trong log được so với khoảng damage của calc, dùng snapshot *trước* đòn đó (level/HP đổi trong trận). Chỉ chấm khi biết chính xác set cả hai bên. Nếu max HP trên màn hình khác calc thì ghi "set mismatch" (IV/EV/level lệch), không tính là sai công thức. Đòn KO chỉ cần ≤ max của calc (game cắt theo HP còn lại).
  - Dữ liệu thật: Turtwig 41 HP ở Lv14 → IV HP 12–18 theo công thức; Rock Tomb của Onix = 12 nằm trong khoảng calc. Có test.
- **Đoán nước NPC** (`engine/npcModel.ts`): xác suất cho từng move (đòn mạnh/KO được ưu tiên, status vô ích bị bỏ, move đã dùng trong trận được cộng nhẹ). Chỉ hiển thị như *đoán*; cảnh báo KO và điểm vẫn dùng đòn mạnh nhất (trường hợp xấu nhất). Panel đếm số lần đoán đúng trong trận.
- Đối thủ có set đoán (không có trong wiki): move thấy trong log được dùng trước.
- **Chạy thử trực tiếp 2026-11-18 (Juan, Hoenn Gym)**, bạn chơi, mình đọc trang song song:
  - Calc check **4/4 trong khoảng**: Earthquake → Electivire 102 (calc 102–120, x2), Earthquake → Toedscruel 36 (30–36, kháng), Seed Bomb → Kingdra 21 (18–22, kháng x4), Thunder Punch → Luvdisc 98 (KO, bị cắt). Công thức damage của game = Gen 9.
  - Đoán nước NPC đúng 1/1 (Earthquake 54%).
  - **NPC có đổi Pokémon**: Juan rút Whiscash (yếu x4 trước Grass) khi Toedscruel vào sân, đưa Kingdra ra. Bằng chứng đầu tiên cho việc dự đoán NPC đổi Pokémon (chưa làm).
  - Lỗi tìm thấy và đã sửa: Self-Destruct/Explosion được coi như dùng lặp lại được ("wins the 1v1"). Giờ các move tự hạ gục không tính vào dự đoán 1v1 và gợi ý moveset.
- Hoãn (đã làm ở 3c, trừ Doubles): lưu move NPC đã dùng qua nhiều trận, dự đoán NPC đổi Pokémon, Doubles.

### Giai đoạn 3c — Move NPC đã thấy qua nhiều trận + accuracy/evasion + đoán NPC đổi Pokémon ✅ (code + test 2026-11-18; chưa chạy thử qua 2 trận thật)
- **`battle-observed`** (`engine/observed.ts`): move mà Pokémon NPC thật sự dùng được lưu trong `chrome.storage.local` (key `mdObserved`), **tách khỏi dữ liệu wiki** (sync wiki không xoá). Khoá = NPC id + variant (lần đầu/rematch tách riêng) + tên Pokémon + level; trainer không có trong wiki thì khoá theo tên + loại trận.
  - Ghi **idempotent**: chỉ lưu tập move id, đọc lại cùng snapshot không đổi gì. Bỏ Struggle; Pokémon có Metronome/Sleep Talk/Copycat… chỉ ghi move có trong set (log hiện move được gọi).
  - Set wiki **không bị ghi đè**: move thấy trong trận mà wiki không có được thêm vào danh sách đòn nguy hiểm, kèm ghi chú. Set đoán (không có trong wiki): move đã thấy được dùng trước.
  - Hiển thị: tab NPC ("Seen in battle", move lạ tô đỏ "not in wiki"), tab Battle ("Seen in earlier battles"), ⚙ có nút Forget. Giới hạn 600 Pokémon, bỏ cái cũ nhất.
  - Giới hạn: panel ghi lại, nên chỉ ghi được trận mà panel đang mở (đọc 80 sự kiện cuối của log). Content script vẫn chỉ đọc trang, không đổi.
- **Accuracy/evasion stage** (Gen 5+: (3+n)/3 hoặc 3/(3−n), n = accuracy mình − evasion họ, giới hạn ±6): nhân vào damage kỳ vọng của move bạn khi xếp hạng (ví dụ Kingdra Evasion +1 → ~75% trúng). Move không bao giờ trượt không bị ảnh hưởng. Đòn mạnh nhất của NPC và cảnh báo KO không đổi (trường hợp xấu nhất).
- **Đoán NPC đổi Pokémon** (`guessNpcSwitch`): chỉ khi Pokémon của NPC bị bạn KO được, không KO được bạn, và có đồng đội còn khoẻ nhận đòn mạnh nhất của bạn < 45%. Chỉ hiển thị "May switch to X (guess)", không đổi điểm. Dựa trên 1 lần quan sát (Juan rút Whiscash).

- **Chạy thử trực tiếp 2026-11-18 (Lt. Surge, 2 trận liên tiếp)**:
  - ✅ Trận 1 ghi được Voltorb: Screech, Tackle; tab NPC hiện "Seen in battle". Trận 2 (sau khi reload extension) tab Battle hiện "Seen in earlier battles: Screech, Tackle" → **lưu qua nhiều trận chạy đúng**.
  - ✅ Calc check: Giga Drain của Gloom Lv28 lên Voltorb = 51 (calc 89–106% của 54 HP = 48–57).
  - Lỗi 1: badge stat stage dạng **viết tắt "Def -2"** (Kingdra trước đó là "Evasion +1") bị đọc thành "không đổi" và còn đè lên stage dựng từ log. Đã sửa: hiểu Atk/Def/SpA/SpD/Spe/Acc/Eva; badge không đọc được thì dùng stage từ log.
  - Lỗi 2: **game đổi câu chữ log giữa hai trận**: "Opponent’s Voltorb used…" → "**Lt. Surge’s** Voltorb used…", "Your Gloom used…" → "Gloom used…" (không tiền tố). Reader cũ mất hết sự kiện (không ghi move, không calc check). Đã sửa: hiểu cả hai kiểu; tên trainer lấy từ tiêu đề trận; tên trần chỉ được nhận khi trùng Pokémon đang ra sân (tránh đọc nhầm "Lt. Surge used Super Potion").
  - Quan sát AI: **4/4 lần, đòn đầu tiên của Pokémon NPC khi ra sân là status move** (Geodude Defense Curl, Onix Screech, Voltorb Screech ×2 trận, Raichu Thunder Wave), và **status move không lặp lại** (Onix Screech 1 lần rồi Rock Tomb ×3). `npcModel`: status hữu ích ×3 ở đòn đầu, status đã dùng giảm ½ mỗi lần. Đoán đúng Screech (46%) ở trận 2.
  - **Trận 3 (sau khi reload với reader mới)**: ✅ đọc đúng cả 16 move theo câu chữ mới (đúng phe, KO, 2 lần trượt ở Evasion +1/+2), badge "Def -2" và "Eva +1/+2", tê liệt ("couldn't move" không tính là move). Đoán đúng 5/8.
  - Quan sát AI trận 3: Voltorb Screech → Spark; Raichu **Quick Attack** (đòn đầu là đòn đánh — ngoại lệ, tổng 7/8 status-trước) → Thunder Wave → Double Team ×2 → Electro Ball; Pikachu Double Team ×2 → Quick Attack. ⇒ **move tự tăng chỉ số (Double Team…) có lặp lại**, còn status lên bạn (Screech, Thunder Wave) thì không. `npcModel`: move tự tăng giảm ×0.8 mỗi lần dùng (thay vì ½), ≈0 khi chỉ số đó đã +6.

### Giai đoạn 3 — Live battle advisor — ✅ xong phần chính (3a + 3b + 3c)
- [x] `BattleReader` bằng MutationObserver (3a). Không cần state machine riêng: log được parse thành sự kiện theo lượt (3b).
- [x] `turnAdvisor` cùng `npcModel` heuristic, tab Battle (3a, 3b). Mini HUD: **không làm** (bạn chọn chỉ dùng side panel).
- [x] Ghi lại các move NPC thực sự dùng (`battle-observed`, 3c).
- Đã làm (4a, 4d, 4b, 4e): chấm điểm status move, expectimax 2–3 lượt (mục 3.3), crit và hiệu ứng phụ, Doubles (4b), Battle Frontier/Tower (4e).

### Giai đoạn 4 — Mở rộng
- ✅ 2026-11-18: admin game đồng ý cho dùng/chia sẻ, **với điều kiện không có automation**. Đổi tên MeowDex → **MeowHelper** (0.5.0); `npm run package` tạo zip để chia sẻ.
- Học hành vi NPC từ log, chia sẻ bộ dữ liệu NPC qua file JSON. Battle Tower/Frontier.
- Chrome Web Store (phí 5 USD, cần privacy policy) khi muốn cài 1 click + tự cập nhật.

#### 4-pre — Góp ý của bạn chơi thử (2026-11-18)
- ✅ **Move advice theo level**: chia 3 bước — *Ready now* (move đã biết + level-up ≤ level hiện tại), *By Lv cap* (thêm move level-up học được trước level cap; không có cap thì tới Lv 100), *With TMs*. Bước sau chỉ hiện khi tốt hơn rõ (≥ 3 điểm). Damage luôn tính ở level hiện tại. Chưa biết: học lại move level-up cũ có tốn gì không trong game này.
- ✅ **Destiny Bond** (bạn chơi thử thấy NPC dùng đúng lúc đòn tiếp theo sẽ KO nó; nguồn 1 người, chưa tự thấy): ngoài League challenge (luật cấm DB), nếu NPC biết DB và **đi trước** → move KO bị hạ điểm (≤ 45) + gợi ý "bait": dùng move không KO hoặc đổi Pokémon 1 lượt. Nếu mình đi trước → KO an toàn. Ngay sau khi nó dùng DB: mình đi trước → KO thì chết chung (≤ 30); nó đi trước → DB hết, dùng lại liên tiếp sẽ fail (luật main game từ Gen 7, chưa kiểm chứng trong game). `npcModel`: DB rất có khả năng khi đòn mạnh nhất của mình KO được nó, ≈0 ngay sau khi vừa dùng.
- ✅ **Túi đồ** (0.6.0): game không có request riêng cho Bag (dữ liệu nằm trong `/api/state` lúc tải trang; gọi API đó bị chặn và không cần), nên content script **đọc màn Bag** khi bạn mở nó: `section.bag-page-panel[aria-labelledby=bag-<pocket>-title]` → `li.bag-page-item` → `[data-favorite-item]` (id, vd. `tmgigadrain`, `potion`) + `.bag-page-item-count` ("×10"). Không đọc khi ô tìm kiếm đang lọc; chỉ thay các túi đang hiện. Kiểm tra trực tiếp: 7 túi khớp số "N kinds" của game (28/3/8/36/11/14/54). Lưu `chrome.storage.local` "mdBag".
- ✅ **Move advice chỉ dùng TM có trong túi** (khi đã đọc túi).
- ✅ **Gợi ý đồ cầm** (`engine/heldItems.ts`): item calc mô phỏng được (Gem, đồ tăng hệ, Choice/Life Orb…) → chấm lại điểm 1v1 trung bình với cả đội NPC; **Gem chỉ tăng đòn đầu** (sửa trong `duel`); chỉ thử Gem/đồ tăng hệ khi Pokémon có move hệ đó. Item khác: luật kinh nghiệm (berry chữa trạng thái vs status move của NPC, Wide Lens/Blunder Policy cho move kém chính xác, Light Clay khi có màn, Throat Spray, Adrenaline Orb vs Intimidate, Mirror Herb vs move tự tăng, Mental Herb vs Taunt/Encore, Kee/Maranga theo kiểu đòn của NPC, Salac/Custap khi chậm hơn, berry hồi máu). Mỗi Pokémon 1 món, không vượt số lượng có.
- ✅ **Dùng item trong trận** (xem trực tiếp 2026-11-18, trận Gym Lt. Surge): màn trận có tab **Team | Items** (`.battle-team-bag-panel` → `.battle-bag`, lọc All/Medicine/Berries, 2 trang). Ghi chú của game: "Choose an item, then its target. Uses one turn." Item không ai cần thì bị khoá ("No team member needs this item"). Có Potion/Super Potion/Revive/Max Revive/Ether/Full Heal → **được dùng cả trong Gym**. `turnAdvisor` thêm dòng 🎒: Potion khi HP < 75% (chọn loại nhỏ nhất lấp ≥ 80% phần thiếu), thuốc chữa trạng thái, Revive/Max Revive cho Pokémon đã ngất làm tốt nhất (trừ 25 điểm vì cần 2 lượt). Mỗi cái được chấm sau khi ăn 1 đòn miễn phí. Lượng HP theo main game (Potion 20, Super 60, Hyper 120), chưa kiểm chứng.
- ✅ **Item trong trận, bản 2** (`src/engine/itemAdvisor.ts`, hook nhỏ trong `turnAdvisor`): (1) đọc số lượng item thẳng từ panel Items của màn trận (`readBattleBag`, chỉ đọc phần đang hiển thị, không bấm trang/lọc); số trong trận ưu tiên hơn lần đọc Bag cuối, item game khoá ("No team member needs this item"/disabled) thì không gợi ý. Markup từng item chưa chụp được nên fixture là bản dựng lại (`battle-items-panel.reconstructed.html`), reader đọc khoan dung (tên + "×N" + disabled). (2) Ether/Max Ether/Elixir/Max Elixir: gợi ý khi chiêu "chủ lực" (tốt nhất hoặc gần như duy nhất, đòn kế tiếp < 70% sát thương, với Pokémon đang đấu hoặc sắp tới) hết PP (điểm = thua 1 lượt rồi đánh) hoặc còn 1–2 PP (bị trừ điểm, xếp dưới việc tấn công). (3) Berry trong Bag (Oran 10, Sitrus 1/4, Cheri/Chesto/Pecha/Rawst/Aspear, Lum) bị tiêu mất vĩnh viễn nên ưu tiên potion/thuốc; chỉ dùng berry khi hết potion hoặc berry hồi nhiều hơn rõ rệt; Lum chỉ là lựa chọn cuối; không gợi ý berry mà Pokémon đang cầm. (4) Không dùng thuốc trong Battle Tower và Player Battle (`rules.bagItems` + `kind` chứa player/pvp). Chưa kiểm chứng trực tiếp trên Chrome thật (không có trận đang mở).
- ✅ **Tra wiki của game (2026-11-18)** — sửa 3 giả định sai (0.6.1):
  - **Luật đặc biệt** (OHKO, Destiny Bond, Perish Song, Endeavor, Pain Split thất bại; đòn đối thủ xuyên Wonder Guard) áp dụng cho **World Boss và Mega Chamber**, và chỉ với **move của bạn** — không phải Gym/E4/Champion như giả định cũ. NPC trong Gym vẫn dùng được Destiny Bond (khớp với điều bạn chơi thử thấy).
  - Mô tả Destiny Bond của game: "Fails if the user used this move successfully as its last move" → luật "không dùng 2 lần liên tiếp" đã xác nhận.
  - **Học move**: vượt qua level của move khi đang sở hữu → 1 lần học miễn phí; move level-up đã qua chỉ có nếu lần học đó chưa dùng, hoặc **Re-learn** tốn phí (vd. Heart Scale); Pokémon mới bắt không được học bù các level đã có; move lúc nở trứng học lại miễn phí. → Move advice: *Ready now* = move đang biết; *Re-learn*; *By Lv cap* (miễn phí); *With TMs in your bag*.
  - **Thuốc**: Potion 20, Super 60, Hyper 120, Moomoo Milk 100, Max Potion/Full Restore đầy; Revive nửa máu, Max Revive đầy (không có trong Hardcore); berry dùng từ túi trong trận (Oran 10 HP, Sitrus 1/4, Lum/Cheri/Chesto/Pecha/Rawst/Aspear chữa trạng thái) bị mất vĩnh viễn, còn **berry đang cầm được trả lại sau trận**.
  - **Không được dùng thuốc trong Player Battles và Battle Towers**; ở Rocket’s Hideout và Battle Towers HP/trạng thái/PP giữ nguyên giữa các đối thủ. Battle Frontier dùng luật Gen III (đã mô phỏng, xem 4d). Lưu ý: Battle Frontier Tower hồi đầy giữa các trận; chỉ Battle Towers (Johto/Unova) giữ HP suốt 20 con.
- ✅ **Worth grinding — Pokémon level thấp đáng luyện** (`engine/potential.ts`, card dưới "Suggested team · ready now" ở tab Team). Bạn chơi thử thấy Snorlax/Slowbro/Pikachu/Charizard được dùng với rất nhiều NPC, nhưng gợi ý cũ chấm ở level hiện tại nên con level thấp không bao giờ lên. Cách tính: luyện tới **level cap** (không có cap → level cao nhất của team NPC), stats tính lại từ base stats + **IV/EV/nature thật** (cùng calc, test bằng công thức tay), moveset tốt nhất có được tới lúc đó (move đang biết + move level-up **vượt qua** trên đường đi — move đã qua không tính, theo luật học move của wiki; TM chỉ khi đã đọc túi và có TM đó), rồi chấm bằng scorer 1v1 như đội ready now. Chỉ hiện con dưới level mục tiêu, mỗi loài 1 con (IV tốt nhất), và chỉ khi điểm tiềm năng hơn con yếu nhất trong đội hoặc là câu trả lời tốt nhất cho một Pokémon NPC. Hiện: điểm bây giờ → tiềm năng, số level cần, tóm tắt IV, moveset kèm level học, lý do ngắn, và **Versatility** (tỉ lệ thắng 1v1 trung bình trên cả danh sách NPC, mỗi NPC luyện tới level của nó; ~0,5 ms/Pokémon NPC nên tính dần sau khi vẽ, có cache).
  - Đổi (bạn chơi thử: "a team has 6 pokemons, miss 1"): card hiện **đội luyện 6 con** thay vì top 5 — chọn tham lam như `suggestTeam` (tiềm năng cao nhất trước, rồi con bù được nhiều Pokémon NPC chưa ai trị). Con nào chưa đạt ngưỡng "giúp rõ" chỉ lấp chỗ trống, gắn nhãn *filler*; box có ít hơn 6 con dưới level mục tiêu thì đội ngắn hơn kèm lý do. Bên dưới: "More candidates" (5 con tiếp theo, thu gọn).
  - Thiếu dữ liệu: **tiến hoá** chưa có trong dataset (`normalize.ts` bỏ evolutions) → Charmander Lv 12 được chấm như Charmander Lv 48, không phải Charizard; **EV** giữ nguyên số hiện tại (luyện thêm sẽ tăng) → điểm tiềm năng là cận dưới; **tutor move** không có trong dữ liệu (chỉ level-up/TM/egg).
- ✅ **0.7.0 (2026-11-18)**: cửa sổ nổi / side panel chỉ trên tab game, Worth grinding, sửa gợi ý khi Pokémon của mình đã ngất (chỉ xếp hạng Pokémon còn sống để đổi vào), tab **Explore** (bản đồ, FIGHT/CATCH, kế hoạch bắt, gợi ý bóng, đọc thẻ gặp Pokémon hoang dã trực tiếp, header bóng + % bắt, chế độ Catch / Defeat).
- ✅ **0.7.1**: Defeat it (tab Explore) đọc cả Pokémon starter (slot 1 nằm ở khối riêng phía trên slot 2–6); Pokémon đứng đầu trên thẻ gặp hoang dã được đánh dấu active.
- ✅ **0.8.0 (2026-11-19)**: Giai đoạn 4a — chấm điểm move hỗ trợ (buff/debuff/trạng thái/màn-thời tiết) trong tab Battle với nhãn Setup; tab Team đánh dấu lead dựng thế / hạ chỉ số. Xem mục 4a.
- ✅ **0.8.1**: trận hoang dã — Pokémon trên thẻ trận của game là active sau khi đổi (move chỉ gắn cho nó), Pokémon rút ra giữ HP.
- ✅ **0.8.2**: Worth grinding hiện đội luyện đủ 6 con (chọn tham lam theo độ phủ như suggestTeam, con yếu được đánh dấu filler) + danh sách "More candidates".
- ✅ **0.9.0 (2026-11-19)**: tab Explore — kế hoạch bắt (Weaken/Status) lấy từ đội đang mang (active trước, bỏ con đã ngất, báo rõ khi không có đòn an toàn / gợi ý đổi Pokémon); gợi ý từ box thu gọn "From your box". Luật FIGHT/CATCH mới: chỉ CATCH khi có trong Catchlist tuần này hoặc chưa đăng ký Pokédex; shiny/item/IV/khắc chế NPC chỉ là gợi ý dưới FIGHT. (Dấu Catchlist lấy theo stylesheet, chưa thấy trên thẻ thật.)
- ✅ **0.10.0**: tab **Tips** — 151 mẹo (106 sinh từ wiki data khi Sync, 45 viết tay từ trang wiki, có link nguồn), tìm kiếm, lọc theo nhóm, Progress path có ô đánh dấu; liên kết từ Explore và NPC. SCHEMA_VERSION 5 → cần Sync lại.
- ✅ **0.11.0**: nhìn trước 2–3 lượt (expectimax), tỉ lệ crit, hiệu ứng phụ; Doubles (đối chiếu trận Tate & Liza thật); Battle Frontier (luật Gen III) + Battle Tower (giữ HP/trạng thái/PP giữa các đối thủ); item trong trận (đếm từ bảng Items, Ether/Elixir, berry trong túi); chia sẻ dữ liệu NPC bằng file JSON.
- ✅ **0.11.1**: sửa lỗi mọi move hiện 0 "No effect" (nature lạ làm calc lỗi và bị nuốt thành 0) — nature lạ → trung tính; lỗi calc hiện "Calc error" thay vì 0.
- ✅ **0.12.0**: đổi tên thành **MeowRPGAdvisor**; giao diện mới hướng C "Arena HUD" (tab Battle / Wild / Prep / Guide, tự chuyển khi vào trận/gặp Pokémon hoang dã, 4 ô move theo thứ tự của game, đòn của đối thủ vẽ lên thanh HP, chữ thường thay điểm số). Tên IndexedDB và key lưu trữ giữ nguyên.
- ✅ **0.12.1**: xác nhận nguyên nhân lỗi "No effect" là nature "random" trong set wiki (vd. Siebold); hai Pokémon NPC giống nhau cùng level (vd. 2 Dragonair Lv 54 của Lance) không còn dùng chung move đã thấy.
- Chưa: đọc số lượng item ngay trên màn trận (hiện dùng số từ lần mở Bag gần nhất); Ether khi hết PP; berry dùng trong trận.

#### 4a — Chấm điểm move hỗ trợ (buff/debuff, mở đường cho Pokémon sau) ✅ (code + test 2026-11-19; chưa chạy thử trong trận thật)
Trước đây status move không có điểm trong tab Battle. Người chơi hay: tăng chỉ số (Swords Dance, Calm Mind, Dragon Dance), hạ chỉ số địch (Screech, Charm, Icy Wind), gây trạng thái (Thunder Wave, Toxic, Will-O-Wisp), dựng màn/thời tiết/bẫy (Reflect, Light Screen, Tailwind, Rain Dance, Stealth Rock), rồi để Pokémon sau "dọn".
- **Đã làm** (`src/engine/supportMoves.ts`, nối vào `adviseTurn`; helper chung `projection.ts`):
  - **Hiệu ứng lấy từ dữ liệu move** (câu mô tả kiểu Showdown của game): "Raises the user's …", "Lowers the target's …", "Has a 100% chance to …". Move gây sát thương chỉ tính hiệu ứng chắc chắn 100% có lợi (Icy Wind, Snarl, Nuzzle, Power-Up Punch); hiệu ứng theo xác suất và tự hạ chỉ số (Close Combat) bỏ qua. Bảng tay nhỏ chỉ cho màn/thời tiết/Tailwind/bẫy (dữ liệu không có dòng chỉ số) và cờ powder/miễn theo hệ của status move (dùng lại `STATUS_MOVES` của `catchPlan.ts`). Bỏ qua: Swagger, Belly Drum, Curse, Acupressure, Geomancy, Memento, Parting Shot, Defog, Protect, Substitute, gây rối loạn… (vẫn "not scored").
  - **Cách chấm**: (A) đánh ngay bằng đòn tốt nhất; (B) dùng move hỗ trợ 1 lượt — chậm hơn thì chịu đòn mạnh nhất của địch trước, nhanh hơn thì đòn của địch lượt đó đã chịu hiệu ứng (Charm, bỏng, Reflect, ngủ) — rồi đánh với stage/trạng thái/sân mới. Điểm = điểm projection của B (cùng thang 0–100 với đòn đánh, nên xếp chung danh sách), trộn theo độ chính xác: `acc × B + (1 − acc) × (mất lượt rồi A)`, trừ 8 như đổi Pokémon/dùng item (không trừ khi A đằng nào cũng thua). Nếu B không hơn A thì điểm bị chặn ≤ min(50, A − 10) — luôn dưới đòn đánh và ngoài vùng "thắng" (55+). Hoà tốc độ tính là địch đi trước (giống projection cũ). Lý do ghi B hơn A ra sao: "you win the 1v1 instead of losing", "KOs X in 2 hits instead of 3 (no turn saved)", "ends with ~X% HP instead of ~Y%". Tốc độ: stage, Tailwind (×2), tê liệt (½ tốc + 25% không đánh được). Bỏng/độc/bão cát/mưa đá: trừ máu mỗi lượt. Ngủ: lượt đánh miễn phí. Yawn: chờ thêm 1 lượt. Accuracy/evasion stage tính vào tỉ lệ trúng.
  - Nhận xét từ khi thử: trong 1v1 tất định, tăng Speed **không bao giờ** tự lật kèo (lượt dựng tốn đúng 1 đòn đã cứu) — trừ khi đòn của địch phụ thuộc tốc độ (Electro Ball). Nên buff của mình được cộng thêm điểm **"sweep"**: buff còn nguyên khi mình ở lại sân, so mình (đã buff, máu sau B) với từng Pokémon còn lại của NPC (dùng move của chính Pokémon đó), ghi "then beats N of their M other Pokémon instead of K".
  - **Cho Pokémon sau**: debuff/status/màn/thời tiết nằm lại → chạy lại matchup của từng Pokémon còn khỏe trên bench với địch đã bị hạ, cộng điểm (10/đòn tiết kiệm + 15 nếu lật kèo, tối đa 25, chỉ khi matchup sau đó thắng): "lets Machamp KO in 1 hit instead of 2". Buff của mình và giấc ngủ (sẽ tỉnh) không được cộng. Màn/thời tiết/Tailwind tính theo số lượt còn lại (5/5/4 lượt tính cả lượt dùng). Bẫy: % máu mất khi từng Pokémon còn lại của NPC vào sân (Stealth Rock theo hệ, Spikes/Toxic Spikes chỉ Pokémon chạm đất), tối đa +20.
  - **Không chấm** (score = null, có lý do): bị KO trước khi kịp dùng; dùng xong bị KO ngay mà không để lại gì cho Pokémon sau; stage đã ±6; địch đã có trạng thái; miễn theo hệ (Thunder Wave vs Ground/Electric, độc vs Poison/Steel, bỏng vs Fire, powder vs Grass/Overcoat); ability (Insomnia, Limber, Immunity…, Clear Body/Hyper Cutter/Big Pecks, Defiant/Competitive/Contrary, Magic Bounce, Good as Gold, Soundproof); Safeguard bên địch / Misty Terrain (đọc từ log); màn/thời tiết/bẫy đã có; NPC có vẻ sẽ đổi (`guessNpcSwitch`) → bỏ debuff stage (status vẫn chấm); move bị luật challenge cấm (đã có từ trước, score 0). Nếu đánh ngay KO chắc chắn trước khi địch ra đòn → điểm hỗ trợ luôn thấp hơn ("you can KO it now").
  - **Trạng thái sân từ log**: Reflect/Light Screen/Tailwind/Safeguard/thời tiết/Misty Terrain/bẫy dựng lại từ các move đã dùng trong log + số lượt (màn hình trận không hiện trạng thái sân).
  - **UI**: tab Battle — move hỗ trợ là lựa chọn bình thường, có chip "Setup" + 1 dòng lý do ("+2 Atk: you win the 1v1 instead of losing (2 hits after this turn); lost if you switch."). Tab Team — mỗi thành viên đội gợi ý có move hỗ trợ đáng dùng (hơn đánh ngay ≥ 5 điểm **và** thắng 1v1 với kế hoạch B) vs Pokémon đầu tiên của NPC được gắn "Setup lead" / "Debuff lead" / "Support lead" (`supportLead` trong `teamSuggest.ts`, chỉ singles). Tab Explore (Defeat it) chỉ liệt kê đòn đánh, không hiện move Setup.
- **Đoán (cần kiểm tra trong trận thật)**: ngủ kéo dài 2 lượt (mainline 1–3); tê liệt 25% không đánh được; Toxic trừ ~1/8 mỗi lượt (trung bình); bỏng 1/16; số lượt màn/thời tiết/Tailwind theo mainline và "lượt" trong log khớp số lượt của game; game có Safeguard/Misty Terrain/ability chặn status giống mainline không; World Boss/Mega Chamber có miễn trạng thái hay hạ chỉ số không (hiện coi như không); NPC có xoá stage khi đổi Pokémon như mainline; Aurora Veil, Trick Room, Leech Seed, rối loạn chưa mô hình. Trạng thái sân đọc từ log chỉ dùng cho move hỗ trợ, chưa đưa vào điểm đòn đánh. Điểm màn/thời tiết cho Pokémon sau giả định nó vào sân ngay lượt kế. Dấu "lead" ở tab Team chưa xem trong UI thật (chỉ test).

#### 4d — Nhìn trước nhiều lượt, crit, hiệu ứng phụ ✅ (code + test 2026-11-19; chưa chạy thử trong trận thật)
- **Lookahead** (`src/engine/lookahead.ts`, nối vào `adviseTurn`): expectimax 2 lượt (tự lên 3 lượt khi cây nhỏ, < 400 nút), giới hạn theo **số nút** (6000) chứ không theo thời gian → kết quả xác định. Damage cache theo (người đánh, stage, người nhận, stage, move, trạng thái, Focus Energy); không tính chuỗi `kochance`. Ở lượt sâu chỉ xét: đòn mạnh nhất, 1 đòn priority, move hỗ trợ còn có ích (không đổi Pokémon, trừ khi Pokémon mình ngất); NPC chỉ giữ tối đa 3 nước đáp ≥ 8%. Thay thế cho Pokémon ngất: chỉ 2 con tốt nhất được tìm sâu.
  - Bắt được: **set up rồi quét** (SD → Brick Break hạ cả 2 con còn lại), **đổi Pokémon để chịu đòn rồi thắng** (NPC chọn đòn theo con đang ra sân, damage áp vào con vào thay), **chip trước để con sau KO** (điểm < 55, cao hơn Growl / đổi Pokémon khi con đang đánh đằng nào cũng ngất).
  - **Một mô hình**: move hỗ trợ dạng tăng/hạ chỉ số/trạng thái (trừ Yawn) được chấm bằng lookahead (`setupScore`: trừ 2 điểm hoà nếu đã thắng; phải hơn đòn tốt nhất ≥ 1 điểm mới là "hơn", nếu không thì giữ luật 4a: ≤ min(50, đòn tốt nhất − 10)); lý do vẫn lấy từ `rateSupport` (4a) + "Looking ahead, it beats attacking now." / "…attacking now is as good or better." Màn/thời tiết/Tailwind/bẫy/Yawn vẫn dùng plan B của 4a nhưng **đặt lên thang của lookahead**: điểm đòn tốt nhất (lookahead) + phần hơn của plan B so với plan A. Test so khớp chạy đúng đường của tab Battle (độ sâu tự động + `setupScore`): cùng kết luận "hơn đánh ngay" với 4a ở 6 tình huống.
  - Điểm > 90 được nén (không cắt) vào 90–100 để "KO ngay" vẫn đứng trên "KO lượt sau".
  - Đổi Pokémon vẫn trừ 8 điểm như cũ; Destiny Bond, move tự ngất, Snore/Dream Eater, move bị cấm giữ cách chấm cũ (chặn điểm sau lookahead).
- **Crit** (`moveEffects.ts`): bảng Gen 7+ (stage 0: 1/24, +1: 1/8, +2: 1/2, +3: 100%, ×1,5) trong 1 hằng số `CRIT_TABLE` (để Battle Frontier Gen III đổi được). Nguồn stage: move "higher chance for a critical hit" (+1), Focus Energy (+2, đọc từ log kể từ lúc vào sân), Super Luck, Scope Lens/Razor Claw, Leek/Lucky Punch; Sniper ×2,25; Merciless; Battle Armor/Shell Armor chặn; Frost Breath/Storm Throw/Wicked Blow luôn crit (calc đã tính sẵn). Crit tính đúng bằng calc (`isCrit`) khi có stage âm của mình / dương của địch, còn lại ×1,5.
  - Lý do của đòn: "~40% to KO now (5% via crit)" hoặc "KO 6% via crit". Ô "Their best hit": chip **Crit risk N%** (xác suất crit của NPC KO mình khi đòn thường không KO, theo phân bố nước đi của NPC) + "~N% they KO you this turn". Hàng đổi Pokémon cũng có chip crit risk cho con vào thay.
  - **Log**: dòng "critical hit" giờ được gắn `crit` (cùng dòng hoặc dòng sau, tới lượt dùng move kế tiếp), không còn là `unusual`; Calc check so với **khoảng damage crit** và gắn nhãn "Crit".
- **Hiệu ứng phụ** (đọc từ mô tả move): flinch (**chỉ khi mình ra đòn trước**, Inner Focus/Shield Dust chặn; Fake Out/First Impression chỉ lượt đầu trên sân), bỏng/tê liệt/đóng băng/độc/độc nặng/ngủ (Tri Attack, Dire Claw chia đều), rối loạn, hạ chỉ số địch, tăng chỉ số mình (theo xác suất), tự hạ chỉ số (Close Combat), recoil, hút máu. Serene Grace ×2, Sheer Force/Shield Dust/Covert Cloak = 0; miễn theo hệ/ability. Tính bằng **giá trị kỳ vọng** qua nhánh trong cây (1 nhánh/đòn, hiệu ứng 100% áp luôn). Lý do: "30% flinch – you're faster", "10% burn", "heals ~20%", "~10% recoil", "−1 Def −1 SpD to you".
  - Thấy khi test: đốt Machoke có **Guts** bị chấm **thấp hơn** (Guts tăng công) — đúng ý.
- **UI**: dòng "▸ đường đi" chỉ ở hàng đầu, hàng Setup và hàng đổi Pokémon (khi đường đi dài hơn 1 bước). Khi Pokémon mình ngất trong đường đi, ghi rõ "Machamp faints, Vaporeon comes in" và không rút gọn thành "KOs both remaining". Chữ "you win/lose the trade" theo điểm lookahead (55+). Chip "Crit risk"; chân trang ghi "2–3 turns looked ahead". Đã xem trong bản dev (dữ liệu dev không có Cottonee nên dùng snapshot tự tạo Machamp vs Quagsire). Đường rẻ cho Explore và đoán NPC.
- **Tốc độ** (lần nhanh nhất trong 7 lần, sau khi JIT ấm): Brock (4 move, 4 bench, 1 địch): ~5 ms/lượt cho cả `adviseTurn`. Bàn đầy (4 move có SD, 5 bench × 4 move, 6 địch): độ sâu 2, 562 nút, 174 lần calc, ~8 ms. Trường hợp xấu nhất là cây vừa dưới ngưỡng lên độ sâu 3 (< 400 nút ở độ sâu 2, thêm tối đa 2500 nút, **dùng lại cùng engine** nên damage đã cache): 4 move, 2 bench, 1 địch → 2496 nút, 69 calc, ~25 ms. Khi cả bộ test chạy song song: 40–70 ms. Lần đầu mở (JIT lạnh) chậm hơn. Test kiểm tra độ sâu, số nút, số calc; giới hạn thời gian để lỏng (< 100 ms).
- **Đoán (cần trận thật để xác nhận)**:
  - Game dùng tỉ lệ crit Gen 7+ (1/24, ×1,5) và câu log có chữ "critical hit"; dòng crit nằm cùng dòng hoặc ngay sau "It dealt N damage."
  - Flinch, tỉ lệ hiệu ứng phụ, Serene Grace/Sheer Force/Shield Dust giống mainline; Fake Out chỉ dùng được lượt đầu.
  - Rối loạn: 33% tự đánh (bỏ qua damage tự đánh), kéo dài ~3 lượt; đóng băng: 20% tan mỗi lượt; ngủ thấy trên màn hình (không có số lượt) còn 1 lượt; ngủ do mình gây: 2 lượt (như 4a).
  - Focus Energy chỉ đọc được từ log (màn hình không hiện), coi như mất khi Pokémon rút ra (xấp xỉ: Pokémon khác cùng phe vừa ra đòn).
  - NPC đưa con tiếp theo **theo thứ tự đội** khi con trước ngất; NPC không đổi Pokémon giữa trận trong cây tìm kiếm.
  - Nước đáp của NPC: 75% npcModel + 25% đòn mạnh nhất (tỉ lệ tự chọn). Move trạng thái NPC không mô hình được (Protect, Destiny Bond…) coi như mất lượt trong cây.
  - "Lượt đầu trên sân" = chưa dùng move nào kể từ khi Pokémon cùng phe khác ra đòn lần cuối (log không có dòng đổi Pokémon đáng tin).
  - Multi-hit: damage cộng theo từng roll (không tách từng hit), crit tính 1 lần cho cả đòn.

- **Ghép 0.11 (lookahead + Frontier/Tower + Doubles, 2026-11-19)**: lookahead theo thế hệ của người đánh (`damageRolls` dùng `atk.gen`, Battle Frontier = calc Gen III); bảng crit Gen III `CRIT_TABLE_GEN3` (1/16, 1/8, 1/4, 1/3, 1/2, ×2, không có move luôn crit). Hàng item (itemAdvisor) được đặt lên thang lookahead: điểm đòn tốt nhất (lookahead) + phần hơn của item so với plan A (1 lượt). Trận đôi: `adviseTurn` không chạy lookahead (kể cả khi bấm "Show 1v1 advice anyway"), chỉ chiếu 1 lượt; calc check trận đôi bỏ qua đòn crit.

#### 4b — Doubles ✅ (code + test 2026-11-19; DOM, log và ×0.75 đối chiếu trận thật Tate & Liza lượt 1–3; **bản build chưa chạy trong trận thật** — reader chỉ test trên fixture dựng lại bằng tay)
Wiki có format `doubles` (vd. Tate & Liza, một số Gym/E4). Trước đây tab Battle chỉ đọc 1 Pokémon mỗi bên → trong trận đôi gợi ý sai.

- **Đã xác minh trên trận thật** (Tate & Liza, Chrome của người chơi, chỉ đọc DOM; người chơi tự bấm, MeowHelper không bấm gì — 2026-11-19):
  - Arena có `data-format="doubles"`; `.battle-turn` = "Double Battle · Turn 1 · 4/4 left".
  - **Mỗi bên chỉ có 1** `.battle-player-stats` / `.battle-opponent-stats` (class `double-active-stats`), bên trong là 2 `.double-active-card`, mỗi thẻ có `.double-position-label` ("Position 1", "Opponent 2") và markup `.battle-combatant` như trận đơn (tên, cấp, HP, item, badge chỉ số "Sp. Atk +1 · Sp. Def +1" riêng từng thẻ). Hàng roster địch: cả 2 con đang ra sân đều `data-active="true"`.
  - Ra lệnh: `.double-battle-controls` → `.double-command-summary` (1 nút mỗi vị trí, `aria-pressed` cho vị trí đang chọn, hiện lệnh đã chọn vd. "Calm Mind") và **một** `.double-command-editor` "Choose for Slowbro · Position 1" chỉ chứa move của vị trí đang chọn. Nhãn nút move kiểu mới: "Surf, Water, Special, 15 of 15 PP" (không có power/accuracy; `title` = mô tả move). Chọn move đơn mục tiêu xong thì hiện `.double-target-picker` ("Crunch · Choose a target", nút "Opponent 1 : Claydol", "Opponent 2 : Xatu", "Ally 1 : Slowbro" với `data-side`) và lúc đó **không còn nút move nào** trong DOM.
  - Tab Switch: `.battle-switch-card` chỉ có trong DOM khi mở tab Switch; nhãn "Send out Slowbro. Choose a healthy reserve Pokémon.", tên/cấp trong `<strong>Slowbro · Lv. 45</strong>`, HP + "Active" trong `<small>120/144 HP · Active</small>`, kèm danh sách move + PP của **cả 2** con đang ra sân.
  - Log: đòn đơn mục tiêu "Scrafty used Crunch on Tate & Liza’s Claydol! It's super effective! It dealt 86 damage."; đòn lan "Slowbro used Surf!" rồi mỗi Pokémon trúng một dòng "Scrafty took 46 damage." / "Tate & Liza’s Xatu took 36 damage.", miễn nhiễm "It doesn't affect Tate & Liza’s Xatu.", và "Tate & Liza’s Claydol: It's super effective!". Surf **trúng cả đồng đội** (Scrafty). NPC dùng thuốc: "Tate & Liza used Hyper Potion on Tate & Liza’s Claydol." Ngất: "Tate & Liza’s Claydol fainted." rồi "Tate & Liza sent out Solrock!" vào đúng vị trí 1.
  - **Spread ×0,75 có áp dụng**: Surf của Slowbro (+1 SpA) vào Xatu (+2 SpD, set wiki chính xác) = 36; calc trận đơn tối thiểu 45 kể cả Slowbro IV 0, calc Doubles 33–49 → khớp. Earthquake của Claydol vào Slowbro = 24 (đơn ≥ 28 với hầu hết nature, đôi 21–34). Earthquake có 3 mục tiêu (Xatu miễn) vẫn bị giảm → mục tiêu miễn nhiễm vẫn tính là "nhiều mục tiêu" như mainline.
- **Đã làm**:
  - **Nhận diện + an toàn** (`doublesReason()` trong `src/shared/battle.ts`): `data-format`, số thẻ vị trí mỗi bên (`snap.sides`), 2 thẻ switch/roster active, format wiki của NPC, hoặc log (≥ 2 lượt có 2 Pokémon cùng bên ra đòn). Nếu là trận đôi mà **không đọc được 2v2** → tab Battle hiện "Doubles: not fully supported yet" và ẩn gợi ý 1v1 (nút "Show 1v1 advice anyway"), calc check bỏ qua.
  - **Reader** (`battleReader.ts`): `snap.actives.player/opponent` (vị trí, HP, trạng thái, item, stage từng thẻ — badge trên màn hình, thiếu thì lấy từ log theo từng Pokémon), `snap.movesFor` (move đang hiện là của ai), nhãn move kiểu dấu phẩy, thẻ "Send out X". Log: `target` + `targetSide` từ "used X on Y", `hits[]` cho đòn lan (sát thương, miễn, ngất, stage từng con), stage theo từng Pokémon (`monBoosts`), tên trần như "Slowbro used…" nhận ra bên mình dù con vừa "Go," là Scrafty. `player`/`opponent` = vị trí 1 nên code trận đơn và Explore không đổi.
  - **Nhớ move** (`battleStore.doublesMoves`): game chỉ hiện move của 1 vị trí mỗi lúc → nhớ move đã thấy (nút move + thẻ Switch) trong cả trận; thiếu thì lấy set trong box.
  - **Calc** (`engine/doublesAdvisor.ts`, `adviseDoubles`): `@smogon/calc` `gameType: 'Doubles'` khi đòn lan có > 1 mục tiêu (còn 1 thì như đơn); Reflect/Light Screen từ log (calc tự dùng 2/3 trong đôi), Helping Hand, Tailwind. Mỗi Pokémon của mình: từng move × từng mục tiêu, điểm 0–100 = 55 × phần HP còn lại bị mất × độ chính xác + thưởng KO (30 chắc / 12 có thể) + 15 × độ nguy hiểm của mục tiêu (đòn mạnh nhất của nó lên 2 con của mình). Đòn lan: cộng các địch trúng (× 0,8 khi trúng 2), **trừ** phần đánh trúng đồng đội (45 × phần HP + 40/20 nếu KO được) và hiện cảnh báo "also hits your X" + chip "Hits ally"; đồng đội miễn (bay, Levitate…) → không trừ, ghi "X is immune". Đồng đội chưa rõ set → vẫn cảnh báo.
  - **Phối hợp**: Protect (52 khi 2 địch cộng lại KO được nó, 5 nếu vừa dùng lượt trước), Fake Out (chỉ lượt đầu ra sân, +flinch, không tính với Inner Focus/Shield Dust), Helping Hand (theo đòn tốt nhất của đồng đội ×1,5, +40 nếu lật thành KO chắc), Follow Me/Rage Powder (khi đồng đội có thể bị KO còn mình chịu được), Tailwind (đếm số cặp lật thứ tự), Trick Room (con chậm hơn cả 2 địch; đang bật thì dùng lại = tắt). **Kế hoạch cặp**: chọn cặp hành động tổng điểm cao nhất + cộng/trừ: dồn 2 đòn KO 1 mục tiêu +25 (chỉ trung bình mới đủ +12), 1 đòn đã KO mà đánh thêm −15, Protect khi đồng đội dùng đòn lan trúng mình +25, Helping Hand không đúng đòn được buff −20, Fake Out + đánh con kia +5, Follow Me + đánh +5.
  - **NPC**: `predictNpcMove` chạy cho từng Pokémon địch vs từng con của mình → move khả năng cao + mục tiêu (đòn lan ghi "hits both"); chấm "guess right" theo từng con. Thứ tự tốc độ 4 con (stage, tê, Scarf, Tailwind; Trick Room đảo).
  - **Calc check** (`checkDoublesEvent`): mỗi Pokémon trúng 1 dòng, đúng mục tiêu, ×0,75 khi đòn lan; test bằng dòng Surf → Xatu 36 thật (khớp).
  - **UI**: tab Battle — trận đôi đọc được thì hiện thẻ cho 4 Pokémon, ô "Suggested this turn" (1 hành động mỗi con + lý do phối hợp), thẻ xếp chồng cho từng Pokémon của mình (top 5 hành động, chip mục tiêu "→ Claydol" / "all adjacent", chip KO / Hits ally / Combo, "If both foes hit it"), move đoán của địch, thứ tự tốc độ. Tab Team — NPC doubles có thẻ **"Lead pair · Doubles"** (`engine/leadPairs.ts`): 3 cặp tốt nhất trong đội gợi ý vs 2 Pokémon đầu của NPC (thấy thật: Tate & Liza ra Claydol + Xatu, slot 1–2).
- **Sửa sau review (2026-11-19)**: calc luôn dùng `gameType: 'Doubles'` (màn Reflect/Light Screen ×2/3 thay vì ½), đòn lan còn 1 mục tiêu thì đổi `target` của move thành đơn (không ×0,75); màn tính theo **bên bị đánh** (đánh trúng đồng đội dùng màn của mình); calc check cũng dùng màn từ log; dòng "took N damage" chỉ gắn vào đòn **không** có mục tiêu ghi tên và phải đúng nguyên câu (không ăn nhầm dòng recoil/thời tiết); vẫn hiện giao diện đôi khi một bên chỉ còn 1 Pokémon; hàng roster không có ô HP riêng thì bỏ phần tiêu đề trước khi đọc HP ("Lv. 41" + "0/112 HP" không thành 410/112).
- **Đọc DOM thật — giới hạn**: vài lần đọc bị cắt cụt (thẻ địch thứ 2, hàng roster, move 3–4, thẻ switch 5–6) → phần đó dựng theo mẫu của phần đã thấy. Hai lần đọc đầu bị bộ lọc của công cụ trình duyệt chặn ("Cookie/query string data"); sau đó đổi cách in (bỏ thuộc tính chứa URL, dùng `:` thay `=`) thì đọc được — không lấy dữ liệu bị chặn, nhưng ghi lại để người chơi xem xét.
- **Đoán (chưa kiểm tra trong trận thật)**: dấu trạng thái (PAR/BRN…) trên thẻ trận đôi; hiệu ứng đồng đội ngoài Helping Hand (Friend Guard, Flower Gift…) chưa mô hình; mọi trọng số điểm và combo ở trên; Fake Out/Follow Me/Helping Hand/Trick Room/Tailwind/Protect có chạy như mainline trong game không; NPC có chọn mục tiêu như mô hình (đang lấy mục tiêu bị đòn đó gây hại nhiều nhất); màn hình khi **Pokémon của mình ngất** trong trận đôi (prompt thay người, vị trí trống) và **đổi Pokémon giữa trận** (câu log "come back"?) chưa thấy — đổi người chưa có gợi ý trong trận đôi; Pokémon ra thay khi bên mình có 1 con ngất; đòn chỉ trúng địch (`allAdjacentFoes`, vd. Rock Slide/Heat Wave) chưa thấy log nhưng chắc cùng dạng "took N damage"; cặp lead dùng điểm 1v1 + luật kinh nghiệm, không mô phỏng 2v2; Triples: để sau.

#### 4c — Tab Explore: map, bắt Pokémon, chọn bóng ✅ (code + test 2026-11-18; chưa chạy thử trong Chrome thật)
- **Dữ liệu (wiki data, SCHEMA_VERSION 4 → cần Sync lại)**: `maps` (23 map, encounter theo cách gặp walking/surf/rod, cấp, độ hiếm, tỉ lệ ngày/đêm theo từng khu nhỏ), `catchRate`/`rarity`/`availability`/`spawnRequirement` của loài, item `balls` (mô tả hệ số bằng chữ), `wildSources` (item hoang dã cầm, % theo map), `evolutionMethods` (Moon Stone). Dòng encounter chồng lên nhau theo section → gộp theo loài + cách gặp, lấy tỉ lệ **cao nhất** (không cộng).
- **Luật bắt (trang wiki "Catching Wild Pokémon")**: ngủ/đóng băng ×2.5, tê/bỏng/độc ×1.5, thưởng cấp < 13 ((36 − 2·Lv)/10), critical capture theo số loài trong Pokédex (Catching Charm ×2), luật bỏ chạy sau lần ném hỏng. Phần HP và công thức lắc theo game gốc (Gen 6+) → UI ghi là **ước tính**.
- **Engine**: `explore.ts` (lọc/tìm map, "tìm X ở đâu", loài đáng bắt vs NPC đang chọn theo hệ của dạng bắt được, FIGHT/CATCH), `catching.ts` (tỉ lệ bắt, bảng luật từng bóng viết tay theo mô tả wiki, xếp hạng bóng, ưu tiên bóng trong túi, bóng rẻ thắng khi gần bằng, giữ Master Ball), `catchPlan.ts` (False Swipe/Hold Back, đòn yếu đo bằng damage calc vs bản yếu nhất IV 0 để không KO, chiêu trạng thái ngủ > tê > bỏng/độc, miễn nhiễm theo hệ/ability).
- **Thiếu dữ liệu**: không có cân nặng (Heavy Ball không tính được); Pokédex thật không đọc được → dùng box thay (Repeat Ball, critical capture); IV của Pokémon hoang dã không hiện → người dùng tự đánh dấu; tự nhận trận hoang dã từ battle reader **chưa xác minh** (chỉ gợi ý "Use it", luôn chọn tay được).
- **Đọc trận hoang dã tự động (2026-11-18)**: `src/content/wildReader.ts` đọc thẻ "A wild X appeared!" trên trang Explore (chỉ đọc): tên map, loài, giới tính, cấp, độ hiếm, shiny, item cầm, icon Pokédex (Registered), `[in box: N]`, số bóng ở hàng Quick catch, Pokémon dẫn đầu. Lưu vào `mdWild` → tab Explore tự điền Encounter / Catch plan / Ball; FIGHT/CATCH dùng in-box + Pokédex của game thay cho box. Màn intro đã đối chiếu DOM thật (Doduo, Grasslands 3); màn trận sau khi bấm Battle (HP %, trạng thái) mới chỉ dựa theo tên class trong CSS của game → cần kiểm tra trận thật.

- **Tab Tips – hướng dẫn tiến trình (2026-11-19)**: tab mới "Tips" để người chơi mới bắt kịp: tìm kiếm theo item / map / chiêu / NPC, lọc theo nhóm (Getting started, HMs & field moves, Key items, Map unlocks, Catching, Battling, Daily/weekly, Evolution) và chế độ "Progress path" (thứ tự gợi ý theo từng Champion, đánh dấu đã xong lưu ở localStorage `mh-tips-done`). Hai nguồn: (1) `src/data/tipsGen.ts` sinh tip từ file dữ liệu wiki lúc sync (HM ↔ Champion qua `challenges[].rewardItems`, `keyItemSource`, `spawnRequirement`/`spawnItem`, thứ tự League qua `prerequisiteTrainerIds`, Battle Tower, nguồn item, cách tiến hoá đặc biệt) → tự cập nhật khi game đổi; (2) `src/data/tips.ts` tip viết tay (diễn đạt lại, không chép nguyên văn) từ các trang wiki: mở map, dùng field move, Legendary, quest/Catchlist… Mỗi tip ghi nguồn (link trang wiki hoặc "wiki data: <field>"). Liên kết: thẻ map trong Explore hiện "Getting there & what you need" (cần Surf/cần cần câu → cách lấy), trang NPC hiện "Rewards & unlocks", hàng NPC hiện huy hiệu + HM/Key Item. SCHEMA_VERSION lên 5 (thêm `Dataset.tips`, `Npc.badge`, `Npc.rewardItems`) nên người dùng cần sync lại để có tip từ dữ liệu.

#### 4e — Battle Frontier (luật Gen III) + Battle Tower ✅ (nhánh song song cũng gọi là 4d; đổi thành 4e khi ghép 0.11) (code + test 2026-11-19; chưa chạy thử trong trận thật)
**Nguồn** (đọc trên wiki 2026-11-19, chỉ đọc, đã diễn đạt lại): `#/challenges/battle-frontier`, `…/battle-frontier/battle-rules`, 7 trang facility `…/battle-frontier/{tower,dome,palace,arena,factory,pike,pyramid}`, `#/challenges/battle-towers`, `…/battle-towers/whirl-tower`; file dữ liệu wiki (`battleTowers`, `frontierBrains`).

**Hai thứ khác nhau tên "tower"** (giả định cũ trong brief bị sửa):
- **Battle Towers** (Whirl/Bell/Dark/Light, category `tower`): MỘT trận đơn liên tục với 20 Pokémon Lv100 **cố định** của guardian (không phải pool ngẫu nhiên; đổi Pokémon có thể đổi thứ tự gặp). HP/trạng thái/PP giữ suốt 20 con, không hồi máu, cấm thuốc trong Bag, item cầm vẫn chạy, mang 1–6 con. Luật thường (Gen 9). Mỗi lần thắng: 2.000 Pokécoin, 10% Mint, 5% Wing/Stone, TM (lần đầu chắc chắn rồi 10%).
- **Battle Tower của Frontier** (Anabel): 7 trận 3v3, **hồi đầy sau mỗi trận** → KHÔNG giữ HP giữa các trận. Trong Frontier chỉ Pike (14 phòng) và Pyramid (7 tầng) giữ HP/trạng thái/PP.

**Luật Frontier (đã xác nhận trên wiki)**: mở sau khi thắng Champion Wallace (Hoenn). Luật mô phỏng Gen III riêng: không có hệ Fairy (Gardevoir thuần Psychic, Clefable thuần Normal, Charm/Sweet Kiss/Moonlight là Normal), **hệ của chiêu quyết định vật lý/đặc biệt** (Normal, Fighting, Flying, Poison, Ground, Rock, Bug, Ghost, Steel dùng Atk; còn lại dùng SpA), sức mạnh/độ chính xác Gen III (Surf/Thunderbolt/Flamethrower/Ice Beam 95), chỉ số + ability Gen III (ability đời sau, kể cả Hidden, thành ability Gen III của loài, vd Gengar có Levitate), Steel kháng Ghost/Dark. Chỉ Pokémon/chiêu/item Gen I–III; loại restricted, Mega, dạng đời sau; **species clause + item clause**; không Mega/Z/Dynamax/Tera. Cấp: **Level 50** nhận Pokémon ≤ 50 (không hạ cấp); **Open Level**: đối thủ = cấp cao nhất bạn đăng ký, tối thiểu 60 (Factory: thuê Lv50 / Lv100). Brain: đội cố định, ability ngẫu nhiên trong ability Gen III, **cấp 50 hoặc theo luật Open** (đã thay giả định "Lv 50?" cũ). Đăng ký 3 (Dome đánh 2/3, Pyramid không được cầm item, Factory dùng Pokémon thuê, Arena không được đổi). BP theo từng facility, thắng Brain +10 BP, ví tối đa 9.999 BP. **Hardcore**: Pokémon của bạn bị hạ là mất luôn (trừ đồ thuê Factory). Đối thủ khác trong Frontier dùng đội + AI Frontier của Emerald.

**Chưa xác nhận / đoán**: danh sách loài restricted (wiki không ghi → dùng danh sách cấm của Emerald: Mewtwo, Mew, Lugia, Ho-Oh, Celebi, Kyogre, Groudon, Rayquaza, Jirachi, Deoxys, ghi rõ "đoán" trong UI); Factory có hồi máu giữa trận không (trang không ghi, coi như có); cấm Bag ở Palace/Arena/Pike (chỉ Tower/Dome ghi rõ); `data-kind` của trận Frontier và tên đối thủ trên màn hình Battle Tower (guardian hay tên tháp) chưa thấy trong trận thật; độ chính xác chiêu vẫn lấy từ dữ liệu game (calc gen 3 không có accuracy). Dữ liệu wiki **không có pool trainer thường của Frontier** và không có Brain của Factory (Noland ngẫu nhiên) → chỉ lập kế hoạch chính xác được cho Brain.

**Cài đặt**:
- `src/engine/gen3.ts`: `gen3View(ds)` tạo Dataset "Gen III" (loài: hệ/chỉ số/ability từ dex gen 3 của @smogon/calc; chiêu: hệ/sức mạnh Gen III, loại theo hệ; bỏ chiêu không có ở Gen III; bảng hệ Gen III) với `ruleset: 'gen3'`; `gen3Issues()` đánh dấu loài đời sau/restricted (chặn), chiêu đời sau, item đời sau, ability đổi (không chặn).
- `damage.ts` (thêm vào, không đổi chữ ký): `calcGen(ds)`; khi `ruleset === 'gen3'` thì calc chạy gen 3 (crit ×2, item/ability Gen III), không ghi đè dữ liệu game lên chiêu (giữ phân loại theo hệ), chiêu không có ở Gen III → null (không thay bằng Tackle), ability đời sau → ability Gen III, item đời sau bị bỏ. `moveDamage` lấy generation từ Pokémon tấn công.
- `rules.ts`: `FRONTIER_RULES` (`gen: 3`, cấm Bag), `dsFor(ds, rules)`, `battleRulesFor(category, kind, gen3)` cho tab Battle: NPC khớp luôn quyết định (công tắc "Gen III" để quên vẫn không biến trận Gym thành Gen III) → công tắc tay → `data-kind` có chữ "frontier" (không dùng "arena" vì đó là tên khung trận của reader). `TOWER_RULES.carryOver` bật điểm bền bỉ mặc định (cả tab Team lẫn "Worth grinding"); "Versatility" chấm từng NPC theo luật riêng của nó (`baseOf` + `dsFor`). Tên Nidoran♀/♂ được đổi sang Nidoran-F/-M khi tra dex của calc; Pyramid chấm điểm không có item cầm; species clause áp cả cho Pokémon đã khoá.
- `frontier.ts`: bảng 7 facility (luật, số Pokémon, hồi máu/giữ HP, Symbol, BP, nguồn), `brainLevel`, `withLevel`, `frontierEntry` (điều kiện vào), `itemClause`.
- `towerPlan.ts`: điểm "bền bỉ" cho Battle Tower (giữ HP + hồi phục: Leftovers, Recover/Rest…, Regenerator), `towerEndurance` (ngân sách HP cả đội qua 20 đối thủ), bộ nhớ lượt đánh tháp `updateRun`/`runSummary` (đối thủ đã hạ, HP/PP còn lại).
- `teamSuggest.ts`: tuỳ chọn `blocked`, `uniqueSpecies`, `endurance`; tự dùng `dsFor`.
- UI: tab NPC — công tắc Level 50 / Open Level, thẻ luật facility (Gen III, clause, Symbol, BP, cảnh báo Hardcore) hoặc luật Battle Tower, hệ/chỉ số theo Gen III; tab Team — đội 3 con, loại Pokémon không vào được (kèm lý do), cảnh báo item clause/chiêu/item/ability, chỉ gợi ý item Gen III (Pyramid: không item), ẩn "Worth grinding" ở Open Level (Brain theo cấp của bạn); Battle Tower: điểm bền bỉ + thẻ "Endurance"; tab Battle — công tắc "Battle Frontier: use Gen III rules", thẻ "Tower run" (x/20 đã hạ, % HP đội, PP thấp, còn lại ai), Calc check dùng calc gen 3 khi là Frontier.
- Test: `tests/frontier.test.ts` (damage Gen III khớp calc gốc, phân loại theo hệ, không Fairy, Steel kháng Ghost/Dark, chiêu/item/ability đời sau, crit ×2, tra luật, cấp Brain, clause, chặn loài, bền bỉ, bộ nhớ lượt tháp).

**Cần chạy thật để xác minh**: một trận Frontier (data-kind, tên Brain/trainer trên màn hình, số damage so với calc gen 3 trong Calc check, ability ngẫu nhiên của Brain); một lượt Battle Tower (tên đối thủ hiện là guardian hay tên tháp, thanh đội đối thủ có hiện con đã ngất không, PP của Pokémon dự bị có hiện không); danh sách restricted thật trong màn chọn đội.

---

## 6. Rủi ro & cách giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Vi phạm ToS → bị khoá tài khoản | Chỉ tư vấn, đọc thụ động, UI ở side panel. Admin đã đồng ý (2026-11-18) với điều kiện không automation |
| Game đổi UI → selector hỏng | Gom selector một chỗ, test bằng HTML snapshot, báo lỗi rõ trong panel |
| Cơ chế game khác mainline | Đối chiếu damage ở Phase 0, có lớp override và rule modifier |
| Dữ liệu NPC thiếu (ẩn EV/item) | Đánh dấu "chưa biết", dùng giá trị mặc định thận trọng, bổ sung từ quan sát trận |
| Engine chậm khi box lớn | Web Worker, beam search giới hạn, cache kết quả calc |

---

## 7. Cấu trúc thư mục dự kiến
```
PokemeowHelper/
├─ docs/            PLAN.md, design/ (mockup, icon)
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


---

## Chia sẻ dữ liệu NPC (Settings → Share NPC data)
- Xuất file JSON gồm: phiên bản định dạng, ngày xuất, phiên bản MeowHelper, id ngẫu nhiên và NPC → biến thể → Pokémon → các move đã thấy. Không có tên người chơi, box, đội hình, túi đồ hay id tài khoản; không upload lên server nào, người dùng tự gửi file (Discord/Drive).
- Nhập file được kiểm tra chặt (tối đa 2 MB, chỉ NPC/move có trong dữ liệu wiki, bỏ qua trường lạ). Dữ liệu nhập lưu ở `others` của từng mục trong `mdObserved` (số nguồn đã thấy move) và sổ nhập `mdImports`; move bạn tự thấy vẫn nằm ở `moves`.
- Chống tính trùng: cùng id nguồn thì file mới thay file cũ, cùng nội dung khác id bị từ chối. "Remove imported data" xóa sạch phần nhập, giữ phần của bạn. Tab NPC và dòng "Seen in earlier battles" hiển thị "seen by others (n)".

---

## World Boss: chọn move theo lần xuất hiện, đội counter (Prep)
- Mỗi lần xuất hiện, World Boss chỉ mang một phần move pool. Trang World Boss của game (sidebar → Battling → "World Boss Battles") có thẻ "Next scheduled boss"; bấm tên boss (hoặc "About this boss" ở lịch) mở hộp chi tiết có Level / Ability / Nature và "Moves this appearance" khi game đã biết (nếu chưa thì ghi "confirmed when it appears").
- `content/bossLobbyReader.ts` đọc thẻ đó và hộp chi tiết (chỉ đọc), lưu `mdBossLobby` (gộp theo boss, đóng hộp không mất move). **Chưa kiểm tra trên trang thật**: selector lấy từ class name trong code game (chunk WorldBossBattles, đọc 2026-11-20), fixture `tests/fixtures/worldboss/lobby.unverified.html`.
- Prep → Opponent: move pool thành chip bấm được, tự chọn sẵn từ lobby ("From lobby · next spawn"), hoặc tự bấm ("Your pick", lưu localStorage). Lấy cái mới hơn; quá 12 giờ thì bỏ (tránh dùng set cũ cho lần sau). Không chọn gì = tính cả pool.
- Move đã chọn quyết định best attacking/defensive types, danh sách Danger, đội counter (Prep → Team) và dự đoán move của boss ở tab Battle (`AdviseOptions.bossMoves`; move thấy dùng ngoài set vẫn được thêm lại kèm ghi chú).
- Đội counter (`engine/worldBoss.ts`): đua sát thương vào HP chung (3.000.000): mỗi Pokémon tính sát thương/lượt (HP thô và % HP chung), số lượt chịu được, tổng sát thương trước khi gục; thử thêm phương án dùng move hỗ trợ lượt đầu (tăng chỉ số, Reflect/Light Screen, hạ Atk/SpA, burn/paralysis) nếu tổng cao hơn.
- Theo text của game: đòn của boss đều là Max Move; "55% less damage"; khiên đầu trận và ở 75%/40% HP giảm nửa sát thương của bạn và chặn status move; boss chưa thể ngủ/đóng băng; phase 3 (dưới 40%) thêm Max Move mỗi 3 lượt (chưa tính). **Giả định**: sức mạnh Max Move theo bảng Gen 8; "55% less damage" áp dụng cho mọi boss (có thể chỉ là Overdrive của Eternamax); sát thương trừ thẳng vào HP chung theo chỉ số của boss.
