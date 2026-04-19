# Crabeam
Private low-latency screen sharing with OBS, peer-to-peer transport.

OBSを使用して低遅延・高画質な画面共有をp2pで行うアプリ

## 特徴
- 配信側はアプリを起動後、OBSの設定を行い表示されたurlにOBSで配信を行い、表示されたURLを共有する
- 視聴側は渡されたURLを開くだけ

## 配信側使用方法 (OBSの設定)

手動で設定することも可能ですが、プロファイルを用意しているのでそちらを利用できます。

3種類のプリセットがあるので通信環境によって配信したい画質を調整してください。

- [LowLatancy](https://github.com/aq2r/Crabeam/releases/download/v0.1.0/OBS_Profile_Crabeam_Low_Latancy.zip): 720p30fps
- [Defalut](https://github.com/aq2r/Crabeam/releases/download/v0.1.0/OBS_Profile_Crabeam_Default.zip): 1080p30fps
- [Quality](https://github.com/aq2r/Crabeam/releases/download/v0.1.0/OBS_Profile_Crabeam_Quality.zip): 1080p60fps

基本的にはQualityプロファイルを使用すれば問題ありません。

プロファイルを適用後、アプリに表示されている配信用URLとOBSに自動設定された配信URLが同じか確かめて配信を開始してください。

## 配信側アプリのダウンロード: 
[Download](https://github.com/aq2r/Crabeam/releases/download/v0.1.0/crabeam.zip)

## 注意
まだつながりにくいなどのバグが残っている可能性があります。

また配信側のアップロード帯域に依存するため、大人数の視聴には向きません。画質設定にもよりますが多くても10人ほどが限度かと思われます。
