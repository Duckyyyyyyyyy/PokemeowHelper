/**
 * Placeholder for "Hunt & grind for this NPC" (docs/design/hunt-and-grind-spec.md): the layout slot is
 * here, the feature is not built yet.
 */
export function HuntSlot({ npcName }: { npcName: string }) {
  return (
    <section class="slotph" aria-label="Hunt for this NPC (coming later)">
      <p class="title" style={{ margin: 0 }}>Hunt for {npcName} <span class="soon">Coming later</span></p>
      <div class="small">Pokémon to catch on maps you can reach, where to find them, and how far to train them to beat {npcName}.</div>
      <div class="small muted">Until then: Worth grinding below picks from the Pokémon you already own.</div>
    </section>
  );
}
