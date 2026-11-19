/** The real log of turns 1–2 (Tate & Liza, 2026-11-19), gender already stripped as the reader does. */
export const TATE_LIZA_LOG = [
  ['Go, Slowbro!'], ['Go, Scrafty!'], ['Tate & Liza sent out Claydol!'], ['Tate & Liza sent out Xatu!'],
  ['Tate & Liza’s Xatu used Calm Mind!', 1], ["Tate & Liza’s Xatu's Sp. Atk rose!", 1], ["Tate & Liza’s Xatu's Sp. Def rose!", 1],
  ['Tate & Liza’s Claydol used Earthquake!', 1], ["It doesn't affect Tate & Liza’s Xatu.", 1],
  ['Slowbro took 24 damage.', 1], ['Scrafty took 27 damage.', 1],
  ["Scrafty used Crunch on Tate & Liza’s Claydol! It's super effective! It dealt 86 damage.", 1],
  ['Slowbro used Calm Mind!', 1], ["Slowbro's Sp. Atk rose!", 1], ["Slowbro's Sp. Def rose!", 1],
  ['Tate & Liza used Hyper Potion on Tate & Liza’s Claydol.', 2], ['Tate & Liza’s Claydol had its HP restored.', 2],
  ['Tate & Liza’s Xatu used Calm Mind!', 2], ["Tate & Liza’s Xatu's Sp. Atk rose!", 2], ["Tate & Liza’s Xatu's Sp. Def rose!", 2],
  ["Scrafty used Beat Up on Tate & Liza’s Claydol! It's super effective! A critical hit! Hit 6 times! It dealt 108 damage.", 2],
  ['Slowbro used Surf!', 2], ["Tate & Liza’s Claydol: It's super effective!", 2],
  ['Scrafty took 46 damage.', 2], ['Tate & Liza’s Claydol took 4 damage.', 2], ['Tate & Liza’s Xatu took 36 damage.', 2],
  ['Tate & Liza’s Claydol fainted.', 2], ['Tate & Liza sent out Solrock!', 2],
].map(([text, turn]) => ({ text: text as string, turn: turn as number | undefined }));
