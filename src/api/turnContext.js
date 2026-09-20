// Only material consumed by the GM prompt belongs on the AI wire.
export function turnContext(session) {
  return {
    rulesetId: session.rulesetId,
    ruleset: session.ruleset,
    world: { summary: session.world?.summary || '' },
    scenario: { raw: session.scenario?.raw || '', directorGuide: session.scenario?.directorGuide },
    pc: { raw: session.pc?.raw || '', goal: session.pc?.goal, bonds: session.pc?.bonds },
    state: session.state,
  };
}
