# Phase 2 実装報告

実施日: 2026-09-15。対象: `C:\Repos\cidao-talent`（`feature/talent-bank-phase1` のworktree）。Phase 1コミット`d90cb09`と適用済み基盤の上に、Phase 2のみ実装しました。統合仕様は読み取りのみです。型検査・変更対象lint・実Vitest 81件は成功しましたが、指定の通常Vitest起動は環境権限エラーのため、機械的な完了条件は一部未達です。

## 実装内容

- 受付、対象種別・表示名入力、成人本人／店舗・団体代表者確認、対象別の現行`interview`・`external_ai`同意。保存には既存`getOrCreateSelfSubject`・`recordConsent`・`createTalentBankClient`を利用。
- 指示された20項目（必須8、任意12）。必須の想いは`passion`、開始理由は任意`reason_started`。個人情報の連絡先キーは定義しない。
- 安定した役割・規則・項目一覧を先頭、可変の項目状態を末尾に置いたsystem prompt。丁寧・短文・1問ずつ・推測禁止・回答済み再質問禁止・子どもへの質問禁止・住所／電話／メールの質問禁止。
- 非ストリーミングの構造化出力。AIは既存`callAI()`経由の`extractStructured`・`purpose=interview`で呼び出し、`caseId=interview.id`。Phase 1のSonnet 5設定を変更しない。
- 項目ごとのstate/value/evidence/updated_atをマージし、定義外キーを無視。根拠は今回のユーザー発話ID。AI充足判定とサーバー必須チェックが両方真のときだけ完了。空のanswered値は未回答扱い。
- 開始時の固定挨拶はAI無料。activeの再利用、pausedの再開、doneのまとめ再表示。原文、assistantのrun_id、進捗、回数を保存。
- `interviews`・`interview_messages`のSQL、本人／運営のRLS、GRANT、既存default privilegesの取り消し、冪等化、コメント、毎日03:15の365日原文削除cron。同時activeを会員・kindごとに1件に制限。
- 2つのsecurity invoker RPCで、user保存＋呼び出し枠確保、assistant保存＋抽出値・完了状態をそれぞれ原子的に保存。処理tokenと5分リースで並行ターンを制御し、異常終了後は期限失効で回復。
- APIは認証必須、本人IDとインタビューをサーバーで特定、maxDuration=60、1分10回の簡易レート制限。401以外の失敗はHTTP 200＋ok:false。生例外・会話原文はログにもAPIエラーにも出さない。
- スマホ用チャット、下部固定入力、進捗、再読込、中断／再開、完了まとめ。対応ブラウザだけWeb Speech APIマイク入力を表示しja-JPで認識。認識結果は送信前に編集可。質問読み上げなし。
- `/talent`に指定リンクを追加。その他の既存機能・`/me`は変更なし。プロフィール生成・編集・公開・動画・依頼ヒアリング・マッチングは未実装。

## 変更ファイル

既存ファイル:

- `README.md`
- `src/lib/talent-bank/types.ts`
- `src/app/talent/page.tsx`（ボタン隣のリンク追加を1行の差分で実施）

追加ファイル:

- `supabase/migrations/20260915120000_talent_bank_phase2.sql`
- `src/lib/talent-bank/interview/config.ts`
- `src/lib/talent-bank/interview/fields.ts`
- `src/lib/talent-bank/interview/prompt.ts`
- `src/lib/talent-bank/interview/turn.ts`
- `src/lib/talent-bank/interview/start.ts`
- `src/lib/talent-bank/interview/pause.ts`
- `src/lib/talent-bank/interview/summary.ts`
- `src/lib/talent-bank/interview/access.ts`
- `src/lib/talent-bank/interview/snapshot.ts`
- `src/lib/talent-bank/interview/errors.ts`
- `src/lib/talent-bank/interview/rate-limit.ts`
- `src/lib/talent-bank/interview/__tests__/mock-interview-db.ts`
- `src/lib/talent-bank/interview/__tests__/fields-prompt.test.ts`
- `src/lib/talent-bank/interview/__tests__/turn.test.ts`
- `src/lib/talent-bank/interview/__tests__/start.test.ts`
- `src/lib/talent-bank/interview/__tests__/route.test.ts`
- `src/app/api/talent-bank/interview/route.ts`
- `src/app/talent/interview/page.tsx`
- `src/app/talent/interview/actions.ts`
- `src/app/talent/interview/_components/RegistrationForms.tsx`
- `src/app/talent/interview/_components/InterviewChat.tsx`
- `docs/talent-bank/phase2-report.md`

