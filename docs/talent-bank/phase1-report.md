# Phase 1 実装報告（完了条件未達）

実施日: 2026-09-14。対象: `C:\Repos\cidao`。統合仕様は読み取りのみ。

Phase 1 のコード・SQL・テスト・文書を作成しました。ただし環境制約と既存 lint エラーにより、依頼書の機械的な完了条件は満たしていません。Phase 2 には進んでいません。

## 実装した内容

- AIProvider の chat / extractStructured / generateText / rank と Anthropic 実装。purpose に応じて Sonnet 5 / Opus 5 を選び、adaptive thinking、output_config、system の ephemeral cache を使用。プリフィルを拒否し、SDK の標準リトライを利用。
- `callAI()` で UUID・usage・用途・任意の案件/対象/会員 ID を記録。ストリームは最終応答まで待って1行記録。usage 不明は NULL / unavailable。解析失敗でも取得済み usage は保持。生の例外や本文はログに出さず、記録失敗は AI 結果を失敗させない。
- 料金は `cost_rates` から単位別・有効日別に取得。USD から `app_settings.usd_jpy` で換算し、設定なしは150。60秒キャッシュ、未来単価除外、未知モデル・欠落単価は unavailable。請求確定費は推定額として偽装せず、Phase 1 は reconciled を記録しない。
- VOICEVOX の audio_query → synthesis、WAV の実再生時間、コードポイント文字数、DB の credit_text、TTS 処理経過秒と0円単価による usage 記録。レンダラーは未実装。
- talent_subjects / consents / api_usage / cost_rates / tts_voices / work_logs の6テーブル、RLS、必要な GRANT、初期単価・話者・為替設定。既存の広い default privileges を新6テーブルだけ取り消し、anon 権限を与えない。
- 同意は本人の認証クライアントで保存。版と UTF-8 本文の SHA-256 を保存し、対象・版・撤回状態を確認。撤回は DB の列権限・RLS・トリガーでも revoked_at の一方向変更に限定。自分以外の対象への同意は拒否。
- 本人 person 行は部分 UNIQUE インデックスで一意にし、同時作成競合は再読込。作成時に成人確認を自動承認しない。
- 既存是正は指定の3行のみ。問い合わせ送信・返信の監査 detail から body を削除し kind を保持。PR 初回通知に public_scope 条件を追加。
- Vitest 設定、外部接続禁止のモックテスト5ファイル（33ケース）、補助的な Node 検証8ケース、環境変数38項目、README。

## 変更したファイル一覧

既存ファイルの変更:

- `.gitignore`（`.env.example` だけ追跡できる例外）
- `package.json`（test スクリプトと vitest devDependency 宣言）
- `README.md`
- `src/app/talent/actions.ts`
- `src/app/me/pr/page.tsx`

新規ファイル:

- `.env.example`
- `vitest.config.ts`
- `supabase/migrations/20260915100000_talent_bank_phase1.sql`
- `src/lib/ai/types.ts`
- `src/lib/ai/anthropic.ts`
- `src/lib/ai/call.ts`
- `src/lib/ai/errors.ts`
- `src/lib/ai/pricing.ts`
- `src/lib/ai/__tests__/pricing.test.ts`
- `src/lib/ai/__tests__/call.test.ts`
- `src/lib/ai/__tests__/errors.test.ts`
- `src/lib/tts/types.ts`
- `src/lib/tts/voicevox.ts`
- `src/lib/tts/__tests__/voicevox.test.ts`
- `src/lib/consents.ts`
- `src/lib/talent-bank/types.ts`
- `src/lib/talent-bank/db.ts`
- `src/lib/talent-bank/usage.ts`
- `src/lib/talent-bank/__tests__/consents.test.ts`
- `src/lib/talent-bank/__tests__/mock-db.ts`
- `src/lib/talent-bank/__tests__/setup.ts`
- `src/lib/talent-bank/__tests__/server-only.ts`
- `src/lib/talent-bank/__tests__/offline-check.mjs`
- `docs/talent-bank/phase1-report.md`

`package-lock.json` は依存取得失敗のため更新できていません。既存 `database.types.ts` は変更・再生成していません。

作業用の生成物として `.phase1-lint.txt`、`.npm-cache/_update-notifier-last-checked`、`.npm-cache/_logs/2026-09-14T12_26_08_963Z-debug-0.log` も未追跡で残っています。個別ファイル名を指定した削除も自動承認レビューに `blocked by policy` と拒否されたため、削除していません。実装のコミット対象には含めないでください。

`src/app/layout.tsx` は他セッションの未ステージ変更として残っています。編集・add はしていません。着手時と検証時の SHA-256 は同一です:

```text
AC3683182BA118B10B67337442FA3ED877A3093C7197244E5773088B5D2143A1
```

