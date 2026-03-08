# リリース自動化

## 目的
- macOS 配布物を手元の macOS で生成する
- Windows 配布物は handoff 情報を作って Win 環境で続きを実行する
- GitHub Releases / GitLab Releases の両方に同じ成果物セットを公開する

## 前提
- `npm install`
- macOS / Windows ともに Rust toolchain が入っていること
- Windows では `npm.cmd` / `npx.cmd` を優先すること
- GitHub へ公開する場合は `GITHUB_RELEASE_TOKEN` か `GH_TOKEN`
- GitLab へ公開する場合は `GITLAB_TOKEN`
- 必要なら `LILTO_GITHUB_REPOSITORY=owner/repo` と `LILTO_GITLAB_PROJECT=group/project` を設定する

## macOS での release 候補作成
1. `package.json` の `version` を対象 release version に合わせる
2. `npm run prepare:release -- --version 0.1.0`
3. `npm run package:release:mac -- --version 0.1.0`
4. `npm run package:release:win:prepare -- --version 0.1.0`
5. `npm run publish:release -- --version 0.1.0 --dry-run`

生成物:
- `release/<version>/manifest.json`
- `release/<version>/RELEASE_NOTES.md`
- `release/<version>/dist/*`
- `release/<version>/WINDOWS_HANDOFF.md`

## Windows 側の続行
1. 作業ブランチを Windows 環境へ checkout する
2. `npm.cmd ci`
3. `npm.cmd run package:release:win -- --version <version>`
4. 生成された portable 実行ファイルを起動確認する
5. 必要なら `npm.cmd run publish:release -- --version <version> --dry-run`

## publish の挙動
- GitHub は draft / prerelease を使う
- GitLab は draft がないため、同じ tag と release notes を candidate リリースとして更新する
- `--dry-run` では API 呼び出しを行わず、manifest 上の publish plan だけ更新する

## 再試行単位
- package が失敗したら `package:release:<platform>` だけ再実行する
- publish が失敗したら token と対象サービスを確認して `publish:release` を再実行する
- Windows 確認が未完了なら `manifest.json` と `WINDOWS_HANDOFF.md` を Win 環境へ渡して続きから実施する
