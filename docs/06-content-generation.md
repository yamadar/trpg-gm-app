# 生成機能・コンテンツ処理

## テキスト生成

Gemini テキストモデルを使う機能:

- ソロ GM ターンと Party の planner／narrator
- Scenario の構造分析と AI 進行ガイド抽出
- Setup のシナリオ自動生成
- Character シートからの名前、目標、因縁の抽出
- Campaign の章精算、次話候補、次章シナリオ生成
- セッションログのノベル化、出力打ち切り時の継続、エンディング名生成

生成 API はユーザーごとのメッセージ数・トークン数・ノベル化数と、全体トークン数・同時実行数を制限する。上限は `.env.example` の `LIMIT_*` で設定する。

## World と素材

World 原文はセッションでは要約を参照する。World の地域・カテゴリ補助コンテンツはライブラリで保持・編集できるが、GM プロンプトへ個別選択注入しない。Scenario 原文を優先し、抽出した AI 進行ガイドは補助データとして扱う。

スターターは `content/starters/` のパックを seed して提供する。World、PC、NPC、Scenario をまとめて取り込める。

## 場面挿絵

画像生成を有効化すると、GM 地の文、雰囲気タグ、登場人物の外見からプロンプトを作る。場面分析で抽出した登場人物の外見はセッションの appearance registry に保存し、PC シートに外見記述があればそちらを優先する。画像はサイズ・形式を正規化してメディアストアへ保存する。

## Party と Campaign

Party の生成は、意図の計画と確定結果の描写を分離する。通常はplanner → コード判定 → narratorの2回のAI呼び出し。plannerにはGM資料、要約、直近の描写を渡し、共通目的と各PCの個別裁定・目的を返させる。narratorへGM専用シナリオ原文や個人向けFact一覧を直接渡さず、開示許可済みの共通・PC別裁定とaudience付き直近描写を渡す。個人向け情報は本人の描写と選択肢だけに使用する。

narratorの `narratives` は全PC IDを必須キーとするオブジェクト。受信後に本人だけのaudienceをコードで付与し、共有snapshotへ反映する。共通描写一つだけの応答を成功扱いにしない。

PartyのGemini 3系には `thinkingLevel: LOW` を指定し、各呼び出しのタイムアウトを60秒とする。出力上限を極端に下げて文章を打ち切らず、個別描写は300〜600字を目安にする。[Geminiの公式指針](https://ai.google.dev/gemini-api/docs/generate-content/thinking)も、遅延を減らす場合は出力トークン上限よりthinking levelの調整を勧めている。planner完了後のcheckpointがあれば、再試行はnarratorの1回だけで済む。

`server/textProvider.js` は全テキスト生成の呼び出し時間・モデル・トークン使用量・失敗種別を構造化ログへ出す。Partyでは処理段階とセッション／ラウンド／処理IDを追加する。実モデルの応答時間はモデル・負荷・文量に依存し、テスト用モックの所要時間を実測値として扱わない。

Campaign は完了セッションの要約、PC 状態、エンディングを使って章を精算し、次話候補または次章 Scenario を生成する。
