# CiDAO

地域の会員・団体、提案・投票、イベントなどを扱う Next.js / Supabase アプリです。AIインタビュー型人材バンクは段階開発で追加します。Phase 1 はサーバーライブラリと DB 基盤のみで、登録画面や公開フローはまだありません。

## 前提とセットアップ

- Node.js 24、npm、Git。Next.js 16.2.9 / React 19 / TypeScript を使用します。
- 開発用 Supabase（PostgreSQL / Auth / Storage）。新規環境では先行マイグレーションの適用も必要です。
- LINE Developers の LINE Login チャネル。既存ログインは Supabase Custom OIDC Provider `custom:line` です。チャネル ID・シークレットは Supabase のプロバイダー設定に登録します。LINE 側には Supabase が示す認証コールバック URL、Supabase の許可リダイレクト先には開発サイトの `/auth/callback` を設定してください。
- TTS を動作させる段階では VOICEVOX ENGINE 0.25.2（ローカル exe または公式 Docker）。単体テストには不要です。

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

`.env.local` の Supabase URL・anon キーを開発プロジェクトの値に設定し、`http://localhost:3000` を開きます。LINE Login には上記の開発用プロバイダー設定が必要です。

環境変数の一覧と用途は [.env.example](.env.example) にあります。`src` と `scripts` の `process.env.*` を列挙し、値は空欄にしています。

| 取得元 | 環境変数・設定 |
|---|---|
| Supabase Project Settings / API、Connect | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`DATABASE_URL` |
| Anthropic Console | `ANTHROPIC_API_KEY`、既存費用警告用 `ANTHROPIC_ADMIN_KEY`。単体テストには不要 |
| LINE Developers / Supabase Auth | LINE Login 設定。`LINE_CHANNEL_ACCESS_TOKEN` は既存 SNS の Messaging API 用で別用途 |
| 既存運営・各サービス管理画面 | Resend、Meta、GCP、GAS、GitHub、Push、Cron、既存 Bot の任意機能用設定 |
| ローカル VOICEVOX | `VOICEVOX_URL`。未設定なら `http://127.0.0.1:50021` |

使わない任意機能の変数は未設定で構いません。`NEXT_PUBLIC_` はブラウザに公開されます。API キー・service_role・DB 接続文字列をこの接頭辞で作らないでください。既存サービスの新規契約は Phase 1 に不要です。

## DB マイグレーション

SQL は `supabase/migrations/` に時系列で保存します。新規環境は先行マイグレーションから順に適用し、既存環境では適用履歴を照合して未適用分だけを対象にします。

既存スクリプトは `.env.local` を直接読み、その中の `DATABASE_URL` に接続します。シェルの環境変数で上書きする実装ではありません。1 ファイルを BEGIN / COMMIT で適用し、失敗時は ROLLBACK します。SQL 全文も標準出力に表示します。

```powershell
node scripts/apply-migration.mjs supabase/migrations/20260915100000_talent_bank_phase1.sql
```

上記は使い方の例です。今回の Phase 1 作業では実行していません。本番への適用は中司さんの承認後に Claude が担当します。実行前に `.env.local` の接続先を確認してください。`database.types.ts` は再生成せず、新テーブル用の型は `src/lib/talent-bank/types.ts` で既存 Database 型を拡張しています。

## テスト

```powershell
npx tsc --noEmit
npm run lint
npm test
```

Vitest は Node 環境で AI SDK・Supabase・fetch をモックし、実 API を呼びません。`.env.local` は読み込みません。費用計算、usage 記録、エラー分類、同意の版・ハッシュ・対象、VOICEVOX の HTTP 2 段階処理を検証します。外部通信と実クライアント生成を禁止するテストセットアップも置いています。

Vitest は 4 系（`@types/node` 20 と両立する版）を使います。2026-09-14 の検証結果は [Phase 1 報告](docs/talent-bank/phase1-report.md) を参照してください。

補助検証は `node src/lib/talent-bank/__tests__/offline-check.mjs` で実行できます。既存 TypeScript で本体を変換し、Node の隔離コンテキスト内で SDK・DB・HTTP をモックする8件の確認です。Vitest の代替合格判定には使いません。

## AI・TTS と費用計測