## 動作確認・実行結果

| 実行コマンド | exit code | 結果 |
|---|---:|---|
| `git switch -c feature/talent-bank-phase1` | 1 | `.git/refs/heads/feature/talent-bank-phase1` を作成できず失敗。環境で .git が読み取り専用 |
| `npm install -D vitest` | 1 | ENOTCACHED。環境の npm が offline 設定 |
| `npm install -D vitest --offline=false --cache C:/Repos/cidao/.npm-cache` | 1 | ECONNREFUSED。環境の接続先 127.0.0.1:9 により npm 接続不可 |
| `npm install -D vitest --offline --cache C:/Users/nsfactory/AppData/Local/npm-cache --no-audit --no-fund --full-metadata` | 1 | キャッシュ再利用も ENOTCACHED。full-metadata は非対応警告 |
| `npx tsc --noEmit` | 0 | ライブラリ本体作成後、Vitest ファイル追加前の検証 |
| `npx tsc --noEmit` | 1 | 最終版: vitest / vitest/config の型解決エラー8件。依存が未インストール |
| `npm run lint` | 1 | 最終結果も既存21 errors / 8 warnings。変更したコードにはエラーなし |
| `npx eslint src/lib/ai src/lib/tts src/lib/talent-bank src/lib/consents.ts src/app/talent/actions.ts src/app/me/pr/page.tsx vitest.config.ts` | 0 | 変更範囲の lint 成功 |
| `npm test` | 1 | vitest コマンド未インストールのため実行不能 |
| `node src/lib/talent-bank/__tests__/offline-check.mjs` | 0 | 独立した補助検証8件成功、0件失敗 |
| `git diff --check` | 0 | 差分の空白検証成功。LF→CRLF の Git 警告のみ |

補助検証の初回実行では `node --test src/lib/talent-bank/__tests__/offline-check.cjs` が spawn EPERM（exit 1）、続く直接実行は補助ローダーの相対 import モック不足で exit 1 でした。ローダーを修正して ESM に整理し、最終的な `.mjs` の直接実行は上記の通り exit 0。`.cjs` ファイルは残していません。

全体 TypeScript の合格を偽装しないため、正式な tsconfig の除外設定や代用 Vitest 型定義は追加していません。テストを除いた本体については次の補助コマンドを実行し、exit 0、`Production TypeScript diagnostics: 0` を確認しました。

```powershell
node -e "const ts=require('typescript');const p=ts.readConfigFile('tsconfig.json',ts.sys.readFile);const c=ts.parseJsonConfigFileContent(p.config,ts.sys,'.');const files=c.fileNames.filter(f=>!f.includes('/__tests__/')&&!f.endsWith('vitest.config.ts'));const program=ts.createProgram(files,{...c.options,incremental:false,noEmit:true});const d=ts.getPreEmitDiagnostics(program);console.log(ts.formatDiagnosticsWithColorAndContext(d,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>process.cwd(),getNewLine:()=>String.fromCharCode(10)}));console.log('Production TypeScript diagnostics: '+d.length);process.exit(d.length?1:0);"
```

環境変数一覧は `src` / `scripts` を静的走査して照合し、38変数・欠落0件を確認しました。`.env.local` の内容は読んでいません。

## テスト結果と限界

Vitest は5ファイル・33ケースを作成済みですが、未実行です。pricing（6）、callAI（11）、errors（7）、consents（6）、voicevox（3）。ストリーミング完了/中断、SDK例外、解析エラー、未知候補ID、記録失敗、同意の対象/版/撤回状態などを含みます。

補助 Node 検証は8件成功しました。実装本体を TypeScript で変換し、モックだけが許可される隔離コンテキストに読み込んで検証します。料金2モデル、usage4種類、SDK失敗の伝播と記録、best-effort、構造化順位、HTTPエラー分類、同意ハッシュ・版、VOICEVOX2段階とクレジット・0円記録を確認しました。これは Vitest 33ケースの成功を意味しません。

SQL の本番適用・ローカルDB適用・RLS の実接続試験は実施していません。冪等化、権限、制約はコードレビューで確認しました。実DBでの権限検証は承認済み適用工程で必要です。

## 未解決の問題

