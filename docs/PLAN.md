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
- Giả định còn lại: chưa đối chiếu damage thực tế trong trận (sẽ làm ở Giai đoạn 3 bằng battle log). Frontier Brain không có level nên giả định Lv 50.

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
- Chưa làm: expectimax nhiều lượt (mục 3.3; hiện là dự đoán 1v1), crit và hiệu ứng phụ, chấm điểm status move, Doubles (Giai đoạn 4).

### Giai đoạn 4 — Mở rộng
- ✅ 2026-11-18: admin game đồng ý cho dùng/chia sẻ, **với điều kiện không có automation**. Đổi tên MeowDex → **MeowHelper** (0.5.0); `npm run package` tạo zip để chia sẻ.
- Học hành vi NPC từ log, chia sẻ bộ dữ liệu NPC qua file JSON. Battle Tower/Frontier.
- Chrome Web Store (phí 5 USD, cần privacy policy) khi muốn cài 1 click + tự cập nhật.

#### 4a — Chấm điểm move hỗ trợ (buff/debuff, mở đường cho Pokémon sau) — làm trước
Hiện status move không có điểm trong tab Battle. Người chơi hay: tăng chỉ số (Swords Dance, Calm Mind, Dragon Dance), hạ chỉ số địch (Screech, Charm, Icy Wind), gây trạng thái (Thunder Wave, Toxic, Will-O-Wisp), dựng màn/thời tiết/bẫy (Reflect, Light Screen, Tailwind, Rain Dance, Stealth Rock), rồi để Pokémon sau "dọn".
- **Cách chấm**: so sánh 2 kế hoạch bằng calc 1v1 đã có — (A) đánh ngay, (B) dùng move hỗ trợ 1 lượt (chịu 1 đòn mạnh nhất của địch) rồi đánh với chỉ số mới. Điểm = B tốt hơn A bao nhiêu (số lượt để KO, % máu còn lại).
- **Cho Pokémon sau**: debuff/status nằm lại trên địch (stage hạ, PAR/BRN/PSN), còn buff của mình mất khi đổi ra. Với debuff/status: chạy lại matchup của **cả đội còn lại** với địch đã bị hạ → "Screech giúp Machamp KO trong 1 đòn thay vì 2". Màn/thời tiết: tính theo số lượt còn lại.
- **Không chấm**: khi mình sắp bị KO trước khi kịp hưởng lợi; stage đã ±6; địch đã có trạng thái; NPC sẽ đổi Pokémon (mất debuff stage).
- Hiển thị: dòng "Setup" trong danh sách, kèm lý do ("+2 Atk: KO Onix trong 1 đòn thay vì 3").
- Tab Team: đánh dấu Pokémon có move hỗ trợ đáng giá cho từng NPC (gợi ý "lead dựng màn / hạ chỉ số").

#### 4b — Doubles
Wiki có format `doubles` (vd. Tate & Liza, một số Gym/E4). Hiện tab Battle chỉ đọc 1 Pokémon mỗi bên → trong trận đôi có thể sai.
1. **Xác minh trước (cần trận thật)**: DOM trận đôi (2 ô mỗi bên? chọn mục tiêu ra sao?), câu chữ log ("used X on Y"?), spread move có giảm 25% không.
2. **Reader**: đọc 2 Pokémon mỗi bên + mục tiêu của mỗi đòn trong log. Trước khi làm xong: phát hiện trận đôi và hiện "Doubles: chưa hỗ trợ" thay vì gợi ý sai.
3. **Calc**: `@smogon/calc` hỗ trợ `gameType: 'Doubles'` (spread ×0.75, màn ×2/3, ally). Gợi ý theo từng Pokémon của mình: move + mục tiêu tốt nhất, cảnh báo đòn đánh trúng cả đồng đội (Earthquake, Surf) nếu đồng đội không miễn.
4. **Phối hợp**: điểm cộng cho combo phổ biến (Helping Hand, Follow Me/Rage Powder, Fake Out, Tailwind/Trick Room, Earthquake + đồng đội bay/Levitate), và dồn 2 đòn vào 1 mục tiêu để KO.
5. **Tab Team**: chọn cặp lead và đánh giá theo cặp (không chỉ 1v1).
- Triples: để sau.

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