人材バンクの AI 呼び出しは `src/lib/ai/call.ts` の `callAI()` を必ず通します。`operation`（`chat` / `extractStructured` / `generateText` / `rank`）、`purpose`、入力と任意の `caseId` / `subjectId` / `memberId` を渡します。インタビュー・抽出・タグ・依頼ヒアリングは Sonnet 5、台本・SNS文・候補順位は Opus 5 です。ストリーミングは `onText` で受け取り、最終 usage の記録まで `callAI()` を await します。SDK の自動リトライを使用します。

`VoicevoxProvider.synthesize({ text, voiceId, ...context })` は WAV・再生秒数・文字数・DB の `creditText` を返します。`listVoices()` は DB 設定を返します。ずんだもん（ノーマル）は speaker ID `3`。ENGINE 0.25.2 同梱 `model/0.vvm` の `metas.json` で確認しています。文字数は Unicode コードポイント単位です。

管理者（`members.admin_role` が非 NULL）は RLS に従い `api_usage` を閲覧できます。書き込みは service_role 専用で、記録失敗は呼び出し本体を失敗させません。ログには固定文だけを出します。

| 列 | 読み方 |
|---|---|
| `run_id` / `case_id` | 呼び出し UUID / 案件 ID。`run_id` は一意。SDK 内部リトライは個別行にならない |
| `provider` / `model` / `purpose` | 利用先・モデル・用途 |
| `input_tokens` / `output_tokens` | SDK の通常入力・出力の実測量 |
| `cache_creation_tokens` / `cache_read_tokens` | キャッシュ作成・読取。通常入力と分けて加算 |
| `tts_chars` / `audio_seconds` / `render_seconds` | TTS 入力文字数 / WAV の再生秒数 / TTS 処理全体の経過秒 |
| `rate_version` / `fx_rate` | 使用した単価の有効日一覧 / USD→JPY レート |
| `est_cost_usd` / `est_cost_jpy` | DB 単価による推定費。請求確定費ではない |
| `status` | `estimated` は推定済み、`unavailable` は未確定、`reconciled` は将来の請求照合済み用 |
| `error` | 個人情報を含まない分類コード。解析失敗でも usage があれば費用は推定する |

`cost_rates` は USD / **1 token または1文字**です。現在日以前の最新有効日を単位ごとに選び、60秒間メモリキャッシュします。JPY は `app_settings` の `usd_jpy`（JSON 数値、初期値150）を使います。単価改定は有効日を変えて行を追加してください。

VOICEVOX は DB 初期単価で 0 円です。usage の取れない失敗や未知のモデル・欠落単価は NULL と `unavailable` にし、無料扱いしません。集計時は未確定行の件数も併記してください。Phase 1 は請求照合・確定費の記録を実装せず、`reconciled` を書き込みません。SDK 内部リトライを含む請求額との照合は後続フェーズ、費用管理画面は Phase 8 です。

同意は認証済み本人のクライアントで保存し、本文ハッシュと版を保持します。`hasConsent()` の `subjectId` 省略は会員全体の同意のみを確認し、対象別同意と混同しません。同意文は仮文面です。運用開始前に法務監修・成人確認・代表者本人確認を組み合わせる必要があります。`getOrCreateSelfSubject()` は成人確認を自動で true にしません。

## 動画生成

**Phase 4 で追記予定**。Phase 1 にはレンダラー、FFmpeg 処理、GitHub Actions ジョブ、画像生成 API はありません。将来の動画終了カードと SNS 文には `VOICEVOX:ずんだもん` のクレジットを入れ、本人承認＋運営承認を経て公開します。

## 人材バンクのフェーズ

| Phase | 内容 |
|---|---|
| 1 | AI / TTS 抽象、費用・同意・紹介対象・作業ログの基盤、既存2件是正、テスト・文書 |
| 2 | AI インタビュー、1問ずつ、途中再開、充足判定＋必須条件チェック、会話原文1年削除の pg_cron |
| 3 | プロフィール版、本人確認、公開承認、published 新プロフィール優先、検索拡張 |
| 4 | 写真・EXIF除去、動画ジョブ、VOICEVOX レンダラー、承認 |
| 5 | 依頼側ヒアリング |
| 6 | 条件比較・候補並べ替え・要相談と候補なし対応 |
| 7 | 既存受信箱を使う問い合わせ・通知 |
| 8 | 管理画面・作業時間・原価集計 |
| 9 | 総合テスト・セキュリティ確認・文書・サンプルデータ |