1. `.git` が読み取り専用のためブランチを作れず、main の作業ツリーに変更が残っています。コミットは未作成です。git add / commit / push は一度も実行していません。
2. npm 接続不可のため Vitest の取得・lockfile 更新が未完了です。`package.json` と `package-lock.json` は未同期なので、現段階で npm ci による再現可能性は保証できません。npm 接続可能な環境で `npm install -D vitest` を実行し、生成された lockfile も含めて検証・コミットする必要があります。
3. 全体 lint は依頼で変更禁止の既存ファイルに21エラー。例: `src/app/admin/sns/page.tsx`、`src/app/admin/timetrial/page.tsx`、`src/app/disaster/approve/page.tsx`、FreeFree、login、match、団体受付、提案ページ等。Date.now の purity、effect、immutability、Link のルール違反などです。ルールを緩めたり対象を除外したりせず、そのまま残しています。
4. 正式な `npx tsc --noEmit` / `npm run lint` / `npm test` の全成功と、feature ブランチ上のコミットという完了条件は未達です。依存・Git環境の解消と、既存lintの別途対応が必要です。
5. 同意文はすべて「（要法務監修・仮文面）」で始まる仮置きです。運用開始前の文面確定は未完了です。

環境制約は本セッションの filesystem permission profile（.git は read）と npm の接続拒否に由来します。承認要求が利用できない設定のため、権限変更や制限回避はしていません。

## API 利用料への影響

今回の実 API 利用料は **0円**。Anthropic API・VOICEVOX HTTP・Supabase・本番 PostgreSQL には接続していません。新しい有料サービスは導入していません。開発サーバー、VOICEVOX、動画レンダラーも起動していません。

本番へマイグレーションを適用しても、この Phase 1 には既存画面からの新しい AI 呼び出し導線がないため、自動で課金呼び出しを開始する変更はありません。後続の呼び出しでは DB 単価を基に推定費を記録します。

## 仮定・実装上の補足

- VOICEVOX speaker ID `3` は仮置きではなく確認済み。`C:\Tools\voicevox_engine\windows-cpu\engine_manifest.json` に version 0.25.2、同梱 `model\0.vvm` の metas.json に「ずんだもん / ノーマル / id 3」を確認しました。HTTP は呼んでいません。
- 商用利用・クレジット文・ずんだもん規約 URL は同梱 `resources/character_info/388f246b-8c41-4ac1-8e2d-5d79f3ff56d9/policy.md` でも確認。terms_url は指定が text 列なので、VOICEVOX とずんだもんの2 URLを改行区切りで格納します。
- Sonnet/Opus のモデル名・料金は依頼の確定仕様を採用し、実 API での疎通確認は行っていません。SDK のインストール済み型に adaptive thinking / output_config があることを確認しました。
- Vitest はローカル npm キャッシュの公開メタデータで確認できた stable 5.0.0 を devDependency に指定。実インストール・互換性確認は未完了です。
- `api_usage.run_id` に UNIQUE、本人 person 行に部分 UNIQUE を追加し、重複を DB でも防止します。
- `api_usage.rate_version` は各単位の provider/model/unit@effective_from を連結。再計算の根拠を保持するため単価は後日上書きせず有効日を変えて追加する運用です。
- TTS の render_seconds は音声合成に要した経過秒、audio_seconds は WAV の再生秒です。動画レンダリング時間ではありません。
- hasConsent の subjectId 省略は対象NULLの同意だけを調べます。対象の異なる同意を流用しません。
- 成人・代表者の受付判定は Phase 2 の開始フローで組み合わせます。Phase 1 の person 行作成だけでは受付済みにしません。

## 次の Phase 2 で行う内容（今回は未実装）

interviews / interview_messages と本人・運営の閲覧制御、1問ずつのインタビュー、途中保存・再開、AI充足判定＋サーバー必須チェック、開始時の成人・本人/代表者・同意確認、会話原文1年削除の pg_cron。共通 AI ライブラリと費用記録を使用します。

先に Phase 1 の未達条件を解消し、検証と指定ブランチへのコミットを完了させる必要があります。公開プロフィール優先表示、動画レンダラー、依頼ヒアリング等は各承認済みフェーズで実装します。

## 追記：Claude による仕上げと検証（2026-09-14）

Codex の環境制約（npm 接続不可・`.git` 読み取り専用）で未達だった項目を Claude が引き継いだ。

| 項目 | 結果 |
|---|---|
| ブランチ | `feature/talent-bank-phase1` を作成しコミット（push は未実施・中司さんの承認待ち） |
| vitest | 5.0.0 は `@types/node` 22 以上を要求し既存の 20 系と衝突するため **4.1.11** に変更して導入。`package-lock.json` 更新 |
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 5 ファイル・33 ケース合格 |
| `npm run lint` | 21 errors / 8 warnings。main ブランチで同じコマンドを実行しても 21 / 8 で同一（既存分。Phase 1 の追加はゼロ）。変更範囲だけの eslint は exit 0 |
| `vitest.config.ts` | ESM/CJS 警告を消すため `vitest.config.mts` に改名 |
| 一時ファイル | `.npm-cache/`、`.phase1-lint.txt` を削除 |
| `src/app/layout.tsx` | 他セッションの未コミット変更のまま。コミットに含めていない |
| 本番 DB | 未接続。マイグレーション適用は承認後 |
