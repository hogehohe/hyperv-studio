# Hyper-V Studio

[Esperanto](#esperanto) | [日本語](#日本語)

## Esperanto

Labortabla aplikaĵo por Windows, kiu ebligas krei kaj administri lokajn virtualajn maŝinojn de Hyper-V. Ĝi estas konstruita per Tauri, Rust, React kaj TypeScript.

### Ĉefaj funkcioj

- Listigi, krei, ŝalti kaj normale malŝalti virtualajn maŝinojn; malfermi iliajn konzolojn
- Alinomi, forigi kaj kloni virtualajn maŝinojn kun sendependaj virtualaj diskoj
- Administri bibliotekon de ISO-bildoj kaj elekti operaciuman bildon dum kreado de nova maŝino
- Agordi plurajn retadaptilojn, Secure Boot kaj la lanĉordon
- Agordi la komputilan nomon kaj DHCP dum klonado de preparitaj AlmaLinux / Rocky Linux / RHEL-maŝinoj
- Elekti helan aŭ malhelan aspekton, aŭ sekvi la sisteman agordon

La Windows-versio petas administrantajn rajtojn per UAC ĉe lanĉo. Hyper-V kaj ĝia PowerShell-modulo estas bezonataj.

### Instalado

Malfermu [la plej novan eldonon en GitHub Releases](https://github.com/hogehohe/hyperv-studio/releases/latest), elŝutu `Hyper-V-Studio_<versio>_x64-setup.exe` el la sekcio Assets kaj rulu ĝin.

### Programado kaj konstruado

Instalu Node.js, la Rust-ilĉenon por MSVC, Microsoft C++ Build Tools kaj WebView2. Rulu la jenajn komandojn en PowerShell malfermita kun administrantaj rajtoj.

```powershell
cd hyperv-studio
npm ci
npm run tauri dev
```

Por krei la instalilon por Windows:

```powershell
npm run tauri build
```

La instalilo estas generata en `hyperv-studio/src-tauri/target/release/bundle/nsis/`.

Pri uzado, defaŭltaj valoroj, preparado de Linuksa ŝablono kaj la kondiĉoj por klonado, vidu [la README de la aplikaĵo](hyperv-studio/README.md#esperanto).

## 日本語

ローカルの Hyper-V 仮想マシンを構築・管理する Windows 向けデスクトップアプリです。Tauri / Rust / React / TypeScript で実装しています。

### 主な機能

- VM の一覧、作成、起動、シャットダウン、コンソール接続
- 名前変更、削除、独立した仮想ディスクを持つ VM の複製
- ISO ライブラリと、OS イメージを選ぶ新規作成画面
- 複数 NIC の設定、Secure Boot と起動順序の変更
- 準備済み AlmaLinux / Rocky Linux / RHEL の複製時にホスト名・DHCP を設定
- ライト / ダーク / システムに合わせる外観設定

Windows 版は起動時に UAC で管理者権限を要求します。Hyper-V と Hyper-V PowerShell モジュールが必要です。

### インストール

[GitHub Releases の最新版](https://github.com/hogehohe/hyperv-studio/releases/latest)から、Assets の `Hyper-V-Studio_<バージョン>_x64-setup.exe` をダウンロードして実行します。

### 開発・ビルド

Node.js、Rust MSVC、Microsoft C++ Build Tools、WebView2 を用意し、管理者権限で開いた PowerShell から実行します。

```powershell
cd hyperv-studio
npm ci
npm run tauri dev
```

Windows インストーラーの作成:

```powershell
npm run tauri build
```

インストーラーは `hyperv-studio/src-tauri/target/release/bundle/nsis/` に生成します。

操作方法、既定値、Linux テンプレートの準備、複製の条件は [アプリの README](hyperv-studio/README.md#日本語) を参照してください。
