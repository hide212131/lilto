## Context

現状のリポジトリには `npm run build` と `npm run start`、一部 native companion binary の build 導線はあるが、配布用アプリを生成する標準スクリプトや、GitHub / GitLab の release に成果物を載せる統一フローは存在しない。`package.json` には `build.extraResources` の一部設定だけがあり、配布時に何を同梱し、どの OS 向け成果物をどこへ置き、どのタイミングで公開するかが artifacts 上で未定義である。

一方で、この作業環境は macOS であり、Windows 版の最終挙動確認をローカルだけで完結させるのは現実的ではない。したがって設計上は「macOS で完了できる準備」と「Windows 実機または Windows runner で詰める検証」を分け、未検証状態でも release 候補を前進させられるが、最終公開条件は曖昧にしない構成にする必要がある。

## Goals / Non-Goals

**Goals:**
- 配布ビルドを `build`, `package`, `publish` の段階に分離し、開発起動用フローと混線しない release 導線を作る。
- macOS 成果物はローカル macOS 環境で生成できるようにし、Windows 成果物は Windows runner または Win 実機で同じ release メタデータから生成できるようにする。
- GitHub Releases と GitLab Releases の双方へ、同一バージョン・同一 artifact セットを publish する共通処理を定義する。
- Windows 側の未確認事項を release manifest / チェックリストに残し、作業ブランチを Win 環境で検証しながら詰められるようにする。

**Non-Goals:**
- macOS / Windows のコード署名や notarization をこの変更だけで完全自動化すること。
- Linux 配布物の追加。
- UI 機能や IPC 契約の変更。

## Decisions

1. release フローを `prepare-release`、`package:mac`、`package:win`、`publish:release` の責務に分割する。  
   - 理由: 現在の `build` / `start` は開発向けであり、配布ビルドの責務を混ぜると失敗時の切り分けが難しい。release では「前処理」「OS 別 packaging」「公開」を分けたほうが再実行しやすい。  
   - 代替案: 単一の `npm run release` にすべて集約する。却下理由は、Windows だけ再試行したいケースや publish だけ再実行したいケースに弱いため。

2. release metadata を 1 つの manifest に集約し、GitHub / GitLab への公開はその manifest を入力として同じ artifact 群を扱う。  
   - 理由: 配布ファイル一覧、バージョン、release notes、publish 先の差異を個別スクリプトへ分散させると、片方だけズレる事故が起きやすい。  
   - 代替案: GitHub / GitLab で別々の publish スクリプトと手順書を持つ。却下理由は、運用が二重化しやすく release 内容の不一致を招くため。

3. Windows 配布物は macOS で無理に完成させず、macOS 側では manifest 生成・共通 assets 準備・best-effort packaging までを責務とし、最終的な artifact 確定は Windows runner または Win 実機で行う。  
   - 理由: クロスコンパイルや Windows 固有依存により、macOS 単体で安定した Win 配布物まで保証するのはコストが高い。一方で、手元で準備できる前段を自動化すれば Win 検証の反復速度は上げられる。  
   - 代替案: Windows 版完成まで着手しない。却下理由は、release 全体の自動化が先延ばしになり、macOS 側成果も固定できないため。

4. 公開は原則 release-candidate を経由し、GitHub では draft/prerelease、GitLab では candidate リリース名で未確定状態を明示する。  
   - 理由: macOS 成果物だけ先に作れる状況でも、未検証の Windows バイナリーを「完成版」と誤認させないため。GitLab には GitHub と同等の draft 概念がないため、公開先ごとの表現差は許容する。  
   - 代替案: 片側で先行公開し、もう片側を後追いにする。却下理由は、配布先間でバージョン状態がズレやすい。

5. 検証は「macOS での package 成功」「publish dry-run または draft 作成成功」「Windows 実機または Windows CI での package / 起動確認成功」をそれぞれ独立タスクとして管理する。  
   - 理由: 現状の制約下では、1 台の macOS で全完了を要求すると progress が止まりやすい。どこまで完了したかを段階管理したほうが実務に合う。  
   - 代替案: 最後にまとめて一括確認する。却下理由は、失敗箇所の切り分けが難しくなるため。

## Risks / Trade-offs

- [Risk] release スクリプト追加で `package.json` と CI 定義が複雑化する → Mitigation: 開発用 script と release 用 script を明確に分離し、manifest を単一の入出力契約にする。
- [Risk] GitHub / GitLab の認証方式差で publish 片系統だけ失敗する → Mitigation: token 名、必要権限、dry-run 手順を設計時点で固定し、publish 前検証を task に含める。
- [Risk] Windows 版が「未確認のまま作れた扱い」になる → Mitigation: manifest に verification 状態を記録し、Windows 実機確認が終わるまで final release 条件を満たさない仕様にする。
- [Risk] native binary 同梱漏れで配布物だけ壊れる → Mitigation: 開発 build と release package の両方で同じ native build 前処理を通し、package 後の smoke check を追加する。

## Migration Plan

1. 既存 build 導線を棚卸しし、release 用 script と設定を追加しても開発フローが壊れないよう整理する。
2. release manifest と OS 別 packaging script を追加し、macOS 成果物生成をローカルで通す。
3. GitHub / GitLab 向け publish script または workflow を追加し、draft / dry-run 相当で共通 artifact の公開可否を確認する。
4. Windows 向け packaging の前段を macOS で準備し、Win 実機または Windows runner 側で branch を引き継いで package / 起動確認を実施する。
5. 問題があれば publish ステップを止め、artifact 生成スクリプトだけを残して手動 release 運用へ一時ロールバックできるようにする。

## Open Questions

- 配布ツールは `electron-builder` を採用するか、`electron-forge` など別ツールへ寄せるか。
- GitHub / GitLab への公開を API 呼び出しで統一するか、各 CLI を許容するか。
- Windows 版の最低受け入れ条件を「起動確認」までにするか、「インストーラ配布」まで含めるか。