依存・package/lockfile・既存Vitest設定・Next.js設定・Phase 1ライブラリ本体を変更していません。Gitのadd/commit/push/switchは実行していません。

## 実行コマンドとexit code

最終コードに対する結果は以下のとおりです。

| コマンド | exit code | 結果 |
|---|---:|---|
| `npx tsc --noEmit`（実装後の初回・テスト追加後） | 0 | 型検査成功 |
| `npx eslint src/lib/talent-bank/types.ts src/lib/talent-bank/interview src/app/api/talent-bank/interview/route.ts src/app/talent/interview src/app/talent/page.tsx`（初回） | 0 | 対象コード成功 |
| `npx vitest run` | 1 | テスト開始前のVite設定bundle処理で`spawn EPERM`。Windowsドライブ確認用`net use`の子プロセス起動不可 |
| `npx vitest run --configLoader native --pool=threads`（APIテスト追加前） | 0 | 8ファイル69件成功（Phase 1の33件＋Phase 2の36件） |
| `npx tsc --noEmit`（最終） | 0 | APIテスト・UI修正を含む全体の型検査成功 |
| `npx vitest run --configLoader native --pool=threads`（最終） | 0 | 9ファイル81件成功。除外・skipなし |
| `npx eslint --no-warn-ignored <変更・追加した全ファイル>`（最終） | 0 | 対象コード成功。SQL/Markdownも引数に含め、既存設定で解析対象外の通知だけを抑制 |
| `npx vitest run`（設定互換性の調査時） | 1 | 型専用import＋threadsの一時的な設定変更では最初のspawnを回避したが、ジャンクション先`node_modules/.vite-temp`への書込がEPERM。設定は元に復元し、Git差分なし |
| `git diff --check` | 0 | 差分空白チェック成功 |

通常のVitestコマンドの失敗を成功扱いにしていません。Node 24のnative設定読込＋worker threadsを使う既存Vitestの公式オプションで同じテストを実行しました。テスト除外・ルール緩和・依存変更はありません。既存の全体lint21エラーには触れていません。SQL/Markdownは既存ESLint設定の解析対象外です。

最終lintで使用したファイル列挙:

```powershell
$phase2Files = @('README.md', 'docs/talent-bank/phase2-report.md', 'supabase/migrations/20260915120000_talent_bank_phase2.sql', 'src/lib/talent-bank/types.ts', 'src/app/talent/page.tsx', 'src/app/api/talent-bank/interview/route.ts') + @(rg --files src/lib/talent-bank/interview src/app/talent/interview)
npx eslint --no-warn-ignored @phase2Files
```

## テスト結果

**9ファイル・81件成功、失敗0件。Phase 1の33件＋Phase 2の48件。** Phase 2はfields/prompt/summary/rate limit 5件、turn 20件、start/pause 11件、API 12件です。モックは既存のHTTP・実SDK・実Supabaseクライアント禁止セットアップ下で動作します。

- fields: 指定20項目、必須8キー、個人情報キーなし。
- prompt/summary: 安定部分の先頭配置、連絡先・子どもへの質問禁止、現在状態、none/declined/unknownの表示と空回答の扱い。
- turn: 更新マージ・根拠ID・run_id、AIのみ充足では未完了、双方充足で完了、AI偽なら未完了、40回境界と41回拒否、失敗時のuser保持・回数消費、定義外キー無視、異常構造、状態拒否、他人所有拒否、同意・成人再チェック、処理中と競合、確定保存失敗、入力制限、会話履歴。
- start/pause: 同意2種と現行版、成人確認、active重複なし、固定挨拶重複なし、paused再開、INSERT競合の回復、done再表示、店舗subject分離、中断時の競合拒否、期限切れ挨拶を再生成しない。
- API/rate limit: 未ログイン401、セッション本人ID使用、インタビューID偽装無視、AI失敗200＋保存内容、10回制限、不正リクエスト・origin拒否、例外内容の非公開。

実DB・本番DB・実Anthropic・VOICEVOX・実ブラウザは使用していません。SQL/RLS/cronは静的レビューのみ、画面は型検査・lintとコードレビューのみです。RPCのテストはインメモリの契約モックであり、PostgreSQL上のトランザクション／RLS実証ではありません。

## 未解決

