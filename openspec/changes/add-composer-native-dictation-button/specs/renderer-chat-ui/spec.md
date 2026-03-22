## ADDED Requirements

### Requirement: Composer で長押し録音から音声認識できる
システムは、Renderer UI の Composer で送信ボタンの左隣にマイク操作を表示し、ユーザーが押している間だけアプリ内録音を行い、離した時点で音声認識結果を textarea へ反映できなければならない（MUST）。

#### Scenario: 長押し中だけ録音状態が有効になる
- **WHEN** ユーザーが Composer のマイクボタンを押下し続ける
- **THEN** UI は録音中であることを表示し、Renderer 内で音声キャプチャを開始する

#### Scenario: ボタンを離すと文字起こしして textarea に反映する
- **WHEN** ユーザーが Composer のマイクボタンから指を離す、または押下をキャンセルする
- **THEN** UI は録音を停止し、認識結果を textarea に反映して録音中表示を解除する

### Requirement: 音声認識失敗時も Composer を継続利用できる
システムは、録音開始・停止または音声認識に失敗した場合でも、既存のテキスト入力と送信操作を継続利用可能な状態で維持しなければならない（MUST）。

#### Scenario: 未対応または認識失敗時に手入力へ戻れる
- **WHEN** Main が未対応 OS、権限不足、録音失敗、または音声認識失敗を返す
- **THEN** UI は失敗を認識できる状態を表示しつつ textarea と送信操作を利用可能なまま維持する
