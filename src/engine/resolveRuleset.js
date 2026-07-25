import { RULESETS } from '../data/rulesets.js';
import { getAdapter } from './rulesetAdapters.js';

// セッションのルールセット解決。セッションが持つスナップショット(session.ruleset)を
// 最優先し、rulesetIdしか持たない旧セッションにも対応する。
export function resolveRuleset(session) {
  return session.ruleset || RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0];
}

// 判定式アダプタの解決。プロンプト生成と統計集計の双方が同じ規則を使うため、
// 判定エンジン側に置く(プロンプト側に置くと統計モジュールからの依存が層を逆転する)。
export function resolveAdapter(session) {
  return getAdapter(resolveRuleset(session).formula);
}