1. この制限環境では通常の`npx vitest run`が起動エラーになり、指定コマンドそのもののexit 0という完了条件は未達です。Vite設定bundle時の子プロセス起動と、ジャンクション先への一時設定書込が権限で制限されています。代替起動による実Vitest 81件の成功を別記しています。通常コマンドはClaude側の環境で再確認が必要です。
2. マイグレーション適用・実DBでのRLS/RPC/cron検証は未実施です。適用担当者がPhase 1の後に新SQLを適用し、本人／他会員／運営の権限、同時送信、cronジョブを検証してください。
3. 既存の同意文は仮文面のままです。運用開始前の法務監修はPhase 1からの継続事項です。
4. 実ブラウザでのマイク権限・音声認識・モバイルキーボード表示は依頼どおり未検証です。未対応ブラウザではマイクを出さず、文字入力を利用します。

## API費用への影響

今回の実API費用は0円です。外部API・DBに接続していません。新しい依存・サービス契約・キーは追加していません。

運用時は回答送信ごとに最大1回の`callAI`を呼び、Phase 1のAnthropicProviderが`claude-sonnet-5`を選びます。挨拶、同意、中断・再開、まとめ表示にAI費用は発生しません。callAIの既存費用計測をそのまま使い、SDK内部リトライや請求確定費はPhase 1の扱いを維持します。実コストはトークン量とDB単価によります。

失敗やサーバー途中終了も40回の枠に含めることで、再試行による費用増加を制限します。メモリMapの1分10回制限はVercelのインスタンス単位で厳密ではありません。DBで回数確保と並行処理制御を行います。

## Phase 3で行うこと

プロフィール生成・版管理・本人による修正／確認・公開承認・publications・公開プロフィールの優先表示を後続で行います。今回のsummaryは20項目を読み取り表示するだけです。動画・依頼側ヒアリング・マッチングはそれぞれさらに後のフェーズです。

## 仮定・実装上の補足

- 項目は追加回答の20キーを正としました。初回依頼の`motivation`は採用せず、`passion`必須・`reason_started`任意です。
- `getOrCreateSelfSubject`はperson専用のため、personをshop/orgへ書き換えません。店舗・団体では別の本人所有subjectを作成／再利用し、開始前は更新時刻が最新の対象、インタビュー作成後はそのsubject_idを使用します。受付情報の変更UIはPhase 2には追加しません。
- 成人・代表者確認は本人の自己申告です。代表者本人チェックを満たすshop/orgの受付時だけis_adult_confirmedをtrueにします。代理登録・未成年の別経路はありません。
- APIのactionにはinterviewIdがないため、本人のtalentインタビューをサーバーで選びます。request種別の処理は実装しません。
- 最大40回は「40回目を許可し、以後拒否」と解釈。失敗も消費します。完了済みをstartしても新しい無料枠を自動生成しません。
- DBのcheckで上限を定義せず、`config.ts`の定数を呼び出し前に判定します。回数の更新は安全な予約のためAI呼び出し前に行います。原文・予約の原子性を確保するため指定2テーブルに加え2RPCを同じSQLに定義しました。
- 5分リースは60秒のRoute Handler制限を上回る回復用猶予です。AI成功後に確定保存が失敗してもuserと費用記録は残り、assistantとcollected_jsonは片方だけ確定しません。
- AIが十分と誤判定した場合、未回答必須項目のうち1件をサーバーが質問に置き換え、会話が終了したように表示されることを防ぎます。
- `answered`は空でない文字列が必要です。`none`・`declined`は明示的な回答として進捗に数え、値はnullに正規化します。未知の抽出で既存の確定回答は消しません。
- 原文削除は既存pg_cronジョブのUTC基準に合わせて03:15（JST12:15）です。抽出済み値・evidence ID・費用履歴には今回のcronを適用しません。
- 音声認識はブラウザ提供のWeb Speech APIに任せます。認識サービス利用の説明を表示し、認識文字列を確認して手動送信する方式です。
- 未送信文はブラウザstate内のみで、DB・localStorageへ自動保存しません。通信結果不明時の自動再送はせず、保存内容を再取得するまで送信を止めます。

## 作業用ファイル・禁止事項

一時スクリプト、ログ出力ファイル、`.npm-cache`等の作業用ファイルは作成していません。`npx tsc --noEmit`により既存の`tsconfig.tsbuildinfo`（Git除外対象）が更新されました。検証に伴う生成・更新物はこのファイルです。

node_modulesは本体へのジャンクションであり、手動編集していません。`.vite-temp`への一時設定出力は権限エラーで失敗し、最終確認ではファイルが残っていません。既存の`node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json`は更新されていません（更新時刻2026-09-15 06:18:32、今回のテスト前）。

依存追加、本番DB・Anthropic・VOICEVOX接続、マイグレーション適用、Git書込操作、開発サーバー起動は実施していません。
